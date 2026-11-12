const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const botStateService = require('../services/botStateService');
const scheduler = require('../automation/scheduler');
const orchestrator = require('../core/AgentOrchestrator');
const experimentService = require('../services/experimentService');
const postService = require('../services/postService');
const agroImageService = require('../services/agroImageService');
const Agent = require('../agents/Agent');

describe('WEEKLY-001: Planificación Semanal Basada en Métricas y Conmutación de Proveedor', () => {

  describe('1. Conmutación dinámica de proveedor (MEDIA_PROVIDER)', () => {
    const originalMediaProvider = process.env.MEDIA_PROVIDER;
    const originalImageProvider = process.env.IMAGE_PROVIDER;
    const originalVideoProvider = process.env.VIDEO_PROVIDER;

    after(() => {
      process.env.MEDIA_PROVIDER = originalMediaProvider;
      process.env.IMAGE_PROVIDER = originalImageProvider;
      process.env.VIDEO_PROVIDER = originalVideoProvider;
    });

    test('a) Resuelve "poe" cuando MEDIA_PROVIDER=poe', () => {
      process.env.MEDIA_PROVIDER = 'poe';
      delete process.env.IMAGE_PROVIDER;
      delete process.env.VIDEO_PROVIDER;

      const { resolvedImage, resolvedVideo } = orchestrator._resolveMediaProviders();
      assert.equal(resolvedImage, 'poe');
      assert.equal(resolvedVideo, 'poe');
    });

    test('b) Resuelve "google" cuando MEDIA_PROVIDER=google', () => {
      process.env.MEDIA_PROVIDER = 'google';
      delete process.env.IMAGE_PROVIDER;
      delete process.env.VIDEO_PROVIDER;

      const { resolvedImage, resolvedVideo } = orchestrator._resolveMediaProviders();
      assert.equal(resolvedImage, 'google');
      assert.equal(resolvedVideo, 'google');
    });

    test('c) Permite configuración granular con IMAGE_PROVIDER y VIDEO_PROVIDER', () => {
      delete process.env.MEDIA_PROVIDER;
      process.env.IMAGE_PROVIDER = 'poe';
      process.env.VIDEO_PROVIDER = 'google';

      const { resolvedImage, resolvedVideo } = orchestrator._resolveMediaProviders();
      assert.equal(resolvedImage, 'poe');
      assert.equal(resolvedVideo, 'google');
    });

    test('d) agroImageService y Agent resuelven Poe para imágenes y vídeos cuando MEDIA_PROVIDER=poe', () => {
      process.env.MEDIA_PROVIDER = 'poe';
      delete process.env.IMAGE_PROVIDER;
      delete process.env.VIDEO_PROVIDER;

      assert.equal(agroImageService._resolveImageProvider(), 'poe');

      const testAgent = new Agent('TestDesigner', 'visual-designer', 'image');
      const { imageProvider, videoProvider } = testAgent._resolveMediaProviders({});
      assert.equal(imageProvider, 'poe');
      assert.equal(videoProvider, 'poe');
    });

    test('e) agroImageService y Agent resuelven Google para imágenes y vídeos cuando MEDIA_PROVIDER=google', () => {
      process.env.MEDIA_PROVIDER = 'google';
      delete process.env.IMAGE_PROVIDER;
      delete process.env.VIDEO_PROVIDER;

      assert.equal(agroImageService._resolveImageProvider(), 'google');

      const testAgent = new Agent('TestDesigner', 'visual-designer', 'image');
      const { imageProvider, videoProvider } = testAgent._resolveMediaProviders({});
      assert.equal(imageProvider, 'google');
      assert.equal(videoProvider, 'google');
    });

    test('f) Agent._assertValidMediaResult rechaza respuestas sin url o con success: false', () => {
      const testAgent = new Agent('TestDesigner', 'visual-designer', 'image');
      assert.throws(() => testAgent._assertValidMediaResult({ success: false, error: 'HTTP 400' }, 'Poe', 'imagen'), /HTTP 400/);
      assert.throws(() => testAgent._assertValidMediaResult({ success: true }, 'Poe', 'imagen'), /no devolvió una URL/);
      assert.throws(() => testAgent._assertValidMediaResult(null, 'Poe', 'imagen'), /no devolvió una URL/);
      const ok = testAgent._assertValidMediaResult({ success: true, url: 'http://localhost:3001/output/poe/test.png' }, 'Poe', 'imagen');
      assert.equal(ok.url, 'http://localhost:3001/output/poe/test.png');
    });
  });

  describe('2. Generación de Calendario Semanal enriquecido con rutinas agro', () => {
    test('a) Estructura de semana incluye creatividades y preserva rutinas agro (noticias y precios)', () => {
      const creativeWeekly = [
        {
          day: 3,
          hour: '17:30',
          format: 'carousel',
          concept: '3 errores en albaranes',
          angle: 'albaranes',
          hypothesis: { expectedOutcome: 'Aumentar guardados', audience: 'horticultores' }
        },
        {
          day: 5,
          hour: '18:00',
          format: 'single',
          concept: 'Control de fertirriego',
          angle: 'costes',
          hypothesis: { expectedOutcome: 'Aumentar comentarios', audience: 'técnicos agrícolas' }
        }
      ];

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 7 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeWeekly, dateContext, {
        protectAgroRoutines: true
      });

      // Debe incluir las creatividades
      const carousels = enriched.filter(e => e.format === 'carousel');
      assert.equal(carousels.length, 1);
      assert.equal(carousels[0].day, 3);

      // Debe incluir noticias diarias (news-post)
      const news = enriched.filter(e => e.format === 'news-post');
      assert.ok(news.length >= 6, 'Debe programar noticias en la semana');

      // Debe incluir precios (price-story) de lunes a sábado
      const prices = enriched.filter(e => e.format === 'price-story');
      assert.ok(prices.length >= 5, 'Debe programar stories de precios');
    });
  });

  describe('3. Configuración y persistencia del Modo de Planificación (Mensual vs Semanal)', () => {
    test('a) getPlanningMode devuelve valor por defecto si no está definido', () => {
      const mode = botStateService.getPlanningMode();
      assert.ok(mode === 'monthly' || mode === 'weekly');
    });

    test('b) setPlanningMode("weekly") actualiza y persiste el modo semanal', () => {
      botStateService.setPlanningMode('weekly');
      assert.equal(botStateService.getPlanningMode(), 'weekly');
      const state = botStateService.getState();
      assert.equal(state.planningMode, 'weekly');
    });

    test('c) setPlanningMode("monthly") actualiza y persiste el modo mensual', () => {
      botStateService.setPlanningMode('monthly');
      assert.equal(botStateService.getPlanningMode(), 'monthly');
      const state = botStateService.getState();
      assert.equal(state.planningMode, 'monthly');
    });

    test('d) setPlanningMode rechaza modos desconocidos con excepción clara', () => {
      assert.throws(() => {
        botStateService.setPlanningMode('anual');
      }, /Modo de planificación inválido/);
    });
  });
});
