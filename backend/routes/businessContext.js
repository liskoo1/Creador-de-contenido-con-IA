const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const BusinessContextService = require('../services/businessContextService');
const productContextService = require('../services/productContextService');
const knowledgeService = require('../services/knowledgeService');

const businessContextService = new BusinessContextService();

/**
 * Inicia el análisis web del negocio de forma asíncrona.
 * POST /api/product-context/analyze
 */
router.post('/analyze', async (req, res) => {
  try {
    const { url, reqKey, baseRevision } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ error: 'La URL del sitio web es obligatoria.' });
    }

    const job = await businessContextService.createJob(url.trim(), {
      reqKey: reqKey || null,
      baseRevision: baseRevision || null
    });

    return res.status(202).json({
      success: true,
      jobId: job.id,
      status: job.status,
      stage: job.stage,
      progressMessage: job.progressMessage
    });
  } catch (error) {
    const isSecurity = error.name === 'SecurityError' || /SSRF|privada|restringida|puerto|no permitid|esquema|credencial/i.test(error.message);
    const statusCode = isSecurity ? 403 : 400;
    console.error('[Route:analyze] Error:', error.message);
    return res.status(statusCode).json({ error: error.message });
  }
});

/**
 * Consulta el estado, avance y propuesta de un trabajo de análisis.
 * GET /api/product-context/analysis/:jobId
 */
router.get('/analysis/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = businessContextService.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Trabajo de análisis no encontrado.' });
  }

  // Sanitizar rutas absolutas en la respuesta de capturas para seguridad
  const safeCaptures = {};
  if (job.captures) {
    if (job.captures.desktop) {
      safeCaptures.desktop = {
        viewport: job.captures.desktop.viewport,
        width: job.captures.desktop.width,
        height: job.captures.desktop.height,
        capturedAt: job.captures.desktop.capturedAt,
        previewUrl: `/api/product-context/analysis/${job.id}/preview/desktop`
      };
    }
    if (job.captures.mobile) {
      safeCaptures.mobile = {
        viewport: job.captures.mobile.viewport,
        width: job.captures.mobile.width,
        height: job.captures.mobile.height,
        capturedAt: job.captures.mobile.capturedAt,
        previewUrl: `/api/product-context/analysis/${job.id}/preview/mobile`
      };
    }
  }

  return res.json({
    id: job.id,
    reqKey: job.reqKey,
    url: job.url,
    status: job.status,
    stage: job.stage,
    progressMessage: job.progressMessage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    sources: job.sources || [],
    captures: safeCaptures,
    proposal: job.proposal || null
  });
});

/**
 * Aplica atómicamente la propuesta y/o capturas seleccionadas.
 * POST /api/product-context/analysis/:jobId/apply
 */
router.post('/analysis/:jobId/apply', async (req, res) => {
  const { jobId } = req.params;
  const { baseRevision, selectedFields = [], selectedCaptures = [] } = req.body;

  const job = businessContextService.getJob(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Trabajo de análisis no encontrado.' });
  }

  if (!['ready', 'partial'].includes(job.status)) {
    return res.status(400).json({ error: `El trabajo no está listo para aplicar (estado actual: ${job.status}).` });
  }

  const importedAssets = [];

  // 1. Importar capturas seleccionadas al Knowledge Hub
  try {
    if (Array.isArray(selectedCaptures) && selectedCaptures.length > 0 && job.captures) {
      for (const capType of selectedCaptures) {
        const cap = job.captures[capType];
        if (cap && cap.filePath && fs.existsSync(cap.filePath)) {
          const registered = knowledgeService.importScreenshotAsset(cap.filePath, {
            viewport: cap.viewport,
            width: cap.width,
            height: cap.height,
            sourceUrl: job.url,
            finalUrl: job.url,
            capturedAt: cap.capturedAt,
            analysisId: job.id,
            description: `Captura web (${cap.viewport === 'mobile' ? 'Móvil responsive' : 'Escritorio'}) de ${job.proposal?.businessName?.value || job.url}`
          });
          importedAssets.push(registered);
        }
      }
    }

    // 2. Aplicar campos al contexto de producto con verificación de concurrencia
    const result = productContextService.applyWebProposal({
      jobId: job.id,
      proposal: job.proposal,
      selectedFields,
      baseRevision: baseRevision || null,
      sources: job.sources || [],
      sourceUrl: job.url
    });

    // 3. Marcar trabajo como aplicado
    businessContextService.markJobApplied(job.id);

    return res.json({
      success: true,
      context: result.context,
      revision: result.revision,
      importedAssets
    });

  } catch (err) {
    if (err.code === 'CONFLICT') {
      return res.status(409).json({
        error: err.message,
        code: 'CONFLICT',
        currentRevision: err.currentRevision,
        currentData: err.currentData
      });
    }
    console.error('[Route:apply] Error aplicando propuesta:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Cancela o descarta un análisis y sus archivos temporales.
 * DELETE /api/product-context/analysis/:jobId
 */
router.delete('/analysis/:jobId', (req, res) => {
  const { jobId } = req.params;
  const success = businessContextService.cancelJob(jobId);
  return res.json({ success, message: success ? 'Trabajo cancelado y descartado.' : 'No se pudo cancelar el trabajo.' });
});

/**
 * Sirve de forma segura la vista previa de una captura temporal.
 * GET /api/product-context/analysis/:jobId/preview/:type
 */
router.get('/analysis/:jobId/preview/:type', (req, res) => {
  const { jobId, type } = req.params;

  if (!['desktop', 'mobile'].includes(type)) {
    return res.status(400).json({ error: 'Tipo de captura no válido. Use desktop o mobile.' });
  }

  const job = businessContextService.getJob(jobId);
  if (!job || !job.captures || !job.captures[type]) {
    return res.status(404).json({ error: 'Captura no encontrada.' });
  }

  const filePath = job.captures[type].filePath;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Archivo de captura no encontrado en disco.' });
  }

  // Prevenir path traversal: el archivo debe estar estrictamente dentro de tempBaseDir
  const normalizedFile = path.resolve(filePath);
  const normalizedBase = path.resolve(businessContextService.captureService.tempBaseDir);
  if (!normalizedFile.startsWith(normalizedBase)) {
    return res.status(403).json({ error: 'Acceso no autorizado al archivo.' });
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=300');
  fs.createReadStream(filePath).pipe(res);
});

module.exports = router;
