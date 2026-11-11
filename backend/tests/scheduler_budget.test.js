const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const botStateService = require('../services/botStateService');
const scheduler = require('../automation/scheduler');

const STATE_PATH = path.join(__dirname, '../data/botState.json');

describe('PLAN-001: Presupuesto Editorial y Cupo Unificado del Calendario', () => {
  let originalStateContent = null;
  let originalBudget = null;

  before(() => {
    if (fs.existsSync(STATE_PATH)) {
      originalStateContent = fs.readFileSync(STATE_PATH, 'utf8');
    }
    originalBudget = botStateService.getEditorialBudget();
  });

  after(() => {
    // Restaurar el estado original en disco tras ejecutar la suite
    if (originalStateContent !== null) {
      fs.writeFileSync(STATE_PATH, originalStateContent);
    } else if (originalBudget) {
      botStateService.updateEditorialBudget(originalBudget);
    }
  });

  // =========================================================================
  // a) Lectura y actualización de editorialBudget en botStateService
  // =========================================================================
  describe('a) botStateService - Lectura y actualización de editorialBudget', () => {
    it('devuelve valores por defecto cuando no se han modificado', () => {
      const budget = botStateService.getEditorialBudget();
      assert.equal(typeof budget, 'object');
      assert.equal(typeof budget.maxDailyFeedPosts, 'number');
      assert.equal(typeof budget.maxMonthlyFeedPosts, 'number');
      assert.equal(typeof budget.allowNewsOnCreativeDays, 'boolean');
      assert.equal(typeof budget.includePriceStoriesInFeedBudget, 'boolean');

      assert.equal(budget.maxDailyFeedPosts, 1);
      assert.equal(budget.maxMonthlyFeedPosts, 24);
      assert.equal(budget.allowNewsOnCreativeDays, false);
      assert.equal(budget.includePriceStoriesInFeedBudget, false);
    });

    it('actualiza campos del presupuesto y los persiste en disco', () => {
      const updated = botStateService.updateEditorialBudget({
        maxMonthlyFeedPosts: 20,
        maxDailyFeedPosts: 2,
        allowNewsOnCreativeDays: true,
        includePriceStoriesInFeedBudget: true
      });

      assert.equal(updated.maxMonthlyFeedPosts, 20);
      assert.equal(updated.maxDailyFeedPosts, 2);
      assert.equal(updated.allowNewsOnCreativeDays, true);
      assert.equal(updated.includePriceStoriesInFeedBudget, true);

      // Verificación de lectura directa tras escritura
      const current = botStateService.getEditorialBudget();
      assert.deepEqual(current, updated);

      // Verificación en getState()
      const fullState = botStateService.getState();
      assert.deepEqual(fullState.editorialBudget, updated);
    });

    it('permite actualizaciones parciales conservando los campos omitidos', () => {
      botStateService.updateEditorialBudget({
        maxMonthlyFeedPosts: 28
      });

      const current = botStateService.getEditorialBudget();
      assert.equal(current.maxMonthlyFeedPosts, 28);
      // Los otros campos conservan el valor previamente establecido
      assert.equal(current.maxDailyFeedPosts, 2);
      assert.equal(current.allowNewsOnCreativeDays, true);
    });

    it('valida entradas inválidas y rechaza tipos no válidos', () => {
      assert.throws(() => {
        botStateService.updateEditorialBudget(null);
      }, /objeto válido/i);

      assert.throws(() => {
        botStateService.updateEditorialBudget('string');
      }, /objeto válido/i);

      assert.throws(() => {
        botStateService.updateEditorialBudget([]);
      }, /objeto válido/i);
    });

    it('resetea a valores estándar de prueba para los tests siguientes', () => {
      const budget = botStateService.updateEditorialBudget({
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: false,
        includePriceStoriesInFeedBudget: false
      });
      assert.equal(budget.maxDailyFeedPosts, 1);
      assert.equal(budget.maxMonthlyFeedPosts, 24);
      assert.equal(budget.allowNewsOnCreativeDays, false);
      assert.equal(budget.includePriceStoriesInFeedBudget, false);
    });
  });

  // =========================================================================
  // b) Control de cupo diario: en días con creatividad no se duplica con noticia
  // =========================================================================
  describe('b) Control de cupo diario (maxDailyFeedPosts: 1)', () => {
    const isFeed = (item) => item.format !== 'price-story' && item.format !== 'story';

    it('NO inyecta noticia en días que ya tienen contenido creativo si allowNewsOnCreativeDays=false', () => {
      // Mes de Noviembre 2026 (30 días). Creatividades en días 2, 4, 6
      const creativeSchedule = [
        { day: 2, hour: '18:00', format: 'single', concept: 'Post creativo 1' },
        { day: 4, hour: '19:00', format: 'carousel', concept: 'Post creativo 2' },
        { day: 6, hour: '20:00', format: 'video', concept: 'Post creativo 3' }
      ];

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 }; // Nov 2026
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: false
      });

      // Días con creatividad: no debe existir noticia
      for (const creativeDay of [2, 4, 6]) {
        const dayEntries = enriched.filter(e => e.day === creativeDay);
        const dayFeedEntries = dayEntries.filter(isFeed);
        const newsEntry = dayEntries.find(e => e.format === 'news-post');

        assert.equal(newsEntry, undefined, `El día ${creativeDay} no debe tener noticia`);
        assert.equal(dayFeedEntries.length, 1, `El día ${creativeDay} debe tener exactamente 1 post de feed`);
        assert.notEqual(dayFeedEntries[0].format, 'news-post');
      }

      // Días sin creatividad: las noticias actúan como relleno
      const day3Entries = enriched.filter(e => e.day === 3);
      const day3FeedEntries = day3Entries.filter(isFeed);
      assert.equal(day3FeedEntries.length, 1, 'El día 3 (sin creatividad) debe tener 1 noticia como relleno');
      assert.equal(day3FeedEntries[0].format, 'news-post');
      assert.equal(day3FeedEntries[0].hour, '12:30', 'Hora estándar para noticia sin creatividad es 12:30');
    });

    it('si allowNewsOnCreativeDays=true y maxDailyFeedPosts=2, permite noticia a las 10:00', () => {
      const creativeSchedule = [
        { day: 5, hour: '18:00', format: 'single', concept: 'Creatividad día 5' }
      ];

      const dateContext = { year: 2026, month: 10, startDay: 5, daysInMonth: 5 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 2,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: true
      });

      const day5Feed = enriched.filter(e => e.day === 5 && isFeed(e));
      assert.equal(day5Feed.length, 2, 'El día 5 debe tener 2 posts de feed (creativa + noticia)');

      const newsPost = day5Feed.find(e => e.format === 'news-post');
      assert.ok(newsPost, 'Debe haber un post de noticia');
      assert.equal(newsPost.hour, '10:00', 'En días creativos con noticia permitida, la noticia va a las 10:00');
    });

    it('si allowNewsOnCreativeDays=true pero maxDailyFeedPosts=1, respeta el cupo diario de 1 y NO inyecta noticia', () => {
      const creativeSchedule = [
        { day: 5, hour: '18:00', format: 'single', concept: 'Creatividad día 5' }
      ];

      const dateContext = { year: 2026, month: 10, startDay: 5, daysInMonth: 5 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: true
      });

      const day5Feed = enriched.filter(e => e.day === 5 && isFeed(e));
      assert.equal(day5Feed.length, 1, 'No debe superar maxDailyFeedPosts=1');
      assert.equal(day5Feed[0].format, 'single');
    });
  });

  // =========================================================================
  // c) Control de cupo mensual: creativas + noticias no excede maxMonthlyFeedPosts
  // =========================================================================
  describe('c) Control de cupo mensual (maxMonthlyFeedPosts)', () => {
    const isFeed = (item) => item.format !== 'price-story' && item.format !== 'story';

    it('con 10 creativas y límite 24, inyecta exactamente 14 noticias de relleno (total = 24)', () => {
      // 10 creativas repartidas en días pares del 2 al 20
      const creativeSchedule = Array.from({ length: 10 }, (_, i) => ({
        day: (i + 1) * 2,
        hour: '17:00',
        format: 'single',
        concept: `Creativo ${i + 1}`
      }));

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: false
      });

      const feedPosts = enriched.filter(isFeed);
      const creativePosts = feedPosts.filter(e => e.format !== 'news-post');
      const newsPosts = feedPosts.filter(e => e.format === 'news-post');

      assert.equal(creativePosts.length, 10, 'Conserva todas las 10 creatividades');
      assert.equal(newsPosts.length, 14, 'Inyecta exactamente 14 noticias de relleno');
      assert.equal(feedPosts.length, 24, 'El total de publicaciones de feed es exactamente 24 (el límite)');

      // Días restantes sin noticias después de alcanzar el presupuesto
      // Había 20 días sin creatividad, pero solo 14 cupos disponibles de noticias
      const emptyDaysWithoutPost = [];
      for (let d = 1; d <= 30; d++) {
        const hasFeed = feedPosts.some(e => e.day === d);
        if (!hasFeed) emptyDaysWithoutPost.push(d);
      }
      assert.equal(emptyDaysWithoutPost.length, 6, 'Exactamente 6 días quedan sin post de feed al agotarse el cupo');
    });

    it('si las creativas ya alcanzan el presupuesto mensual (24), NO inyecta ninguna noticia (0 noticias)', () => {
      const creativeSchedule = Array.from({ length: 24 }, (_, i) => ({
        day: i + 1,
        hour: '17:00',
        format: 'carousel',
        concept: `Creativo ${i + 1}`
      }));

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: false
      });

      const feedPosts = enriched.filter(isFeed);
      const newsPosts = feedPosts.filter(e => e.format === 'news-post');

      assert.equal(newsPosts.length, 0, 'No debe inyectar ninguna noticia cuando el cupo ya está completo');
      assert.equal(feedPosts.length, 24, 'Total de posts de feed permanece exactamente en 24');
    });

    it('con 0 creativas en el mes, inyecta noticias hasta el cupo mensual configurado', () => {
      const creativeSchedule = [];
      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 16,
        allowNewsOnCreativeDays: false
      });

      const feedPosts = enriched.filter(isFeed);
      assert.equal(feedPosts.length, 16, 'Inyecta exactamente 16 noticias para cumplir el cupo de 16');
      assert.ok(feedPosts.every(e => e.format === 'news-post'));
    });

    it('la suma de creativas y noticias nunca sobrepasa maxMonthlyFeedPosts', () => {
      const testCases = [
        { creativesCount: 5, budget: 12, expectedNews: 7, expectedTotal: 12 },
        { creativesCount: 15, budget: 15, expectedNews: 0, expectedTotal: 15 },
        { creativesCount: 18, budget: 20, expectedNews: 2, expectedTotal: 20 },
        { creativesCount: 8, budget: 10, expectedNews: 2, expectedTotal: 10 }
      ];

      for (const tc of testCases) {
        const creativeSchedule = Array.from({ length: tc.creativesCount }, (_, i) => ({
          day: i + 1,
          hour: '16:00',
          format: 'single',
          concept: `Post ${i + 1}`
        }));

        const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 };
        const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
          maxDailyFeedPosts: 1,
          maxMonthlyFeedPosts: tc.budget,
          allowNewsOnCreativeDays: false
        });

        const feedPosts = enriched.filter(isFeed);
        const newsPosts = feedPosts.filter(e => e.format === 'news-post');

        assert.equal(feedPosts.length, tc.expectedTotal, `Caso budget=${tc.budget}: total esperado=${tc.expectedTotal}`);
        assert.equal(newsPosts.length, tc.expectedNews, `Caso budget=${tc.budget}: noticias esperadas=${tc.expectedNews}`);
        assert.ok(feedPosts.length <= tc.budget, `El total ${feedPosts.length} no debe superar ${tc.budget}`);
      }
    });
  });

  // =========================================================================
  // d) Carril independiente para price-story
  // =========================================================================
  describe('d) Carril independiente para price-story (Lunes a Sábado)', () => {
    const isFeed = (item) => item.format !== 'price-story' && item.format !== 'story';

    it('se generan stories de precios de lunes a sábado y se omiten los domingos', () => {
      // Noviembre 2026:
      // Día 1 es Domingo (dayOfWeek = 0)
      // Día 2 es Lunes (dayOfWeek = 1)
      // Día 7 es Sábado (dayOfWeek = 6)
      // Día 8 es Domingo (dayOfWeek = 0)
      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 8 };
      const enriched = scheduler.enrichScheduleWithBudget([], dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        includePriceStoriesInFeedBudget: false
      });

      const priceStories = enriched.filter(e => e.format === 'price-story');

      // Domingos (días 1 y 8): no deben tener price-story
      assert.ok(!priceStories.some(e => e.day === 1), 'Domingo día 1 NO debe tener price-story');
      assert.ok(!priceStories.some(e => e.day === 8), 'Domingo día 8 NO debe tener price-story');

      // Días 2 a 7 (lunes a sábado): deben tener price-story
      for (let d = 2; d <= 7; d++) {
        const hasPrice = priceStories.some(e => e.day === d);
        assert.ok(hasPrice, `Día ${d} (laborable) DEBE tener price-story`);
      }
    });

    it('las price-story NO consumen cupo de feed por defecto (includePriceStoriesInFeedBudget: false)', () => {
      // En Noviembre 2026 (30 días), hay exactamente 25 días de lunes a sábado (5 domingos: 1, 8, 15, 22, 29).
      const expectedWorkDays = Array.from({ length: 30 }, (_, i) => new Date(2026, 10, i + 1).getDay())
        .filter(d => d !== 0).length;

      const creativeSchedule = Array.from({ length: 12 }, (_, i) => ({
        day: (i + 1) * 2,
        hour: '18:00',
        format: 'single',
        concept: `Creatividad ${i + 1}`
      }));

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 24,
        includePriceStoriesInFeedBudget: false
      });

      const feedPosts = enriched.filter(isFeed);
      const priceStories = enriched.filter(e => e.format === 'price-story');

      assert.equal(feedPosts.length, 24, 'Los posts de feed completan exactamente su cupo de 24');
      assert.equal(priceStories.length, expectedWorkDays, `Las stories de precios se generan para los ${expectedWorkDays} días laborables`);
      assert.equal(enriched.length, 24 + expectedWorkDays, `Total de entradas en calendario = 24 feed + ${expectedWorkDays} stories`);
    });

    it('si includePriceStoriesInFeedBudget=true, las stories de precios sí consumen cupo de feed', () => {
      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 10 };
      const enriched = scheduler.enrichScheduleWithBudget([], dateContext, {
        maxDailyFeedPosts: 1,
        maxMonthlyFeedPosts: 5,
        includePriceStoriesInFeedBudget: true
      });

      // Total de publicaciones con formato feed o price-story no supera 5
      const feedAndStories = enriched.filter(e => e.format !== 'story');
      assert.equal(feedAndStories.length, 5, 'Debe detenerse exactamente al alcanzar el límite configurado');
    });
  });

  // =========================================================================
  // e) Ordenación, estructura de datos y campos obligatorios
  // =========================================================================
  describe('e) Estructura y coherencia del calendario enriquecido', () => {
    it('ordena estrictamente por día y hora cronológica', () => {
      const creativeSchedule = [
        { day: 15, hour: '20:00', format: 'video', concept: 'Tarde día 15' },
        { day: 3, hour: '14:00', format: 'single', concept: 'Mediodía día 3' },
        { day: 3, hour: '09:00', format: 'carousel', concept: 'Mañana día 3' }
      ];

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 30 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext, {
        maxDailyFeedPosts: 2,
        maxMonthlyFeedPosts: 24,
        allowNewsOnCreativeDays: true
      });

      for (let i = 0; i < enriched.length - 1; i++) {
        const curr = enriched[i];
        const next = enriched[i + 1];
        if (curr.day === next.day) {
          assert.ok(
            curr.hour.localeCompare(next.hour) <= 0,
            `En el día ${curr.day}, ${curr.hour} debe ser <= ${next.hour}`
          );
        } else {
          assert.ok(curr.day < next.day, `El día ${curr.day} debe ser menor que ${next.day}`);
        }
      }
    });

    it('asegura que todas las entradas cuenten con status: planned, postId: null y mediaType asignado', () => {
      const creativeSchedule = [
        { day: 2, hour: '19:00', format: 'video', concept: 'Video de prueba' },
        { day: 4, hour: '15:00', format: 'single', concept: 'Single de prueba' }
      ];

      const dateContext = { year: 2026, month: 10, startDay: 1, daysInMonth: 5 };
      const enriched = scheduler.enrichScheduleWithBudget(creativeSchedule, dateContext);

      for (const entry of enriched) {
        assert.equal(entry.status, 'planned', `La entrada en día ${entry.day} debe tener status planned`);
        assert.equal(entry.postId, null, `La entrada en día ${entry.day} debe tener postId null`);
        assert.ok(entry.mediaType, `La entrada en día ${entry.day} (${entry.format}) debe tener mediaType`);
      }
    });
  });
});
