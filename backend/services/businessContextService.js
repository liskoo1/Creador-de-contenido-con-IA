const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebsiteCaptureService = require('./websiteCaptureService');
const BusinessContextAgent = require('./businessContextAgent');
const PublicWebPolicy = require('./publicWebPolicy');

/**
 * Servicio de orquestación de trabajos de análisis de contexto de negocio.
 * Controla el ciclo de vida, persistencia de estados, timeouts y cancelación.
 */
class BusinessContextService {
  constructor(options = {}) {
    this.jobsDir = options.jobsDir || path.join(__dirname, '../data/business-context-jobs');
    this.captureService = options.captureService || new WebsiteCaptureService(options.captureOptions || {});
    this.agent = options.agent || new BusinessContextAgent(options.agentOptions || {});
    this.policy = options.policy || new PublicWebPolicy(options.policyOptions || {});
    this.totalTimeoutMs = options.totalTimeoutMs || 120000; // 120s límite total

    this.activeControllers = new Map(); // jobId -> AbortController
    this._init();
  }

  _init() {
    if (!fs.existsSync(this.jobsDir)) {
      fs.mkdirSync(this.jobsDir, { recursive: true });
    }
    this._recoverInterruptedJobs();
    this._cleanupOldJobs();
  }

  /**
   * Al iniciar, cualquier trabajo que estuviera en progreso se marca como fallido por reinicio.
   */
  _recoverInterruptedJobs() {
    try {
      const files = fs.readdirSync(this.jobsDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const filePath = path.join(this.jobsDir, f);
        try {
          const job = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (['queued', 'reading', 'extracting', 'capturing'].includes(job.status)) {
            job.status = 'failed';
            job.error = 'Trabajo interrumpido por reinicio del servidor.';
            job.updatedAt = new Date().toISOString();
            fs.writeFileSync(filePath, JSON.stringify(job, null, 2), 'utf8');
            console.log(`[BusinessContextService] Recuperado trabajo interrumpido: ${job.id}`);
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[BusinessContextService] Error recuperando trabajos:', e.message);
    }
  }

  /**
   * Limpia trabajos y directorios temporales de más de 24 horas.
   */
  _cleanupOldJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
    try {
      this.captureService.cleanupOldJobs(maxAgeMs);
      const now = Date.now();
      const files = fs.readdirSync(this.jobsDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const filePath = path.join(this.jobsDir, f);
        try {
          const stats = fs.statSync(filePath);
          if (now - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(filePath);
          }
        } catch (_) {}
      }
    } catch (e) {
      console.warn('[BusinessContextService] Error limpiando trabajos antiguos:', e.message);
    }
  }

  /**
   * Guarda o actualiza el manifiesto de un trabajo en disco.
   */
  _saveJob(job) {
    const filePath = path.join(this.jobsDir, `${job.id}.json`);
    job.updatedAt = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(job, null, 2), 'utf8');
  }

  /**
   * Lee el manifiesto de un trabajo.
   */
  getJob(jobId) {
    if (!jobId || typeof jobId !== 'string') return null;
    const cleanId = path.basename(jobId);
    const filePath = path.join(this.jobsDir, `${cleanId}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
      return null;
    }
  }

  /**
   * Crea un nuevo trabajo de análisis o recupera uno existente por reqKey (idempotencia).
   */
  async createJob(targetUrl, options = {}) {
    const { reqKey = null, baseRevision = null } = options;

    // 1. Validación de seguridad previa
    const { validUrl } = await this.policy.validateTargetUrl(targetUrl);

    // 2. Comprobar si ya existe un trabajo activo con la misma reqKey
    if (reqKey) {
      const existing = this._findActiveJobByReqKey(reqKey);
      if (existing) {
        return existing;
      }
    }

    const jobId = crypto.randomUUID();
    const job = {
      id: jobId,
      reqKey: reqKey || jobId,
      url: validUrl,
      baseRevision: baseRevision || null,
      status: 'queued',
      stage: 'queued',
      progressMessage: 'En cola para análisis...',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      proposal: null,
      captures: null,
      sources: []
    };

    this._saveJob(job);

    // Iniciar procesamiento asíncrono
    this._startJobExecution(jobId, validUrl);

    return job;
  }

  /**
   * Busca si hay un trabajo pendiente o listo con el mismo reqKey.
   */
  _findActiveJobByReqKey(reqKey) {
    try {
      const files = fs.readdirSync(this.jobsDir);
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const job = JSON.parse(fs.readFileSync(path.join(this.jobsDir, f), 'utf8'));
        if (job.reqKey === reqKey && ['queued', 'reading', 'extracting', 'capturing', 'ready', 'partial'].includes(job.status)) {
          return job;
        }
      }
    } catch (_) {}
    return null;
  }

  /**
   * Ejecuta el trabajo de forma asíncrona controlando timeouts y cancelaciones.
   */
  async _startJobExecution(jobId, targetUrl) {
    const controller = new AbortController();
    this.activeControllers.set(jobId, controller);

    const timeoutHandle = setTimeout(() => {
      console.warn(`[BusinessContextService] Timeout total excedido para job ${jobId}`);
      controller.abort();
    }, this.totalTimeoutMs);

    try {
      const job = this.getJob(jobId);
      if (!job || job.status === 'cancelled') return;

      const onProgress = ({ stage, message }) => {
        const current = this.getJob(jobId);
        if (current && current.status !== 'cancelled') {
          current.stage = stage;
          current.status = stage === 'ready' ? 'ready' : (stage === 'capturing' ? 'capturing' : 'reading');
          current.progressMessage = message;
          this._saveJob(current);
        }
      };

      // 1. Navegación y captura Playwright
      const captureData = await this.captureService.captureWebsite(targetUrl, {
        jobId,
        onProgress,
        abortSignal: controller.signal
      });

      // 2. Extracción estructurada con Agente y Gemini
      const updating = this.getJob(jobId);
      if (!updating || updating.status === 'cancelled') return;

      updating.stage = 'extracting';
      updating.status = 'extracting';
      updating.progressMessage = 'Analizando evidencia con IA y preparando propuesta...';
      this._saveJob(updating);

      const proposal = await this.agent.extractContext(captureData);

      // 3. Consolidación de resultado
      const finalJob = this.getJob(jobId);
      if (!finalJob || finalJob.status === 'cancelled') return;

      finalJob.sources = captureData.sources || [];
      finalJob.captures = captureData.captures || {};
      finalJob.proposal = proposal;
      finalJob.stage = 'ready';

      // Si la captura móvil falló pero el texto y escritorio están listos, marcar como 'partial'
      if (!captureData.captures?.mobile && captureData.captures?.desktop) {
        finalJob.status = 'partial';
        finalJob.progressMessage = 'Análisis listo con captura parcial (escritorio disponible, móvil omitida).';
      } else {
        finalJob.status = 'ready';
        finalJob.progressMessage = 'Análisis completado exitosamente.';
      }

      this._saveJob(finalJob);
      console.log(`[BusinessContextService] Trabajo completado con éxito: ${jobId} (${finalJob.status})`);

    } catch (err) {
      console.error(`[BusinessContextService] Error procesando trabajo ${jobId}:`, err.message);
      const failedJob = this.getJob(jobId);
      if (failedJob && failedJob.status !== 'cancelled') {
        failedJob.status = 'failed';
        failedJob.error = err.message || 'Error durante el análisis del sitio web.';
        failedJob.progressMessage = `Fallo en el análisis: ${failedJob.error}`;
        this._saveJob(failedJob);
      }
    } finally {
      clearTimeout(timeoutHandle);
      this.activeControllers.delete(jobId);
    }
  }

  /**
   * Cancela un trabajo en curso o descarta un borrador.
   */
  cancelJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) return false;

    // Si hay un controlador activo, abortar
    const controller = this.activeControllers.get(jobId);
    if (controller) {
      controller.abort();
      this.activeControllers.delete(jobId);
    }

    job.status = 'cancelled';
    job.progressMessage = 'Trabajo cancelado por el usuario.';
    this._saveJob(job);

    // Limpiar archivos temporales de capturas
    this._cleanupJobTempFiles(jobId);
    return true;
  }

  /**
   * Marca un trabajo como aplicado.
   */
  markJobApplied(jobId) {
    const job = this.getJob(jobId);
    if (job) {
      job.status = 'applied';
      job.appliedAt = new Date().toISOString();
      this._saveJob(job);
    }
  }

  /**
   * Limpia archivos de capturas temporales de un trabajo.
   */
  _cleanupJobTempFiles(jobId) {
    const jobDir = path.join(this.captureService.tempBaseDir, jobId);
    if (fs.existsSync(jobDir)) {
      try {
        const files = fs.readdirSync(jobDir);
        for (const f of files) {
          fs.unlinkSync(path.join(jobDir, f));
        }
        fs.rmdirSync(jobDir);
      } catch (e) {
        console.warn(`[BusinessContextService] No se pudieron limpiar temporales de ${jobId}:`, e.message);
      }
    }
  }
}

module.exports = BusinessContextService;
