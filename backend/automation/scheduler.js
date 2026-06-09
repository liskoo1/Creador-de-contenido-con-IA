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
const productContextService = require('../services/productContextService');

/**
 * Motor de Automatización del Auto-Pilot.
 * Gestiona los crons mensuales (planificación) y diarios (ejecución).
 */
class Scheduler {
  constructor() {
    this.monthlyJob = null;
    this.dailyJob = null;
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

    console.log(`[Scheduler] Temporizadores activos (Mensual: día 1, Diario: cada hora).`);

    // Al arrancar, comprobamos el estado inicial
    this.checkInitialState();
  }

  /**
   * Comprueba si al arrancar el servidor falta la planificación del mes actual
   * o si hay contenido pendiente de ejecutar hoy.
   */
  async checkInitialState() {
    const state = botStateService.getState();
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    if (state.isAutoPilotActive && state.currentMonth !== currentMonth) {
      console.log('[Scheduler] Detectado mes sin planificación al arrancar. Generando...');
      await this.runMonthlyPlanning();
    }

    // Ejecutar checkAndExecute al arrancar para no perder la ventana del día actual
    if (state.isAutoPilotActive) {
      console.log('[Scheduler] Comprobando contenido pendiente de hoy al arrancar...');
      await this.checkAndExecute();
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
      const productContextSection = productContextService.getAsPromptSection();
      const productMeta = productContextService.getMetadata();
      const now = new Date();
      const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
      const monthLabel = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

      const allowedFormats = botStateService.getAllowedFormats();
      const formatRules = allowedFormats.map(f => `- format: '${f.format}', mediaType: '${f.mediaType}'`).join('\n        ');

      const prompt = `
        ${skillPrompt}

        CONTEXTO DE MARCA:
        ${brandContext}

        ${productContextSection ? productContextSection : ''}

        MES A PLANIFICAR: ${monthLabel} (${daysInMonth} días)
        Hoy es día ${now.getDate()}. Si ya han pasado días del mes, planifica solo los días restantes.

        REGLA CRÍTICA DE FORMATOS Y MEDIOS:
        Solo puedes generar el plan usando UNA de estas combinaciones exactas permitidas por el usuario:
        ${formatRules}
        
        El JSON que devuelvas DEBE incluir el campo 'mediaType' correspondiente junto a 'format' en cada entrada del calendario.

        Genera el calendario ahora.
      `;

      console.log('[Scheduler] Invocando al Agente Planificador...');
      const responseText = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.9 });

      const schedule = JSON.parse(responseText.replace(/```json|```/g, '').trim());

      if (!Array.isArray(schedule)) {
        throw new Error('El Planificador no devolvió un array válido.');
      }

      // Añadimos estado por defecto a cada entrada creativa
      const enrichedSchedule = schedule.map(entry => ({
        ...entry,
        mediaType: entry.mediaType || (entry.format === 'video' ? 'video' : 'image'),
        status: 'planned',
        postId: null
      }));

      // Inyectar entradas fijas: price-story todos los días (menos domingos), news-post todos los días
      const startDay = now.getDate();
      const schedMeta = productContextService.getMetadata();
      const productNameLabel = schedMeta.productName || 'nuestro producto';
      const priceBriefing = `Genera la story de precios del día para ${productNameLabel}.`;
      const newsBriefing = `Genera el post con la noticia más importante del día relacionada con ${schedMeta.industry || 'el sector'}.`;

      for (let d = startDay; d <= daysInMonth; d++) {
        const dateObj = new Date(now.getFullYear(), now.getMonth(), d);
        const dayOfWeek = dateObj.getDay(); // 0=dom, 1=lun...6=sab

        // Price-story diario (menos domingo) — hora desde AGRO_DAILY_CRON_HOUR
        if (dayOfWeek !== 0) {
          const agroCronHour = process.env.AGRO_DAILY_CRON_HOUR || '08:00';
          // Añadir 30 min al cron para que la planificación sea después del cron de ejecución
          const [aH, aM] = agroCronHour.split(':').map(Number);
          const priceHour = `${String(aH).padStart(2, '0')}:${String((aM || 0) + 30).padStart(2, '0')}`;
          const hasPrice = enrichedSchedule.find(e => e.day === d && e.format === 'price-story');
          if (!hasPrice) {
            enrichedSchedule.push({
              day: d,
              hour: priceHour,
              format: 'price-story',
              aspectRatio: '9:16',
              concept: `Story con precios del día`,
              angle: 'informativo',
              briefing: priceBriefing,
              status: 'planned',
              postId: null
            });
          }
        }

        // News-post todos los días
        const hasCreative = enrichedSchedule.find(e => e.day === d && e.format !== 'price-story' && e.format !== 'news-post');
        const hasNews = enrichedSchedule.find(e => e.day === d && e.format === 'news-post');

        if (!hasNews) {
          // Si ya hay contenido creativo ese día, poner la noticia a otra hora
          const newsHour = hasCreative ? '10:00' : '12:30';
          enrichedSchedule.push({
            day: d,
            hour: newsHour,
            format: 'news-post',
            aspectRatio: '1:1',
            concept: `Noticia relevante del día`,
            angle: 'noticia',
            briefing: newsBriefing,
            status: 'planned',
            postId: null
          });
        }
      }

      // Ordenar por día y hora
      enrichedSchedule.sort((a, b) => a.day - b.day || a.hour.localeCompare(b.hour));

      const currentMonth = now.toISOString().slice(0, 7);
      botStateService.setMonthlySchedule(currentMonth, enrichedSchedule);
      console.log(`\x1b[32m[Scheduler] ✅ Calendario de ${monthLabel} generado con ${enrichedSchedule.length} entradas (creativas + precios + noticias).\x1b[0m`);

    } catch (error) {
      console.error('[Scheduler] Error en la planificación mensual:', error.message);
    }
  }

  /**
   * Comprueba cada hora si hay un post programado para ejecutar.
   * Genera el contenido 2 horas antes de la hora programada para dar tiempo
   * a la revisión y aprobación.
   */
  async checkAndExecute() {
    if (!botStateService.isActive()) {
      console.log('[Scheduler] checkAndExecute: Auto-Pilot desactivado, saltando.');
      return;
    }

    const now = new Date();
    const currentDay = now.getDate();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const schedule = botStateService.getSchedule();
    const dayEntries = schedule.filter(e => e.day === currentDay);
    const todayEntryIndex = dayEntries.findIndex(e => e.status === 'planned');

    if (todayEntryIndex === -1) {
      console.log(`[Scheduler] checkAndExecute: No hay entrada 'planned' para hoy (día ${currentDay}).`);
      return;
    }

    const todayEntry = dayEntries[todayEntryIndex];

    // Convertir la hora programada a minutos para comparación precisa
    const [schedHour, schedMin] = todayEntry.hour.split(':').map(Number);
    const scheduledMinutes = schedHour * 60 + (schedMin || 0);

    // Ventana de ejecución: desde 2 horas antes hasta 30 min después de la hora programada
    const prepWindowStart = scheduledMinutes - 120;
    const prepWindowEnd = scheduledMinutes + 30;

    console.log(`[Scheduler] checkAndExecute: Día=${currentDay}, Hora actual=${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')} (${currentMinutes}min), Programado=${todayEntry.hour} (${scheduledMinutes}min), Ventana=[${prepWindowStart}-${prepWindowEnd}]`);

    if (currentMinutes < prepWindowStart || currentMinutes > prepWindowEnd) {
      console.log(`[Scheduler] checkAndExecute: Fuera de la ventana de ejecución.`);
      return;
    }

    console.log(`\x1b[33m[Scheduler] 🚀 Hora de generar contenido para el día ${currentDay} (planificado a las ${todayEntry.hour}, ahora ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')})\x1b[0m`);
    
    // Enrutar según tipo de contenido
    if (todayEntry.format === 'price-story' || todayEntry.format === 'news-post') {
      await this.executeAgroContent(currentDay, todayEntry, todayEntryIndex);
    } else {
      await this.executeCreativeContent(currentDay, todayEntry, todayEntryIndex);
    }
  }

  /**
   * Ejecuta contenido creativo (single, carousel, video) usando el orquestador.
   */
  async executeCreativeContent(day, entry, index = 0) {
    botStateService.updateScheduleEntry(day, index, { status: 'generating' });

    try {
      const brandContext = knowledgeService.getAllAsText();
      const mediaType = entry.mediaType || (entry.format === 'video' ? 'video' : 'image');
      const result = await orchestrator.runFullWorkflow(
        entry.briefing,
        brandContext,
        entry.format,
        mediaType,
        entry.aspectRatio
      );

      const savedPost = postService.save({
        briefing: entry.briefing,
        contentType: entry.format,
        aspectRatio: entry.aspectRatio,
        content: result.content,
        visuals: result.visuals,
        video: result.video,
        scheduledHour: entry.hour,
        autoGenerated: true
      });

      botStateService.updateScheduleEntry(day, index, { status: 'pending_approval', postId: savedPost.id });
      await approvalGateway.sendApprovalEmail(savedPost, entry);
      console.log(`\x1b[32m[Scheduler] ✅ Contenido creativo día ${day} generado y enviado para aprobación.\x1b[0m`);

    } catch (error) {
      console.error(`[Scheduler] Error generando contenido día ${day}:`, error.message);
      botStateService.updateScheduleEntry(day, index, { status: 'planned' });
    }
  }

  /**
   * Ejecuta contenido agro (price-story o news-post) usando los servicios agro.
   */
  async executeAgroContent(day, entry, index = 0) {
    botStateService.updateScheduleEntry(day, index, { status: 'generating' });

    try {
      const exeMeta = productContextService.getMetadata();
      const exeWebsite = exeMeta.website ? `\n\nMás información en ${exeMeta.website}` : '';
      const exeHashtags = exeMeta.defaultHashtags || '#preciosmedios #mercado';

      if (entry.format === 'price-story') {
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
                  copy: `Precios medios del día ${fecha}\n\n${priceList}${exeWebsite}`,
                  hashtags: exeHashtags
                },
                instagram: {
                  copy: `Precios medios del día ${fecha}\n\n${priceList}`,
                  hashtags: exeHashtags
                }
              },
              visuals: [imageResult.url],
              video: null,
              autoGenerated: true,
              agroData: { type: 'price-story', prices, date: prices[0].Fecha }
            });

            botStateService.updateScheduleEntry(day, index, { status: 'pending_approval', postId: savedPost.id });
            await approvalGateway.sendApprovalEmail(savedPost, entry);
            console.log(`\x1b[32m[Scheduler] ✅ Story de precios día ${day} generada. Post: ${savedPost.id}\x1b[0m`);
          }
        }
      } else if (entry.format === 'news-post') {
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

            botStateService.updateScheduleEntry(day, index, { status: 'pending_approval', postId: savedPost.id });
            await approvalGateway.sendApprovalEmail(savedPost, entry);
            console.log(`\x1b[32m[Scheduler] ✅ Post de noticia día ${day} generado. Post: ${savedPost.id}\x1b[0m`);
          }
        }
      }
    } catch (error) {
      console.error(`[Scheduler] Error generando contenido agro día ${day}:`, error.message);
      botStateService.updateScheduleEntry(day, index, { status: 'planned' });
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
