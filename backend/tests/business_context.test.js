const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const express = require('express');

const BusinessContextAgent = require('../services/businessContextAgent');
const BusinessContextService = require('../services/businessContextService');
const productContextService = require('../services/productContextService');
const knowledgeService = require('../services/knowledgeService');

describe('BIZ-001: Agente y Servicio de Contexto de Negocio', () => {

  // --- 1. TESTS DE BUSINESS CONTEXT AGENT ---
  describe('1. BusinessContextAgent - Validación y Normalización de Propuestas', () => {
    test('a) Parsea correctamente JSON estructurado válido con citas de evidencia', () => {
      const agent = new BusinessContextAgent();
      const mockRawJson = JSON.stringify({
        businessName: { value: 'Helpmeagro', confidence: 'high', evidence: [{ url: 'https://helpmeagro.com', snippet: 'Helpmeagro es la plataforma' }] },
        industry: { value: 'Agrotech', confidence: 'high', evidence: [{ url: 'https://helpmeagro.com', snippet: 'software para el campo' }] },
        website: { value: 'https://helpmeagro.com', confidence: 'high', evidence: [] },
        offering: { value: 'Gestión de fincas y asesoría con IA', confidence: 'high', evidence: [] },
        targetAudience: { value: 'Agricultores y cooperativas', confidence: 'medium', evidence: [] },
        keyBenefits: { value: 'Ahorro de agua y optimización de cosechas', confidence: 'high', evidence: [] },
        location: { value: 'Sevilla, España', confidence: 'high', evidence: [] },
        tone: { value: 'Profesional y cercano', confidence: 'medium', isProposal: true, evidence: [] },
        defaultHashtags: { value: '#Agro #Helpmeagro', confidence: 'medium', isProposal: true, evidence: [] },
        summary: { value: 'Plataforma líder para digitalización del sector agrícola.', confidence: 'high', evidence: [] }
      });

      const proposal = agent.parseAndValidate(mockRawJson, { sourceUrl: 'https://helpmeagro.com' });

      assert.strictEqual(proposal.businessName.value, 'Helpmeagro');
      assert.strictEqual(proposal.businessName.confidence, 'high');
      assert.strictEqual(proposal.businessName.evidence[0].snippet, 'Helpmeagro es la plataforma');
      assert.strictEqual(proposal.tone.isProposal, true);
      assert.strictEqual(proposal.defaultHashtags.isProposal, true);
      assert.strictEqual(proposal.summary.value, 'Plataforma líder para digitalización del sector agrícola.');
    });

    test('b) Limpia bloques markdown ```json y maneja campos ausentes sin alucinación', () => {
      const agent = new BusinessContextAgent();
      const rawWithMarkdown = '```json\n{\n  "businessName": "MiEmpresa"\n}\n```';
      const proposal = agent.parseAndValidate(rawWithMarkdown, { sourceUrl: 'https://miempresa.com' });

      assert.strictEqual(proposal.businessName.value, 'MiEmpresa');
      assert.strictEqual(proposal.industry.value, '');
      assert.strictEqual(proposal.industry.confidence, 'low');
      assert.strictEqual(proposal.tone.isProposal, true);
      assert.strictEqual(proposal.website.value, 'https://miempresa.com');
    });

    test('c) Lanza error claro ante respuestas no JSON o malformadas', () => {
      const agent = new BusinessContextAgent();
      assert.throws(() => {
        agent.parseAndValidate('Texto plano sin formato JSON');
      }, /Error de formato en la respuesta del modelo/);
    });
  });

  // --- 2. TESTS DE PRODUCT CONTEXT SERVICE (REVISIONES Y MERGE) ---
  describe('2. ProductContextService - Revisiones Atómicas y Fusión no destructiva', () => {
    let originalContext;

    beforeEach(() => {
      originalContext = productContextService.get();
    });

    afterEach(() => {
      productContextService.saveAll(originalContext.context, originalContext.metadata);
    });

    test('a) Genera baseRevision determinista basada en el contenido', () => {
      const rev1 = productContextService.getRevision();
      assert.ok(rev1);
      assert.strictEqual(typeof rev1, 'string');
      assert.strictEqual(rev1.length, 16);

      const rev2 = productContextService.getRevision();
      assert.strictEqual(rev1, rev2);
    });

    test('b) Fusión no destructiva: aplica solo los campos seleccionados y preserva el resto', () => {
      productContextService.saveAll('Contexto manual preexistente', {
        productName: 'Nombre Manual',
        industry: 'Sector Manual',
        presenterProfile: 'Carlos Agrónomo Experto'
      });

      const initialRev = productContextService.getRevision();

      const mockProposal = {
        businessName: { value: 'Nuevo Nombre IA' },
        industry: { value: 'Nuevo Sector IA' },
        website: { value: 'https://ia-empresa.com' },
        summary: { value: 'Nueva descripción IA' }
      };

      const result = productContextService.applyWebProposal({
        jobId: 'job-test-01',
        proposal: mockProposal,
        selectedFields: ['industry', 'website'],
        baseRevision: initialRev,
        sourceUrl: 'https://ia-empresa.com'
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.context.context, 'Contexto manual preexistente');
      assert.strictEqual(result.context.metadata.productName, 'Nombre Manual');
      assert.strictEqual(result.context.metadata.industry, 'Nuevo Sector IA');
      assert.strictEqual(result.context.metadata.website, 'https://ia-empresa.com');
      assert.strictEqual(result.context.metadata.presenterProfile, 'Carlos Agrónomo Experto');
      assert.ok(result.context.metadata.webImport);
      assert.strictEqual(result.context.metadata.webImport.jobId, 'job-test-01');
    });

    test('c) Lanza conflicto 409 cuando baseRevision no coincide con la versión actual', () => {
      const revA = productContextService.getRevision();

      productContextService.saveContext('Edición concurrente del usuario');

      const mockProposal = {
        businessName: { value: 'Cambio Tardío' }
      };

      assert.throws(() => {
        productContextService.applyWebProposal({
          jobId: 'job-conflict',
          proposal: mockProposal,
          selectedFields: ['businessName'],
          baseRevision: revA
        });
      }, (err) => {
        return err.code === 'CONFLICT' && err.message.includes('Conflicto de edición');
      });
    });
  });

  // --- 3. TESTS DE KNOWLEDGE SERVICE (ROLES DE ACTIVOS Y FILTRADO) ---
  describe('3. KnowledgeService - Roles de Activos y Aislamiento Visual', () => {
    const testDir = path.join(__dirname, '../data/temp_captures/test_job_dummy');
    const dummyPng = path.join(testDir, 'dummy.png');

    beforeEach(() => {
      if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(dummyPng, Buffer.from('FAKE_PNG_CONTENT'));
    });

    afterEach(() => {
      if (fs.existsSync(dummyPng)) fs.unlinkSync(dummyPng);
      if (fs.existsSync(testDir)) fs.rmdirSync(testDir);
    });

    test('a) importScreenshotAsset registra la captura con assetRole: website-screenshot y dimensiones', () => {
      const asset = knowledgeService.importScreenshotAsset(dummyPng, {
        viewport: 'mobile',
        width: 390,
        height: 844,
        sourceUrl: 'https://test.com',
        analysisId: 'test-job-01'
      });

      assert.ok(asset.id);
      assert.strictEqual(asset.assetRole, 'website-screenshot');
      assert.strictEqual(asset.viewport, 'mobile');
      assert.strictEqual(asset.width, 390);
      assert.strictEqual(asset.height, 844);

      knowledgeService.deleteItem('asset', asset.id);
    });

    test('b) getImageAssets con excludeRoles excluye capturas web del pool de marcas', () => {
      const screenshotAsset = knowledgeService.importScreenshotAsset(dummyPng, {
        viewport: 'desktop',
        width: 1440,
        height: 900
      });

      const brandPool = knowledgeService.getImageAssets(null, { excludeRoles: ['website-screenshot'] });
      const foundInBrandPool = brandPool.some(a => a.id === screenshotAsset.id);
      assert.strictEqual(foundInBrandPool, false, 'La captura no debe aparecer en el pool de marca de generación');

      const webScreenshots = knowledgeService.getWebsiteScreenshots();
      const foundInScreenshots = webScreenshots.some(a => a.id === screenshotAsset.id);
      assert.strictEqual(foundInScreenshots, true, 'La captura sí debe aparecer en getWebsiteScreenshots');

      knowledgeService.deleteItem('asset', screenshotAsset.id);
    });
  });

  // --- 4. TESTS DE BUSINESS CONTEXT SERVICE (CICLO DE VIDA) ---
  describe('4. BusinessContextService - Ciclo de Vida y Recuperación', () => {
    test('a) getJob devuelve null para IDs inexistentes o rutas inválidas', () => {
      const svc = new BusinessContextService();
      assert.strictEqual(svc.getJob('non-existent-uuid'), null);
      assert.strictEqual(svc.getJob('../../../etc/passwd'), null);
    });

    test('b) Cancela trabajo y marca status cancelled', () => {
      const svc = new BusinessContextService();
      const job = {
        id: 'test-cancel-job',
        reqKey: 'test-cancel-job',
        url: 'https://example.com',
        status: 'reading',
        stage: 'reading'
      };
      svc._saveJob(job);

      const res = svc.cancelJob('test-cancel-job');
      assert.strictEqual(res, true);

      const updated = svc.getJob('test-cancel-job');
      assert.strictEqual(updated.status, 'cancelled');

      const p = path.join(svc.jobsDir, 'test-cancel-job.json');
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
  });

  // --- 5. TESTS DE ENDPOINTS HTTP Y SEGURIDAD ---
  describe('5. Rutas HTTP de Contexto de Negocio y Seguridad de Red', () => {
    let app;
    let server;
    let baseUrl;

    beforeEach(async () => {
      app = express();
      app.use(express.json());
      app.use('/api/product-context', require('../routes/businessContext'));
      await new Promise(resolve => {
        server = app.listen(0, () => {
          baseUrl = `http://localhost:${server.address().port}/api/product-context`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });

    test('a) POST /analyze rechaza peticiones sin URL con 400', async () => {
      const res = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('obligatoria'));
    });

    test('b) POST /analyze bloquea destinos SSRF (loopback y metadatos) con 403', async () => {
      const res = await fetch(`${baseUrl}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'http://127.0.0.1:8080/internal' })
      });
      assert.strictEqual(res.status, 403);
      const data = await res.json();
      assert.ok(data.error.includes('SSRF') || data.error.includes('privada') || data.error.includes('permitid') || data.error.includes('Puerto'));
    });

    test('c) GET /analysis/:jobId devuelve 404 para trabajos inexistentes', async () => {
      const res = await fetch(`${baseUrl}/analysis/non-existent-id`);
      assert.strictEqual(res.status, 404);
    });

    test('d) GET /analysis/:jobId/preview/:type valida tipo de captura estrictamente', async () => {
      const res = await fetch(`${baseUrl}/analysis/job-123/preview/arbitrary`);
      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.ok(data.error.includes('desktop o mobile'));
    });

    test('e) DELETE /analysis/:jobId cancela y responde 200', async () => {
      const res = await fetch(`${baseUrl}/analysis/dummy-job`, { method: 'DELETE' });
      assert.strictEqual(res.status, 200);
    });
  });
});
