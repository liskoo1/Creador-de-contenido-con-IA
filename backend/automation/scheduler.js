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
const instagramSkillsService = require('../services/instagramSkillsService');
const contentMemoryService = require('../services/contentMemoryService');

/**
 * Motor de Automatización del Auto-Pilot.
 * Gestiona los crons mensuales (planificación) y diarios (ejecución).
 */

function getMadridTime(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);
  const minute = parseInt(parts.minute, 10);
  const minutesOfDay = hour * 60 + minute;
  const monthKey = `${parts.year}-${parts.month}`;

  return { day, hour, minute, minutesOfDay, monthKey };
}

class Scheduler {
  constructor() {
    this.monthlyJob = null;
    this.weeklyJob = null;
    this.dailyJob = null;
    this.enrichScheduleWithBudget = this.enrichScheduleWithBudget.bind(this);
  }

  /**
   * Arranca los temporizadores. Se llama una vez al iniciar el servidor.
   */
  start() {
    console.log('[Scheduler] Iniciando temporizadores del Auto-Pilot...');

    // Cron Mensual: Día 1 de cada mes a las 00:05
    this.monthlyJob = cron.schedule('5 0 1 * *', async () => {
      const mode = botStateService.getPlanningMode();
      if (mode === 'monthly') {
        console.log('\x1b[35m[Scheduler] CRON MENSUAL DISPARADO — Modo Mensual activo. Planificando el mes...\x1b[0m');
        await this.runMonthlyPlanning();
      } else {
        console.log('\x1b[35m[Scheduler] Cron mensual omitido: Modo de planificación activo es SEMANAL.\x1b[0m');
      }
    }, { timezone: "Europe/Madrid" });

    // Cron Semanal: Lunes a las 06:00 AM (Europe/Madrid)
    this.weeklyJob = cron.schedule('0 6 * * 1', async () => {
      const mode = botStateService.getPlanningMode();
      if (mode === 'weekly') {
        console.log('\x1b[35m[Scheduler] CRON SEMANAL DISPARADO — Modo Semanal activo. Ejecutando investigación y planificando semana...\x1b[0m');
        await this.runWeeklyPlanning();
      } else {
        console.log('\x1b[35m[Scheduler] Cron semanal omitido: Modo de planificación activo es MENSUAL.\x1b[0m');
      }
    }, { timezone: "Europe/Madrid" });


    // Cron Diario: Cada 30 minutos para comprobar si toca publicar
    this.dailyJob = cron.schedule('0,30 * * * *', async () => {
      await this.checkAndExecute();
    }, { timezone: "Europe/Madrid" });

    console.log(`[Scheduler] Temporizadores activos (Mensual: día 1, Diario: cada 30 min).`);

    // Al arrancar, comprobamos el estado inicial
    this.checkInitialState();
  }

  /**
   * Comprueba si al arrancar el servidor falta la planificación del mes actual
   * o si hay contenido pendiente de ejecutar hoy.
   */
  async checkInitialState() {
    const state = botStateService.getState();
    const mode = botStateService.getPlanningMode();
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7); // "YYYY-MM"

    if (state.isAutoPilotActive) {
      if (mode === 'monthly') {
        if (state.currentMonth !== currentMonth || !state.schedule || state.schedule.length === 0) {
          console.log('[Scheduler] Detectado mes sin planificación al arrancar en modo mensual. Generando...');
          await this.runMonthlyPlanning();
        }
      } else if (mode === 'weekly') {
        const startDay = now.getDate();
        const weekKey = `W_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
        if (!state.currentWeek || !state.schedule || state.schedule.length === 0) {
          console.log('[Scheduler] Detectada semana sin planificación al arrancar en modo semanal. Investigando y generando...');
          await this.runWeeklyPlanning();
        }
      }
    }

    // Ejecutar checkAndExecute al arrancar para no perder la ventana del día actual
    if (state.isAutoPilotActive) {
      console.log('[Scheduler] Comprobando contenido pendiente de hoy al arrancar...');
      await this.checkAndExecute();
    }
  }

  /**
   * Enriquece la planificación creativa con publicaciones fijas (stories de precios y noticias)
   * aplicando de forma estricta las reglas del presupuesto editorial.
   *
   * @param {Array} creativeSchedule - Array de entradas creativas planificadas
   * @param {Date|object|null} dateContext - Contexto temporal ({ year, month, startDay, daysInMonth, now })
   * @param {object|null} budgetOverride - Sobrescribir presupuesto editorial para pruebas o escenarios ad-hoc
   * @returns {Array} Calendario ordenado y enriquecido
   */
  enrichScheduleWithBudget(creativeSchedule = [], dateContext = null, budgetOverride = null) {
    const budget = {
      ...botStateService.getEditorialBudget(),
      ...(budgetOverride || {})
    };

    const maxDailyFeedPosts = Number.isFinite(budget.maxDailyFeedPosts) ? budget.maxDailyFeedPosts : 1;
    const maxMonthlyFeedPosts = Number.isFinite(budget.maxMonthlyFeedPosts) ? budget.maxMonthlyFeedPosts : 24;
    const allowNewsOnCreativeDays = Boolean(budget.allowNewsOnCreativeDays);
    const includePriceStoriesInFeedBudget = Boolean(budget.includePriceStoriesInFeedBudget);

    const isFeedFormat = (format) => {
      if (format === 'story') return false;
      if (format === 'price-story') return includePriceStoriesInFeedBudget;
      return true;
    };

    let year;
    let month;
    let startDay;
    let daysInMonth;

    if (dateContext instanceof Date) {
      year = dateContext.getFullYear();
      month = dateContext.getMonth();
      startDay = dateContext.getDate();
      daysInMonth = new Date(year, month + 1, 0).getDate();
    } else if (dateContext && typeof dateContext === 'object') {
      const baseDate = dateContext.now instanceof Date ? dateContext.now : new Date();
      year = dateContext.year !== undefined ? dateContext.year : baseDate.getFullYear();
      month = dateContext.month !== undefined ? dateContext.month : baseDate.getMonth();
      daysInMonth = dateContext.daysInMonth !== undefined
        ? dateContext.daysInMonth
        : new Date(year, month + 1, 0).getDate();
      startDay = dateContext.startDay !== undefined
        ? dateContext.startDay
        : (dateContext.now instanceof Date ? dateContext.now.getDate() : 1);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth();
      startDay = now.getDate();
      daysInMonth = new Date(year, month + 1, 0).getDate();
    }

    const schedMeta = (productContextService && typeof productContextService.getMetadata === 'function')
      ? (productContextService.getMetadata() || {})
      : {};
    const productNameLabel = dateContext?.productName || schedMeta.productName || 'nuestro producto';
    const industryLabel = dateContext?.industry || schedMeta.industry || 'agrícola';
    const priceBriefing = dateContext?.priceBriefing || `Genera la story de precios del día para ${productNameLabel}.`;
    const newsBriefing = dateContext?.newsBriefing || `Genera el post con la noticia más importante del día. PRIORIDAD: si hay noticia de Almería del día, úsala; si no, Andalucía; si no, la más relevante del sector ${industryLabel}.`;

    // Preservar entradas creativas iniciales
    const enrichedSchedule = (creativeSchedule || []).map(entry => ({
      ...entry,
      mediaType: entry.mediaType || (entry.format === 'video' ? 'video' : 'image'),
      status: entry.status || 'planned',
      postId: entry.postId !== undefined ? entry.postId : null
    }));

    let totalFeedCount = enrichedSchedule.filter(e => isFeedFormat(e.format)).length;

    for (let d = startDay; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dayOfWeek = dateObj.getDay(); // 0=dom, 1=lun...6=sab

      // Stories de precios (lunes a sábado, no domingos)
      if (dayOfWeek !== 0) {
        const agroCronHour = process.env.AGRO_DAILY_CRON_HOUR || '08:00';
        const [aH, aM] = agroCronHour.split(':').map(Number);
        const totalMin = (aH || 0) * 60 + (aM || 0) + 30;
        const priceHour = `${String(Math.floor(totalMin / 60) % 24).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
        const hasPrice = enrichedSchedule.some(e => e.day === d && e.format === 'price-story');

        if (!hasPrice) {
          if (includePriceStoriesInFeedBudget) {
            const dayFeedPosts = enrichedSchedule.filter(e => e.day === d && isFeedFormat(e.format)).length;
            if (dayFeedPosts < maxDailyFeedPosts && totalFeedCount < maxMonthlyFeedPosts) {
              enrichedSchedule.push({
                day: d,
                hour: priceHour,
                format: 'price-story',
                mediaType: 'image',
                aspectRatio: '9:16',
                concept: 'Story con precios del día',
                angle: 'informativo',
                briefing: priceBriefing,
                status: 'planned',
                postId: null
              });
              totalFeedCount++;
            }
          } else {
            // Carril independiente que no consume cupo de feed
            enrichedSchedule.push({
              day: d,
              hour: priceHour,
              format: 'price-story',
              mediaType: 'image',
              aspectRatio: '9:16',
              concept: 'Story con precios del día',
              angle: 'informativo',
              briefing: priceBriefing,
              status: 'planned',
              postId: null
            });
          }
        }
      }

      // Publicaciones de noticias (feed)
      const hasNews = enrichedSchedule.some(e => e.day === d && e.format === 'news-post');
      if (!hasNews) {
        const hasCreativeFeed = enrichedSchedule.some(e =>
          e.day === d &&
          e.format !== 'price-story' &&
          e.format !== 'news-post' &&
          isFeedFormat(e.format)
        );

        const dayFeedPosts = enrichedSchedule.filter(e => e.day === d && isFeedFormat(e.format)).length;
        const protectAgro = budget.protectAgroRoutines !== false;
        const explicitAllowNews = budgetOverride && budgetOverride.allowNewsOnCreativeDays !== undefined;
        const effectiveAllowNewsOnCreative = explicitAllowNews
          ? Boolean(budgetOverride.allowNewsOnCreativeDays)
          : (allowNewsOnCreativeDays || protectAgro);

        const canInjectByCreativeRule = !hasCreativeFeed || effectiveAllowNewsOnCreative;
        const canInjectByDailyBudget = dayFeedPosts < maxDailyFeedPosts || (protectAgro && !budgetOverride?.maxDailyFeedPosts);
        const canInjectByMonthlyBudget = totalFeedCount < maxMonthlyFeedPosts || (protectAgro && !budgetOverride?.maxMonthlyFeedPosts);

        if (canInjectByCreativeRule && canInjectByDailyBudget && canInjectByMonthlyBudget) {
          const newsHour = hasCreativeFeed ? '10:00' : '12:30';
          enrichedSchedule.push({
            day: d,
            hour: newsHour,
            format: 'news-post',
            mediaType: 'image',
            aspectRatio: '1:1',
            concept: 'Noticia relevante del día',
            angle: 'noticia',
            briefing: newsBriefing,
            status: 'planned',
            postId: null
          });
          totalFeedCount++;
        }
      }
    }

    // Ordenar por día y hora
    enrichedSchedule.sort((a, b) => a.day - b.day || (a.hour || '').localeCompare(b.hour || ''));

    return enrichedSchedule;
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
      const instagramGuidance = await instagramSkillsService.forAgent('social-media-planner');
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
        ${instagramGuidance}
      `;

      console.log('[Scheduler] Invocando al Agente Planificador...');
      const responseText = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.9 });

      const schedule = JSON.parse(responseText.replace(/```json|```/g, '').trim());

      if (!Array.isArray(schedule)) {
        throw new Error('El Planificador no devolvió un array válido.');
      }

      const startDay = now.getDate();
      const enrichedSchedule = this.enrichScheduleWithBudget(
        schedule,
        { now, year: now.getFullYear(), month: now.getMonth(), startDay, daysInMonth }
      );

      const currentMonth = now.toISOString().slice(0, 7);
      botStateService.setMonthlySchedule(currentMonth, enrichedSchedule);
      console.log(`\x1b[32m[Scheduler] ✅ Calendario de ${monthLabel} generado con ${enrichedSchedule.length} entradas (creativas + precios + noticias).\x1b[0m`);

    } catch (error) {
      console.error('[Scheduler] Error en la planificación mensual:', error.message);
    }
  }

  /**
   * Comprueba periódicamente si hay un post programado para ejecutar.
   * Genera el contenido en la hora programada o después.
   */
  async publishScheduledPost(day, entry, index = 0) {
    if (!entry.postId) return;
    const post = postService.getAll().find(p => p.id === entry.postId);
    if (!post) {
      console.error(`[Scheduler] Post ${entry.postId} no encontrado para publicar.`);
      return;
    }

    const claim = botStateService.claimApprovalPublish(entry.postId);
    if (!claim.allowed) {
      console.log(`[Scheduler] Post ${entry.postId} ya está siendo procesado o ya fue publicado.`);
      return;
    }

    try {
      const job = publishingService.resolvePublishJob(post);
      if (!job) {
        botStateService.releaseApprovalPublishClaim(entry.postId);
        console.error(`[Scheduler] Post ${entry.postId} sin material visual o de vídeo para publicar.`);
        return;
      }

      const defaultPlatforms = ['instagram', 'facebook'];
      const publishedTo = post.publishedTo || {};
      const pending = defaultPlatforms.filter(p => !publishedTo[p]);
      if (pending.length === 0) {
        botStateService.markApprovalPublished(entry.postId);
        botStateService.updateScheduleEntry(day, index, { status: 'published' });
        return;
      }

      const igCaption = post.content?.instagram?.copy || post.content?.text || '';
      const fbCaption = post.content?.facebook?.copy
        ? `${post.content.facebook.copy}\n\n${post.content.facebook.hashtags || ''}`.trim()
        : igCaption;
      const caption = igCaption || fbCaption || '';

      const result = await publishingService.publishViaBridge(
        job.path,
        job.type,
        job.type === 'story' ? (job.extra || 'IMAGE') : caption,
        fbCaption,
        { platforms: pending, ...(job.options || {}) }
      );

      const now = new Date().toISOString();
      const nextPublishedTo = { ...publishedTo };
      const nextPlatformIds = { ...(post.publishedPlatformIds || {}) };
      let anyPlatformSucceeded = false;

      for (const p of defaultPlatforms) {
        if (result[p]?.success) {
          if (!nextPublishedTo[p]) nextPublishedTo[p] = now;
          if (result[p].postId) nextPlatformIds[p] = result[p].postId;
          anyPlatformSucceeded = true;
        }
      }

      const allCompleted = Boolean(nextPublishedTo.instagram && nextPublishedTo.facebook);
      const updates = {};
      if (anyPlatformSucceeded) {
        updates.publishedTo = nextPublishedTo;
        updates.publishedPlatformIds = nextPlatformIds;
        if (!post.publishedAt) updates.publishedAt = now;
      }
      if (allCompleted) {
        updates.status = 'published';
      }

      if (Object.keys(updates).length > 0) {
        postService.update(post.id, updates);
      }

      if (allCompleted || result.success) {
        botStateService.markApprovalPublished(entry.postId);
        botStateService.updateScheduleEntry(day, index, { status: 'published' });
        console.log(`\x1b[32m[Scheduler] ✅ Post diferido ${entry.postId} publicado con éxito en la hora programada.\x1b[0m`);
      } else {
        botStateService.releaseApprovalPublishClaim(entry.postId);
        console.warn(`[Scheduler] ⚠️ Publicación diferida fallida para post ${entry.postId}:`, result.error);
      }
    } catch (e) {
      botStateService.releaseApprovalPublishClaim(entry.postId);
      console.error(`[Scheduler] Error publicando post diferido ${entry.postId}:`, e.message);
    }
  }

  async checkAndExecute(dateContext = new Date()) {
    if (!botStateService.isActive()) {
      console.log('[Scheduler] checkAndExecute: Auto-Pilot desactivado, saltando.');
      return;
    }

    const { day: currentDay, minutesOfDay: currentMinutes } = getMadridTime(dateContext);

    const schedule = botStateService.getSchedule();
    const dayEntries = schedule.filter(e => e.day === currentDay);

    const duePlannedIndexes = [];
    const dueApprovedIndexes = [];

    dayEntries.forEach((entry, idx) => {
      const [schedHour, schedMin] = (entry.hour || '00:00').split(':').map(Number);
      const scheduledMinutes = schedHour * 60 + (schedMin || 0);
      if (currentMinutes >= scheduledMinutes) {
        if (entry.status === 'planned') {
          duePlannedIndexes.push(idx);
        } else if (entry.status === 'approved' && entry.postId) {
          dueApprovedIndexes.push(idx);
        }
      }
    });

    if (duePlannedIndexes.length === 0 && dueApprovedIndexes.length === 0) {
      console.log(`[Scheduler] checkAndExecute: No hay entradas 'planned' ni 'approved' pendientes para hoy (día ${currentDay}).`);
      return;
    }

    // 1. Publicar posts diferidos que ya fueron aprobados y cuya hora programada llegó
    for (const todayEntryIndex of dueApprovedIndexes) {
      const todayEntry = dayEntries[todayEntryIndex];
      await this.publishScheduledPost(currentDay, todayEntry, todayEntryIndex);
    }

    // 2. Generar entradas 'planned' pendientes
    for (const todayEntryIndex of duePlannedIndexes) {
      const todayEntry = dayEntries[todayEntryIndex];
      console.log(`[Scheduler] Ejecutando #${todayEntryIndex}: ${todayEntry.format} @ ${todayEntry.hour}`);
      try {
        if (todayEntry.format === 'price-story' || todayEntry.format === 'news-post') {
          await this.executeAgroContent(currentDay, todayEntry, todayEntryIndex);
        } else {
          await this.executeCreativeContent(currentDay, todayEntry, todayEntryIndex);
        }
      } catch (e) {
        console.error(`[Scheduler] Error en entrada #${todayEntryIndex}:`, e.message);
      }
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
      const envMedia = (process.env.MEDIA_PROVIDER || '').trim().toLowerCase();
      const envImage = (process.env.IMAGE_PROVIDER || '').trim().toLowerCase();
      const envVideo = (process.env.VIDEO_PROVIDER || '').trim().toLowerCase();
      const resolvedImageModel = (envMedia === 'google' || envImage === 'google') ? 'google' : (envMedia === 'poe' || envImage === 'poe' ? 'poe' : 'google');
      const resolvedVideoProvider = (envMedia === 'google' || envVideo === 'google') ? 'google' : (envMedia === 'poe' || envVideo === 'poe' ? 'poe' : 'google');

      const result = await orchestrator.runFullWorkflow(
        entry.briefing,
        brandContext,
        entry.format,
        mediaType,
        entry.aspectRatio,
        [],
        'reference',
        'remotion',
        resolvedImageModel,
        null,
        resolvedVideoProvider
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
            botStateService.markNewsUsed(newsItem.Id);
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

  /**
   * Planificación Semanal Inteligente basada en:
   * 1. Tendencias y virales en internet (Grounding / Google Search en tiempo real).
   * 2. Memoria de publicaciones históricas (para no repetir y priorizar lo que mejor funciona).
   * 3. Guía estratégica de skills de Instagram (social-media-planner).
   * 4. Enriquecimiento con rutinas agro (precios y noticias).
   */
  async runWeeklyPlanning() {
    try {
      console.log('\x1b[35m[Scheduler] === INICIANDO PLANIFICACIÓN SEMANAL INTELIGENTE (GROUNDING + MEMORIA) ===\x1b[0m');
      const skillPrompt = await skillLoader.loadSkill('social-media-planner');
      const instagramGuidance = await instagramSkillsService.forAgent('social-media-planner');
      const brandContext = knowledgeService.getAllAsText();
      const productContextSection = productContextService.getAsPromptSection();
      const now = new Date();

      // 1. Tendencias del mercado e internet con Grounding
      const marketTrends = await contentMemoryService.searchMarketTrends();

      // 2. Memoria de contenido histórico y métricas (anti-repetición)
      const historicalMemory = contentMemoryService.formatMemoryForPlanner();

      // Cálculo de la semana (7 días a partir de hoy)
      const startDay = now.getDate();
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const endDay = Math.min(startDay + 6, daysInMonth);
      const weekLabel = `Semana del ${startDay} al ${endDay} (Mes ${now.getMonth() + 1}/${now.getFullYear()})`;

      const allowedFormats = botStateService.getAllowedFormats();
      const formatRules = allowedFormats.map(f => `- format: '${f.format}', mediaType: '${f.mediaType}'`).join('\n        ');

      const prompt = `
        ${skillPrompt}

        CONTEXTO DE MARCA HELPMEAGRO:
        ${brandContext}

        ${productContextSection ? productContextSection : ''}

        TENDENCIAS REALES DE MERCADO Y VIRALES (GROUNDING WEB EN VIVO):
        ${marketTrends}

        ${historicalMemory}

        PERÍODO A PLANIFICAR: ${weekLabel} (Días del mes: ${startDay} al ${endDay}).
        Planifica 3 o 4 publicaciones creativas de alto impacto repartidas estratégicamente en estos días.

        REGLA CRÍTICA DE FORMATOS Y MEDIOS:
        Solo puedes generar el plan usando UNA de estas combinaciones exactas permitidas:
        ${formatRules}

        Cada objeto del JSON DEBE tener:
        - "day": número del día del mes (${startDay} a ${endDay})
        - "hour": hora en formato "HH:MM" (ej: "18:00")
        - "format": uno de los permitidos ('carousel', 'single', 'reel')
        - "mediaType": 'image' o 'video'
        - "aspectRatio": '1:1' o '9:16'
        - "concept": concepto concreto y directo
        - "angle": ángulo editorial específico
        - "hypothesis": { "expectedOutcome": "...", "audience": "..." }

        Responde ÚNICAMENTE con el bloque JSON (array de objetos).
        ${instagramGuidance}
      `;

      console.log('[Scheduler] Invocando al Planificador Semanal con Grounding y Memoria...');
      const responseText = await geminiService.generateText(
        prompt,
        process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash',
        null,
        { temperature: 0.85 }
      );

      const cleaned = responseText.replace(/```json|```/g, '').trim();
      const creativeSchedule = JSON.parse(cleaned);

      if (!Array.isArray(creativeSchedule)) {
        throw new Error('El planificador no devolvió un array válido.');
      }

      const enrichedSchedule = this.enrichScheduleWithBudget(
        creativeSchedule,
        { now, year: now.getFullYear(), month: now.getMonth(), startDay, daysInMonth: endDay }
      );

      const weekKey = `W_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
      botStateService.setWeeklySchedule(weekKey, enrichedSchedule);
      console.log(`\x1b[32m[Scheduler] ✅ Calendario semanal ${weekKey} generado exitosamente con ${enrichedSchedule.length} entradas (creativas + rutinas agro).\x1b[0m`);
      return enrichedSchedule;
    } catch (error) {
      console.error('[Scheduler] Error en la planificación semanal:', error.message);
      throw error;
    }
  }

  /**
   * Fuerza la planificación semanal manualmente.
   */
  async forceWeeklyPlanning() {
    return await this.runWeeklyPlanning();
  }
}

const schedulerInstance = new Scheduler();
schedulerInstance.Scheduler = Scheduler;

module.exports = schedulerInstance;
