const cron = require('node-cron');
const botStateService = require('../services/botStateService');
const knowledgeService = require('../services/knowledgeService');
const orchestrator = require('../core/AgentOrchestrator');
const approvalGateway = require('./approvalGateway');
const geminiService = require('../services/geminiService');
const skillLoader = require('../core/SkillLoader');
const postService = require('../services/postService');
const agroDataService = require('../services/agroDataService');
const agroImageService = require('../services/agroImageService');
const publishingService = require('../services/publishingService');
const instagramPublisher = require('./instagramPublisher');

/**
 * Motor de Automatización del Auto-Pilot.
 * Gestiona los crons mensuales (planificación) y diarios (ejecución).
 */
class Scheduler {
  constructor() {
    this.monthlyJob = null;
    this.dailyJob = null;
    this.agroDailyJob = null;
    this.agroDailyExecuted = false;
  }

  /**
   * Arranca los temporizadores. Se llama una vez al iniciar el servidor.
   */
  start() {
    console.log('[Scheduler] Iniciando temporizadores del Auto-Pilot...');

    // Cron Mensual: Día 1 de cada mes a las 00:05
    this.monthlyJob = cron.schedule('5 0 1 * *', async () => {
      console.log('\x1b[35m[Scheduler] CRON MENSUAL DISPARADO — Planificando el mes...\x1b[0m');
      await this.runMonthlyPlanning();
    }, { timezone: "Europe/Madrid" });

    // Cron Diario: Cada hora en punto para comprobar si toca publicar
    this.dailyJob = cron.schedule('0 * * * *', async () => {
      await this.checkAndExecute();
    }, { timezone: "Europe/Madrid" });

    // Cron Agro Diario: contenido automático de precios y noticias
    const cronHour = process.env.AGRO_DAILY_CRON_HOUR || '08:00';
    const [hour, minute] = cronHour.split(':').map(Number);
    const agroCronExpr = `${minute || 0} ${hour || 8} * * *`;

    this.agroDailyJob = cron.schedule(agroCronExpr, async () => {
      if (this.agroDailyExecuted) return;
      await this.runAgroDaily();
      this.agroDailyExecuted = true;
    }, { timezone: "Europe/Madrid" });

    // Reset del flag de ejecución diaria a medianoche
    cron.schedule('0 0 * * *', () => {
      this.agroDailyExecuted = false;
    }, { timezone: "Europe/Madrid" });

    console.log(`[Scheduler] Temporizadores activos (Mensual: día 1, Diario: cada hora, Agro: ${cronHour}).`);

    // Al arrancar, comprobamos si ya estamos en un mes sin planificación
    this.checkInitialState();
  }

  /**
   * Comprueba si al arrancar el servidor falta la planificación del mes actual.
   */
  async checkInitialState() {
    const state = botStateService.getState();
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    if (state.isAutoPilotActive && state.currentMonth !== currentMonth) {
      console.log('[Scheduler] Detectado mes sin planificación al arrancar. Generando...');
      await this.runMonthlyPlanning();
    }
  }

  /**
   * Genera el calendario del mes usando el Agente Planificador.
   */
  async runMonthlyPlanning() {
    if (!botStateService.isActive()) {
      console.log('[Scheduler] Auto-Pilot desactivado. Saltando planificación mensual.');
      return;
    }

    try {
      const skillPrompt = await skillLoader.loadSkill('social-media-planner');
      const brandContext = knowledgeService.getAllAsText();
      const now = new Date();
      const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

      const prompt = `
        ${skillPrompt}

        CONTEXTO DE MARCA:
        ${brandContext}

        MES A PLANIFICAR: ${monthLabel} (${daysInMonth} días)
        Hoy es día ${now.getDate()}. Si ya han pasado días del mes, planifica solo los días restantes.

        Genera el calendario ahora.
      `;

      console.log('[Scheduler] Invocando al Agente Planificador...');
      const responseText = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.9 });

      const schedule = JSON.parse(responseText.replace(/```json|```/g, '').trim());

      if (!Array.isArray(schedule)) {
        throw new Error('El Planificador no devolvió un array válido.');
      }

      // Añadimos estado por defecto a cada entrada
      const enrichedSchedule = schedule.map(entry => ({
        ...entry,
        status: 'planned', // planned | generating | pending_approval | approved | published | rejected
        postId: null
      }));

      const currentMonth = now.toISOString().slice(0, 7);
      botStateService.setMonthlySchedule(currentMonth, enrichedSchedule);
      console.log(`\x1b[32m[Scheduler] ✅ Calendario de ${monthLabel} generado con ${enrichedSchedule.length} publicaciones.\x1b[0m`);

    } catch (error) {
      console.error('[Scheduler] Error en la planificación mensual:', error.message);
    }
  }

  /**
   * Comprueba cada hora si hay un post programado para ejecutar.
   */
  async checkAndExecute() {
    if (!botStateService.isActive()) return;

    const now = new Date();
    const currentDay = now.getDate();
    const currentHour = `${String(now.getHours()).padStart(2, '0')}:00`;

    const schedule = botStateService.getSchedule();
    const todayEntry = schedule.find(e => e.day === currentDay && e.status === 'planned');

    if (!todayEntry) return;

    // Comprobamos si la hora actual es >= a la programada para dar margen de anticipación
    const scheduledHour = parseInt(todayEntry.hour.split(':')[0]);
    const prepHour = scheduledHour - 2;

    if (now.getHours() < prepHour) return;
    if (todayEntry.status !== 'planned') return;

    console.log(`\x1b[33m[Scheduler] 🚀 Hora de generar contenido para el día ${currentDay} (planificado a las ${todayEntry.hour})\x1b[0m`);
    
    botStateService.updateScheduleDay(currentDay, { status: 'generating' });

    try {
      const brandContext = knowledgeService.getAllAsText();
      const mediaType = todayEntry.format === 'video' ? 'video' : 'image';
      const result = await orchestrator.runFullWorkflow(
        todayEntry.briefing,
        brandContext,
        todayEntry.format,
        mediaType,
        todayEntry.aspectRatio
      );

      const savedPost = postService.save({
        briefing: todayEntry.briefing,
        contentType: todayEntry.format,
        aspectRatio: todayEntry.aspectRatio,
        content: result.content,
        visuals: result.visuals,
        video: result.video,
        scheduledHour: todayEntry.hour,
        autoGenerated: true
      });

      botStateService.updateScheduleDay(currentDay, { status: 'pending_approval', postId: savedPost.id });

      // Enviar email de aprobación
      await approvalGateway.sendApprovalEmail(savedPost, todayEntry);
      console.log(`\x1b[32m[Scheduler] ✅ Contenido generado y enviado para aprobación.\x1b[0m`);

    } catch (error) {
      console.error(`[Scheduler] Error generando contenido del día ${currentDay}:`, error.message);
      botStateService.updateScheduleDay(currentDay, { status: 'planned' });
    }
  }

  /**
   * Ejecuta el contenido agro diario automático (precios + noticia).
   */
  async runAgroDaily() {
    console.log('\x1b[35m[Scheduler] CRON AGRO DIARIO — Generando contenido de precios y noticias...\x1b[0m');

    // 1. Historia de precios
    try {
      const prices = await agroDataService.getLatestPrices();
      if (prices.length > 0) {
        const imageResult = await agroImageService.generatePriceCardImage(prices);
        if (imageResult) {
          const fecha = new Date(prices[0].Fecha).toLocaleDateString('es-ES', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
          const priceList = prices.map(p =>
            `${p.NombreProductoCompleto}: ${parseFloat(p.Precio).toFixed(2)} €/kg`
          ).join('\n');

          const savedPost = postService.save({
            briefing: `[Auto-Agro] Precios medios del día ${fecha}`,
            contentType: 'price-story',
            aspectRatio: '9:16',
            content: {
              text: `Precios medios del día ${fecha}\n\n${priceList}`,
              facebook: {
                copy: `Precios medios del día ${fecha}\n\n${priceList}\n\nMás información en www.helpmeagro.com`,
                hashtags: '#preciosmedios #hortalizas #agricultura #andalucia #helpmeagro #preciosmercado'
              },
              instagram: {
                copy: `Precios medios del día ${fecha}\n\n${priceList}`,
                hashtags: '#preciosmedios #hortalizas #agricultura #andalucia #helpmeagro #preciosmercado #mercado #almeria'
              }
            },
            visuals: [imageResult.url],
            video: null,
            autoGenerated: true,
            agroData: { type: 'price-story', prices, date: prices[0].Fecha }
          });

          // Publicar en Instagram via Puente
          console.log(`[Scheduler] Publicando STORY de precios: ${imageResult.url}`);
          await publishingService.publishViaBridge(imageResult.url, 'story', 'IMAGE');
          console.log(`\x1b[32m[Scheduler] Story de precios publicada. Post ID: ${savedPost.id}\x1b[0m`);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Error en precio diario agro:', e.message);
    }

    // 2. Post de noticia
    try {
      const noticias = await agroDataService.getLatestNews();
      if (noticias.length > 0) {
        const newsItem = await agroDataService.selectMostImportantNews(noticias);
        const newsUrl = agroDataService.getNewsUrl(newsItem);
        const imageResult = await agroImageService.generateNewsPostImage(newsItem);
        if (imageResult) {
          const copy = await agroImageService.generateNewsCopy(newsItem, newsUrl);
          const savedPost = postService.save({
            briefing: `[Auto-Agro] Noticia: ${newsItem.Titulo}`,
            contentType: 'news-post',
            aspectRatio: '1:1',
            content: copy,
            visuals: [imageResult.url],
            video: null,
            autoGenerated: true,
            agroData: {
              type: 'news-post',
              newsId: newsItem.Id,
              newsTitle: newsItem.Titulo,
              newsUrl,
              newsImageOriginal: agroDataService.getNewsImageUrl(newsItem)
            }
          });

          // Publicar en Instagram via Puente
          const caption = `${copy.instagram?.copy || newsItem.Titulo}\n\n${copy.instagram?.hashtags || '#agricultura #helpmeagro'}`;
          console.log(`[Scheduler] Publicando POST de noticia: ${imageResult.url}`);
          await publishingService.publishViaBridge(imageResult.url, 'image', caption);
          console.log(`\x1b[32m[Scheduler] Post de noticia publicado. Post ID: ${savedPost.id}\x1b[0m`);
        }
      }
    } catch (e) {
      console.error('[Scheduler] Error en noticia diaria agro:', e.message);
    }
  }

  /**
   * Fuerza la planificación mensual manualmente (útil para testing).
   */
  async forceMonthlyPlanning() {
    const wasActive = botStateService.isActive();
    if (!wasActive) {
      const state = botStateService.getState();
      state.isAutoPilotActive = true;
      botStateService.toggleAutoPilot();
    }
    await this.runMonthlyPlanning();
    if (!wasActive) botStateService.toggleAutoPilot();
  }
}

module.exports = new Scheduler();
