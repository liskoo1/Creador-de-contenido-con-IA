const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { app, experimentService } = require('../server');
const postService = require('../services/postService');

describe('EXP-001: Experimentos y Revisión Basada en Evidencia para Helpmeagro', () => {

  // =========================================================================
  // 1. Pruebas Unitarias de calculateSRR(saved, reach)
  // =========================================================================
  describe('1. calculateSRR(saved, reach)', () => {
    test('a) Cálculo normal exacto: saved=50, reach=1000 -> 5%', () => {
      const srr = experimentService.calculateSRR(50, 1000);
      assert.strictEqual(srr, 5);
      assert.strictEqual(typeof srr, 'number');
    });

    test('b) Cálculo con decimales redondeado a 2 cifras: saved=1, reach=3 -> 33.33%', () => {
      const srr = experimentService.calculateSRR(1, 3);
      assert.strictEqual(srr, 33.33);
    });

    test('c) saved=0 con reach>0 devuelve 0 legítimo numérico, no null', () => {
      const srr = experimentService.calculateSRR(0, 500);
      assert.strictEqual(srr, 0);
      assert.notStrictEqual(srr, null);
    });

    test('d) Protección contra división por cero: reach=0 devuelve null', () => {
      const srr = experimentService.calculateSRR(10, 0);
      assert.strictEqual(srr, null);
    });

    test('e) Valores negativos devuelven null (reach o saved inválidos)', () => {
      assert.strictEqual(experimentService.calculateSRR(-5, 100), null);
      assert.strictEqual(experimentService.calculateSRR(50, -100), null);
      assert.strictEqual(experimentService.calculateSRR(-1, -1), null);
    });

    test('f) Valores null o undefined devuelven null estrictamente', () => {
      assert.strictEqual(experimentService.calculateSRR(null, 500), null);
      assert.strictEqual(experimentService.calculateSRR(50, null), null);
      assert.strictEqual(experimentService.calculateSRR(null, null), null);
      assert.strictEqual(experimentService.calculateSRR(undefined, 100), null);
      assert.strictEqual(experimentService.calculateSRR(50, undefined), null);
      assert.strictEqual(experimentService.calculateSRR(undefined, undefined), null);
    });

    test('g) Tipos no numéricos (strings, booleans, objetos, arrays) devuelven null', () => {
      assert.strictEqual(experimentService.calculateSRR('50', '1000'), null);
      assert.strictEqual(experimentService.calculateSRR(true, 100), null);
      assert.strictEqual(experimentService.calculateSRR({ saved: 10 }, 100), null);
      assert.strictEqual(experimentService.calculateSRR([10], 100), null);
    });

    test('h) Protección contra NaN e Infinity: nunca devuelve NaN ni Infinity', () => {
      assert.strictEqual(experimentService.calculateSRR(NaN, 100), null);
      assert.strictEqual(experimentService.calculateSRR(10, NaN), null);
      assert.strictEqual(experimentService.calculateSRR(Infinity, 100), null);
      assert.strictEqual(experimentService.calculateSRR(10, Infinity), null);
    });
  });

  // =========================================================================
  // 2. Normalización de formato y detección de métricas
  // =========================================================================
  describe('2. Normalización de formato y detección de métricas', () => {
    test('a) resolvePostFormat asigna correctamente formatos estándar y contentType alternativos', () => {
      assert.strictEqual(experimentService.resolvePostFormat({ format: 'carousel' }), 'carousel');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'carousel' }), 'carousel');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'video' }), 'reel');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'audio-reel' }), 'reel');
      assert.strictEqual(experimentService.resolvePostFormat({ format: 'reel' }), 'reel');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'single' }), 'single');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'image' }), 'single');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'flyer' }), 'single');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'news-post' }), 'news-post');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'news' }), 'news-post');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'price-story' }), 'price-story');
      assert.strictEqual(experimentService.resolvePostFormat({ contentType: 'story' }), 'price-story');
      assert.strictEqual(experimentService.resolvePostFormat(null), 'single');
    });

    test('b) isPostMeasured reconoce posts medidos y pendientes de métricas', () => {
      assert.strictEqual(experimentService.isPostMeasured({ metrics: null }), false);
      assert.strictEqual(experimentService.isPostMeasured({ metrics: undefined }), false);
      assert.strictEqual(experimentService.isPostMeasured({}), false);
      assert.strictEqual(experimentService.isPostMeasured({ metrics: {} }), false);
      assert.strictEqual(experimentService.isPostMeasured({ metrics: { reach: null, saved: null } }), false);
      assert.strictEqual(experimentService.isPostMeasured({ metrics: { reach: 150 } }), true);
      assert.strictEqual(experimentService.isPostMeasured({ metrics: { saved: 0 } }), true);
      assert.strictEqual(experimentService.isPostMeasured({ metrics: { impressions: 300 } }), true);
    });
  });

  // =========================================================================
  // 3. Agregaciones y exclusión de posts sin métricas
  // =========================================================================
  describe('3. Agregaciones de analyzeExperiments(posts)', () => {
    test('a) Exclusión de posts sin métricas en los promedios de reach, saved y SRR', () => {
      const samplePosts = [
        {
          id: 'post_1',
          format: 'carousel',
          metrics: { reach: 1000, saved: 50 } // SRR = 5%
        },
        {
          id: 'post_2',
          format: 'carousel',
          metrics: { reach: 2000, saved: 200 } // SRR = 10%
        },
        {
          id: 'post_3',
          format: 'carousel',
          metrics: null // pending_metrics
        },
        {
          id: 'post_4',
          format: 'carousel',
          metrics: { reach: null, saved: null } // pending_metrics
        }
      ];

      const analysis = experimentService.analyzeExperiments(samplePosts);

      const carousel = analysis.byFormat.carousel;
      assert.strictEqual(carousel.totalPosts, 4);
      assert.strictEqual(carousel.measuredPosts, 2);
      assert.strictEqual(carousel.pendingMetricsPosts, 2);

      // Promedios solo de los 2 medidos: reach = (1000 + 2000) / 2 = 1500
      assert.strictEqual(carousel.averageReach, 1500);
      // saved = (50 + 200) / 2 = 125
      assert.strictEqual(carousel.averageSaved, 125);
      // SRR = (5 + 10) / 2 = 7.5
      assert.strictEqual(carousel.averageSRR, 7.5);

      // Top performer debe ser post_2 con SRR = 10
      assert.ok(carousel.topPerformer);
      assert.strictEqual(carousel.topPerformer.id, 'post_2');
      assert.strictEqual(carousel.topPerformer.srr, 10);
    });

    test('b) Manejo de formato sin publicaciones o sin posts medidos', () => {
      const samplePosts = [
        {
          id: 'post_reel_pending',
          contentType: 'video', // -> reel
          metrics: null
        }
      ];

      const analysis = experimentService.analyzeExperiments(samplePosts);

      const reel = analysis.byFormat.reel;
      assert.strictEqual(reel.totalPosts, 1);
      assert.strictEqual(reel.measuredPosts, 0);
      assert.strictEqual(reel.pendingMetricsPosts, 1);
      assert.strictEqual(reel.averageReach, null);
      assert.strictEqual(reel.averageSaved, null);
      assert.strictEqual(reel.averageSRR, null);
      assert.strictEqual(reel.topPerformer, null);

      // single tiene 0 posts
      const single = analysis.byFormat.single;
      assert.strictEqual(single.totalPosts, 0);
      assert.strictEqual(single.measuredPosts, 0);
      assert.strictEqual(single.pendingMetricsPosts, 0);
      assert.strictEqual(single.averageReach, null);
      assert.strictEqual(single.topPerformer, null);
    });

    test('c) Resumen global y lista detallada enriquecida', () => {
      const samplePosts = [
        {
          id: 'p_car',
          contentType: 'carousel',
          hypothesis: { angle: 'Técnico SIGPAC' },
          metrics: { reach: 500, saved: 25 } // SRR = 5
        },
        {
          id: 'p_reel',
          contentType: 'video',
          metrics: { reach: 800, saved: 80 } // SRR = 10
        }
      ];

      const analysis = experimentService.analyzeExperiments(samplePosts);

      assert.strictEqual(analysis.summary.totalPosts, 2);
      assert.strictEqual(analysis.summary.measuredPosts, 2);
      assert.strictEqual(analysis.summary.averageReach, 650);
      assert.strictEqual(analysis.summary.averageSRR, 7.5);
      assert.strictEqual(analysis.summary.topPerformer.id, 'p_reel');

      assert.strictEqual(analysis.posts.length, 2);
      const post1 = analysis.posts.find(p => p.id === 'p_car');
      assert.strictEqual(post1.format, 'carousel');
      assert.strictEqual(post1.srr, 5);
      assert.strictEqual(post1.status, 'measured');
      assert.strictEqual(post1.hypothesis.angle, 'Técnico SIGPAC');
    });
  });

  // =========================================================================
  // 4. Servicio setPostHypothesis(postId, hypothesisData)
  // =========================================================================
  describe('4. setPostHypothesis(postId, hypothesisData)', () => {
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

    test('a) Lanza error 404 si el postId no existe', () => {
      assert.throws(
        () => experimentService.setPostHypothesis('inexistente_9999', { angle: 'Ángulo test' }),
        err => {
          assert.strictEqual(err.statusCode, 404);
          assert.match(err.message, /no encontrado/);
          return true;
        }
      );
    });

    test('b) Lanza error 400 si falta el campo angle o está vacío', () => {
      const created = postService.save({ briefing: 'Test post hypothesis' });

      assert.throws(
        () => experimentService.setPostHypothesis(created.id, {}),
        err => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /'angle' es obligatorio/);
          return true;
        }
      );

      assert.throws(
        () => experimentService.setPostHypothesis(created.id, { angle: '   ' }),
        err => {
          assert.strictEqual(err.statusCode, 400);
          return true;
        }
      );
    });

    test('c) Lanza error 400 si status no es uno de active, validated, invalidated', () => {
      const created = postService.save({ briefing: 'Test post hypothesis status' });

      assert.throws(
        () => experimentService.setPostHypothesis(created.id, { angle: 'Ángulo', status: 'otro_estado' }),
        err => {
          assert.strictEqual(err.statusCode, 400);
          assert.match(err.message, /debe ser uno de/);
          return true;
        }
      );
    });

    test('d) Registra y persiste hipótesis exitosamente con createdAt y updatedAt', () => {
      const created = postService.save({ briefing: 'Test post OK' });

      const hypothesisData = {
        angle: 'Dolor burocrático Cuaderno de Campo',
        expectedOutcome: 'Aumentar guardados un 20%',
        notes: 'Público objetivo: agricultores de Almería',
        status: 'active'
      };

      const updated = experimentService.setPostHypothesis(created.id, hypothesisData);

      assert.ok(updated);
      assert.ok(updated.hypothesis);
      assert.strictEqual(updated.hypothesis.angle, hypothesisData.angle);
      assert.strictEqual(updated.hypothesis.expectedOutcome, hypothesisData.expectedOutcome);
      assert.strictEqual(updated.hypothesis.notes, hypothesisData.notes);
      assert.strictEqual(updated.hypothesis.status, 'active');
      assert.ok(updated.hypothesis.createdAt);
      assert.ok(updated.hypothesis.updatedAt);

      // Verificar persistencia real
      const reloaded = postService.getAll().find(p => p.id === created.id);
      assert.deepEqual(reloaded.hypothesis, updated.hypothesis);
    });
  });

  // =========================================================================
  // 5. Endpoints HTTP (/api/experiments y /api/posts/:id/hypothesis)
  // =========================================================================
  describe('5. Endpoints HTTP de Experimentos', () => {
    let server;
    let baseUrl;
    let originalGetAll;
    let originalUpdate;
    let inMemoryPosts = [];

    beforeEach(async () => {
      inMemoryPosts = [];

      originalGetAll = postService.getAll;
      originalUpdate = postService.update;

      postService.getAll = () => inMemoryPosts;
      postService.update = (id, updates) => {
        const post = inMemoryPosts.find(p => p.id === id);
        if (!post) return null;
        Object.assign(post, updates);
        return post;
      };

      server = app.listen(0);
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
    });

    afterEach(async () => {
      postService.getAll = originalGetAll;
      postService.update = originalUpdate;

      if (server) {
        await new Promise(resolve => server.close(resolve));
      }
    });

    test('a) GET /api/experiments retorna análisis agregado y detalle de posts', async () => {
      inMemoryPosts.push(
        {
          id: 'post_http_1',
          contentType: 'carousel',
          metrics: { reach: 400, saved: 20 } // SRR = 5%
        },
        {
          id: 'post_http_2',
          contentType: 'video', // -> reel
          metrics: { reach: 800, saved: 80 } // SRR = 10%
        },
        {
          id: 'post_http_3',
          contentType: 'single',
          metrics: null // pending_metrics
        }
      );

      const res = await fetch(`${baseUrl}/api/experiments`);
      assert.strictEqual(res.status, 200);

      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.ok(body.data);
      assert.strictEqual(body.data.summary.totalPosts, 3);
      assert.strictEqual(body.data.summary.measuredPosts, 2);
      assert.strictEqual(body.data.summary.pendingMetricsPosts, 1);
      assert.strictEqual(body.data.summary.averageReach, 600);
      assert.strictEqual(body.data.summary.averageSaved, 50);
      assert.strictEqual(body.data.summary.averageSRR, 7.5);

      assert.strictEqual(body.data.byFormat.carousel.totalPosts, 1);
      assert.strictEqual(body.data.byFormat.reel.totalPosts, 1);
      assert.strictEqual(body.data.byFormat.single.totalPosts, 1);

      assert.strictEqual(body.data.posts.length, 3);
    });

    test('b) POST /api/posts/:id/hypothesis: 404 si el post no existe', async () => {
      const res = await fetch(`${baseUrl}/api/posts/post_inexistente/hypothesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ angle: 'Nuevo ángulo editorial' })
      });

      assert.strictEqual(res.status, 404);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /no encontrado/);
    });

    test('c) POST /api/posts/:id/hypothesis: 400 si falta el ángulo', async () => {
      inMemoryPosts.push({ id: 'post_val_1' });

      const res = await fetch(`${baseUrl}/api/posts/post_val_1/hypothesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedOutcome: 'Mayor alcance' })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /'angle' es obligatorio/);
    });

    test('d) POST /api/posts/:id/hypothesis: 400 si status es inválido', async () => {
      inMemoryPosts.push({ id: 'post_val_2' });

      const res = await fetch(`${baseUrl}/api/posts/post_val_2/hypothesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ angle: 'Ángulo', status: 'invalid_status' })
      });

      assert.strictEqual(res.status, 400);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /status/);
    });

    test('e) POST /api/posts/:id/hypothesis: 200 actualiza exitosamente la hipótesis', async () => {
      inMemoryPosts.push({ id: 'post_ok_1', briefing: 'Post de prueba' });

      const payload = {
        angle: 'Eficiencia en Cuaderno de Campo Digital',
        expectedOutcome: 'SRR > 6%',
        notes: 'Enfoque técnico con pantallazo real',
        status: 'validated'
      };

      const res = await fetch(`${baseUrl}/api/posts/post_ok_1/hypothesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.post);
      assert.strictEqual(data.post.hypothesis.angle, payload.angle);
      assert.strictEqual(data.post.hypothesis.expectedOutcome, payload.expectedOutcome);
      assert.strictEqual(data.post.hypothesis.notes, payload.notes);
      assert.strictEqual(data.post.hypothesis.status, 'validated');
      assert.ok(data.post.hypothesis.createdAt);
      assert.ok(data.post.hypothesis.updatedAt);
    });
  });

});
