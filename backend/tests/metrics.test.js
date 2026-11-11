const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Módulos del sistema
const { app } = require('../server');
const instagramPublisher = require('../automation/instagramPublisher');
const postService = require('../services/postService');

describe('MET-001: Suite de Métricas e Insights de Instagram', () => {

  // =========================================================================
  // 1. Pruebas Unitarias de instagramPublisher.getMediaInsights(mediaId)
  // =========================================================================
  describe('1. instagramPublisher.getMediaInsights(mediaId)', () => {
    let originalEnvToken;
    let originalFetch;

    beforeEach(() => {
      originalEnvToken = process.env.INSTAGRAM_ACCESS_TOKEN;
      originalFetch = global.fetch;
    });

    afterEach(() => {
      process.env.INSTAGRAM_ACCESS_TOKEN = originalEnvToken;
      global.fetch = originalFetch;
    });

    test('a) Sin INSTAGRAM_ACCESS_TOKEN configurado: devuelve mock sin fallar', async () => {
      delete process.env.INSTAGRAM_ACCESS_TOKEN;

      const result = await instagramPublisher.getMediaInsights('17895695668004550');

      assert.equal(result.success, false);
      assert.equal(result.mock, true);
      assert.match(result.message, /Credenciales de Meta no configuradas/);
    });

    test('b) Distinción estricta de null vs 0 en mapeo de Graph API', async () => {
      process.env.INSTAGRAM_ACCESS_TOKEN = 'EAABtest_token';

      // Simular respuesta de Graph API v25.0
      // impressions = 0 legítimo
      // reach = 120
      // saved = ausente de values (debe ser null)
      // total_interactions = 0 legítimo vía total_value
      global.fetch = async (url) => {
        assert.ok(url.includes('/insights?metric=impressions,reach,saved,total_interactions'));
        assert.ok(url.includes('access_token=EAABtest_token'));

        return {
          ok: true,
          json: async () => ({
            data: [
              {
                name: 'impressions',
                period: 'lifetime',
                values: [{ value: 0 }]
              },
              {
                name: 'reach',
                period: 'lifetime',
                values: [{ value: 120 }]
              },
              {
                name: 'saved',
                period: 'lifetime',
                values: [] // Sin valor disponible -> null
              },
              {
                name: 'total_interactions',
                period: 'lifetime',
                total_value: { value: 0 }
              }
            ]
          })
        };
      };

      const result = await instagramPublisher.getMediaInsights('17895695668004550');

      assert.equal(result.success, true);
      assert.equal(result.mediaId, '17895695668004550');

      // Distinción estricta de 0 vs null
      assert.strictEqual(result.metrics.impressions, 0, 'impressions con valor 0 debe ser numéricamente 0');
      assert.notStrictEqual(result.metrics.impressions, null, 'impressions 0 no debe ser null');

      assert.strictEqual(result.metrics.reach, 120, 'reach debe ser 120');

      assert.strictEqual(result.metrics.saved, null, 'saved sin valor debe ser estrictamente null');
      assert.notStrictEqual(result.metrics.saved, 0, 'saved no debe asumir 0 cuando está ausente');

      assert.strictEqual(result.metrics.total_interactions, 0, 'total_interactions 0 debe ser numéricamente 0');
    });

    test('c) Métrica completamente no reportada por Graph API se mapea a null y nunca a 0', async () => {
      process.env.INSTAGRAM_ACCESS_TOKEN = 'EAABtest_token';

      // Meta responde solo con reach
      global.fetch = async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              name: 'reach',
              values: [{ value: 45 }]
            }
          ]
        })
      });

      const result = await instagramPublisher.getMediaInsights('17895695668004550');

      assert.equal(result.success, true);
      assert.strictEqual(result.metrics.reach, 45);
      assert.strictEqual(result.metrics.impressions, null, 'impressions no devuelta debe ser null');
      assert.strictEqual(result.metrics.saved, null, 'saved no devuelta debe ser null');
      assert.strictEqual(result.metrics.total_interactions, null, 'total_interactions no devuelta debe ser null');
    });

    test('d) Manejo seguro de error de Graph API (captura try/catch sin excepciones no controladas)', async () => {
      process.env.INSTAGRAM_ACCESS_TOKEN = 'EAABtest_token';

      global.fetch = async () => ({
        ok: false,
        json: async () => ({
          error: {
            message: 'Unsupported get request. Object with ID does not exist.'
          }
        })
      });

      const result = await instagramPublisher.getMediaInsights('invalid_id');

      assert.equal(result.success, false);
      assert.match(result.error, /Unsupported get request/);
    });

    test('e) Fallo de red (fetch lanza excepción) devuelve { success: false, error }', async () => {
      process.env.INSTAGRAM_ACCESS_TOKEN = 'EAABtest_token';

      global.fetch = async () => {
        throw new Error('Connection reset by peer');
      };

      const result = await instagramPublisher.getMediaInsights('17895695668004550');

      assert.equal(result.success, false);
      assert.equal(result.error, 'Connection reset by peer');
    });
  });

  // =========================================================================
  // 2. Pruebas Unitarias de postService.updateMetrics(id, metricsData)
  // =========================================================================
  describe('2. postService.updateMetrics(id, metricsData)', () => {
    const postsFilePath = path.join(__dirname, '../data/posts.json');
    let backupPostsContent;

    beforeEach(() => {
      if (fs.existsSync(postsFilePath)) {
        backupPostsContent = fs.readFileSync(postsFilePath, 'utf8');
      } else {
        backupPostsContent = JSON.stringify([]);
      }
    });

    afterEach(() => {
      if (backupPostsContent !== undefined) {
        fs.writeFileSync(postsFilePath, backupPostsContent, 'utf8');
      }
    });

    test('a) Actualiza métricas sobre post existente y persiste en disco', () => {
      const initialPost = postService.save({
        briefing: 'Post para test de métricas',
        contentType: 'single'
      });

      const metricsData = {
        impressions: 100,
        reach: 80,
        saved: 5,
        origin: 'api',
        fetchedAt: new Date().toISOString()
      };

      const updated = postService.updateMetrics(initialPost.id, metricsData);

      assert.ok(updated);
      assert.equal(updated.id, initialPost.id);
      assert.deepEqual(updated.metrics.impressions, 100);
      assert.deepEqual(updated.metrics.reach, 80);
      assert.deepEqual(updated.metrics.saved, 5);
      assert.equal(updated.metrics.origin, 'api');

      // Verificar persistencia real recargando desde disco
      const reloaded = postService.getAll().find(p => p.id === initialPost.id);
      assert.ok(reloaded);
      assert.deepEqual(reloaded.metrics, updated.metrics);
    });

    test('b) Retorna null si el id no existe', () => {
      const res = postService.updateMetrics('id_inexistente_999999', { impressions: 10 });
      assert.strictEqual(res, null);
    });
  });

  // =========================================================================
  // 3. Pruebas de Endpoints HTTP en Express (server.js)
  // =========================================================================
  describe('3. Endpoints HTTP de Métricas (/api/posts/:id/metrics*)', () => {
    let server;
    let baseUrl;
    let originalGetAll;
    let originalUpdateMetrics;
    let originalGetMediaInsights;

    let inMemoryPosts = [];

    beforeEach(async () => {
      inMemoryPosts = [];

      originalGetAll = postService.getAll;
      originalUpdateMetrics = postService.updateMetrics;
      originalGetMediaInsights = instagramPublisher.getMediaInsights;

      postService.getAll = () => inMemoryPosts;
      postService.updateMetrics = (id, metricsData) => {
        const post = inMemoryPosts.find(p => p.id === id);
        if (!post) return null;
        post.metrics = {
          ...(post.metrics || {}),
          ...metricsData
        };
        return post;
      };

      // Iniciar servidor en puerto efímero
      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      postService.getAll = originalGetAll;
      postService.updateMetrics = originalUpdateMetrics;
      instagramPublisher.getMediaInsights = originalGetMediaInsights;

      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });

    // --- GET /api/posts/:id/metrics ---
    describe('GET /api/posts/:id/metrics', () => {
      test('404 si el post no existe', async () => {
        const res = await fetch(`${baseUrl}/api/posts/no_existe/metrics`);
        assert.equal(res.status, 404);
        const data = await res.json();
        assert.match(data.error, /Post no encontrado/);
      });

      test('200 con metrics: null si el post no tiene métricas registradas', async () => {
        inMemoryPosts.push({
          id: 'post_sin_metricas',
          briefing: 'Borrador sin publicar'
        });

        const res = await fetch(`${baseUrl}/api/posts/post_sin_metricas/metrics`);
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.strictEqual(data.metrics, null);
      });

      test('200 preservando distinción estricta de 0 vs null en las métricas', async () => {
        inMemoryPosts.push({
          id: 'post_con_ceros',
          metrics: {
            origin: 'api',
            fetchedAt: '2026-11-04T12:00:00.000Z',
            impressions: 0,
            reach: null,
            saved: 12
          }
        });

        const res = await fetch(`${baseUrl}/api/posts/post_con_ceros/metrics`);
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.success, true);
        assert.strictEqual(data.metrics.impressions, 0, 'impressions debe ser 0 exacto');
        assert.strictEqual(data.metrics.reach, null, 'reach debe ser null estricto');
        assert.strictEqual(data.metrics.saved, 12);
        assert.equal(data.metrics.origin, 'api');
      });
    });

    // --- POST /api/posts/:id/metrics/sync ---
    describe('POST /api/posts/:id/metrics/sync', () => {
      test('404 si el post no existe', async () => {
        const res = await fetch(`${baseUrl}/api/posts/inexistente/metrics/sync`, { method: 'POST' });
        assert.equal(res.status, 404);
      });

      test('400 si el post no cuenta con publishedPlatformIds.instagram', async () => {
        inMemoryPosts.push({
          id: 'post_solo_fb',
          publishedPlatformIds: { facebook: 'fb_12345' }
        });

        const res = await fetch(`${baseUrl}/api/posts/post_solo_fb/metrics/sync`, { method: 'POST' });
        assert.equal(res.status, 400);
        const data = await res.json();
        assert.match(data.error, /publishedPlatformIds\.instagram/);
      });

      test('400 si publishedPlatformIds está vacío o ausente', async () => {
        inMemoryPosts.push({
          id: 'post_sin_ids'
        });

        const res = await fetch(`${baseUrl}/api/posts/post_sin_ids/metrics/sync`, { method: 'POST' });
        assert.equal(res.status, 400);
      });

      test('200 con mensaje si el proveedor está en modo mock (sin credenciales)', async () => {
        inMemoryPosts.push({
          id: 'post_ig_mock',
          publishedPlatformIds: { instagram: 'ig_media_111' }
        });

        instagramPublisher.getMediaInsights = async () => ({
          success: false,
          mock: true,
          message: 'Credenciales de Meta no configuradas.'
        });

        const res = await fetch(`${baseUrl}/api/posts/post_ig_mock/metrics/sync`, { method: 'POST' });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.equal(data.mock, true);
        assert.match(data.message, /Credenciales de Meta no configuradas/);
      });

      test('502 si la llamada a Graph API falla', async () => {
        inMemoryPosts.push({
          id: 'post_ig_err',
          publishedPlatformIds: { instagram: 'ig_media_error' }
        });

        instagramPublisher.getMediaInsights = async () => ({
          success: false,
          error: 'Rate limit exceeded on Instagram Graph API'
        });

        const res = await fetch(`${baseUrl}/api/posts/post_ig_err/metrics/sync`, { method: 'POST' });
        assert.equal(res.status, 502);
        const data = await res.json();
        assert.equal(data.success, false);
        assert.match(data.error, /Rate limit exceeded/);
      });

      test('200 sincronización exitosa: actualiza origin: api, fetchedAt y persiste en post', async () => {
        inMemoryPosts.push({
          id: 'post_ig_ok',
          publishedPlatformIds: { instagram: 'ig_media_success' }
        });

        instagramPublisher.getMediaInsights = async (mediaId) => {
          assert.equal(mediaId, 'ig_media_success');
          return {
            success: true,
            mediaId,
            metrics: {
              impressions: 250,
              reach: 200,
              saved: 0, // Cero legítimo
              total_interactions: 35
            }
          };
        };

        const res = await fetch(`${baseUrl}/api/posts/post_ig_ok/metrics/sync`, { method: 'POST' });
        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.success, true);
        assert.equal(data.metrics.origin, 'api');
        assert.ok(data.metrics.fetchedAt, 'debe incluir fetchedAt');
        assert.strictEqual(data.metrics.impressions, 250);
        assert.strictEqual(data.metrics.reach, 200);
        assert.strictEqual(data.metrics.saved, 0, 'preserva cero como número');
        assert.strictEqual(data.metrics.total_interactions, 35);

        // Comprobar persistencia en postService
        const post = inMemoryPosts.find(p => p.id === 'post_ig_ok');
        assert.deepEqual(post.metrics, data.metrics);
      });
    });

    // --- POST /api/posts/:id/metrics/import ---
    describe('POST /api/posts/:id/metrics/import', () => {
      test('404 si el post no existe', async () => {
        const res = await fetch(`${baseUrl}/api/posts/inexistente/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ impressions: 50 })
        });
        assert.equal(res.status, 404);
      });

      test('400 si se envía un valor negativo', async () => {
        inMemoryPosts.push({ id: 'post_import_1' });

        const res = await fetch(`${baseUrl}/api/posts/post_import_1/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ impressions: -10, reach: 20 })
        });

        assert.equal(res.status, 400);
        const data = await res.json();
        assert.match(data.error, /no puede ser negativo/);
      });

      test('400 si se envía un tipo inválido (string no numérico, boolean, array)', async () => {
        inMemoryPosts.push({ id: 'post_import_2' });

        // Caso string inválida
        let res = await fetch(`${baseUrl}/api/posts/post_import_2/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ impressions: 'muchos' })
        });
        assert.equal(res.status, 400);

        // Caso boolean
        res = await fetch(`${baseUrl}/api/posts/post_import_2/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reach: true })
        });
        assert.equal(res.status, 400);

        // Caso array
        res = await fetch(`${baseUrl}/api/posts/post_import_2/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ saved: [1, 2] })
        });
        assert.equal(res.status, 400);
      });

      test('400 si el cuerpo no tiene campos de métricas', async () => {
        inMemoryPosts.push({ id: 'post_import_3' });

        const res = await fetch(`${baseUrl}/api/posts/post_import_3/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        assert.equal(res.status, 400);
      });

      test('200 importación exitosa con distinción estricta de 0 y null, asignando origin: manual', async () => {
        inMemoryPosts.push({ id: 'post_import_ok' });

        const payload = {
          impressions: 0,       // 0 legítimo
          reach: null,          // Ausente explícito
          saved: 42,
          likes: 0,             // 0 legítimo
          comments: 7
        };

        const res = await fetch(`${baseUrl}/api/posts/post_import_ok/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        assert.equal(res.status, 200);
        const data = await res.json();

        assert.equal(data.success, true);
        assert.equal(data.metrics.origin, 'manual');
        assert.ok(data.metrics.fetchedAt);

        // Verificaciones de valores y tipos estrictos
        assert.strictEqual(data.metrics.impressions, 0);
        assert.strictEqual(typeof data.metrics.impressions, 'number');

        assert.strictEqual(data.metrics.reach, null);
        assert.notStrictEqual(data.metrics.reach, 0);

        assert.strictEqual(data.metrics.saved, 42);
        assert.strictEqual(data.metrics.likes, 0);
        assert.strictEqual(data.metrics.comments, 7);

        // Comprobar persistencia en postService
        const post = inMemoryPosts.find(p => p.id === 'post_import_ok');
        assert.deepEqual(post.metrics, data.metrics);
      });

      test('200 importación anidada bajo body.metrics también es soportada', async () => {
        inMemoryPosts.push({ id: 'post_import_nested' });

        const res = await fetch(`${baseUrl}/api/posts/post_import_nested/metrics/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metrics: {
              impressions: 500,
              reach: 350
            }
          })
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.success, true);
        assert.strictEqual(data.metrics.impressions, 500);
        assert.strictEqual(data.metrics.reach, 350);
        assert.equal(data.metrics.origin, 'manual');
      });
    });

  });

});
