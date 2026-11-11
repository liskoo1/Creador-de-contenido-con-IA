const postService = require('./postService');

const SUPPORTED_FORMATS = ['carousel', 'reel', 'single', 'news-post', 'price-story'];

class ExperimentService {
  constructor(customPostService = postService) {
    this.postService = customPostService;
  }

  /**
   * Calcula el Save-to-Reach Ratio (SRR): (saved / reach) * 100
   * Si reach <= 0, no es número finito o saved no es número finito no negativo, devuelve null.
   * Nunca produce NaN ni Infinity.
   *
   * @param {number|null} saved - Cantidad de veces guardado el post.
   * @param {number|null} reach - Alcance de cuentas del post.
   * @returns {number|null} SRR con 2 decimales numéricos o null si no es calculable.
   */
  calculateSRR(saved, reach) {
    if (
      typeof reach !== 'number' ||
      typeof saved !== 'number' ||
      !Number.isFinite(reach) ||
      !Number.isFinite(saved) ||
      reach <= 0 ||
      saved < 0
    ) {
      return null;
    }

    const ratio = (saved / reach) * 100;
    return Number.isFinite(ratio) ? Number(ratio.toFixed(2)) : null;
  }

  /**
   * Resuelve el formato normalizado de una publicación.
   * @param {object} post - Objeto post.
   * @returns {string} Formato normalizado ('carousel', 'reel', 'single', 'news-post', 'price-story').
   */
  resolvePostFormat(post) {
    if (!post || typeof post !== 'object') return 'single';
    const raw = String(post.format || post.contentType || '').trim().toLowerCase();

    if (raw === 'carousel') return 'carousel';
    if (raw === 'reel' || raw === 'video' || raw === 'audio-reel') return 'reel';
    if (raw === 'news-post' || raw === 'news') return 'news-post';
    if (raw === 'price-story' || raw === 'story') return 'price-story';
    if (raw === 'single' || raw === 'image' || raw === 'flyer') return 'single';

    if (SUPPORTED_FORMATS.includes(raw)) return raw;
    return 'single';
  }

  /**
   * Determina si un post tiene métricas cuantitativas reales registradas.
   * @param {object} post - Objeto post.
   * @returns {boolean}
   */
  isPostMeasured(post) {
    if (!post || !post.metrics || typeof post.metrics !== 'object' || Array.isArray(post.metrics)) {
      return false;
    }
    const metricKeys = ['reach', 'saved', 'impressions', 'likes', 'comments', 'shares', 'total_interactions'];
    return metricKeys.some(k => typeof post.metrics[k] === 'number' && Number.isFinite(post.metrics[k]));
  }

  /**
   * Calcula agregaciones (totales, promedios y top performer) para una colección de posts clasificados.
   * @param {Array<object>} items - Lista de posts enriquecidos.
   * @returns {object} Métricas agregadas del grupo.
   */
  _aggregateGroup(items) {
    const totalPosts = items.length;
    const measuredItems = items.filter(i => i.isMeasured);
    const measuredPosts = measuredItems.length;
    const pendingMetricsPosts = totalPosts - measuredPosts;

    // Promedio de reach: solo posts con reach numérico >= 0
    const reachValues = items
      .map(i => i.post?.metrics?.reach)
      .filter(r => typeof r === 'number' && Number.isFinite(r) && r >= 0);

    const averageReach = reachValues.length > 0
      ? Number((reachValues.reduce((acc, v) => acc + v, 0) / reachValues.length).toFixed(1))
      : null;

    // Promedio de saved: solo posts con saved numérico >= 0
    const savedValues = items
      .map(i => i.post?.metrics?.saved)
      .filter(s => typeof s === 'number' && Number.isFinite(s) && s >= 0);

    const averageSaved = savedValues.length > 0
      ? Number((savedValues.reduce((acc, v) => acc + v, 0) / savedValues.length).toFixed(1))
      : null;

    // Promedio de SRR: solo de posts medidos con SRR calculable
    const srrValues = items
      .map(i => i.srr)
      .filter(s => typeof s === 'number' && Number.isFinite(s));

    const averageSRR = srrValues.length > 0
      ? Number((srrValues.reduce((acc, v) => acc + v, 0) / srrValues.length).toFixed(2))
      : null;

    // Top performer: post medido con mayor SRR
    let topPerformer = null;
    const itemsWithSRR = items.filter(i => typeof i.srr === 'number' && Number.isFinite(i.srr));
    if (itemsWithSRR.length > 0) {
      itemsWithSRR.sort((a, b) => b.srr - a.srr);
      const best = itemsWithSRR[0];
      topPerformer = {
        id: best.post.id,
        format: best.format,
        srr: best.srr,
        reach: best.post.metrics?.reach ?? null,
        saved: best.post.metrics?.saved ?? null,
        hypothesis: best.post.hypothesis || null,
        briefing: best.post.briefing || null,
        publishedAt: best.post.publishedAt || null
      };
    }

    return {
      totalPosts,
      measuredPosts,
      pendingMetricsPosts,
      averageReach,
      averageSaved,
      averageSRR,
      topPerformer
    };
  }

  /**
   * Analiza el historial de posts clasificando por formato y rendimiento empírico.
   *
   * @param {Array<object>} posts - Lista de publicaciones a evaluar.
   * @returns {object} Agregados globales, por formato y detalle de posts.
   */
  analyzeExperiments(posts) {
    const rawPosts = Array.isArray(posts) ? posts : [];
    // Filtrar posts que sean objetos válidos con id
    const validPosts = rawPosts.filter(p => p && typeof p === 'object' && p.id);

    // Enriquecer cada post
    const enriched = validPosts.map(post => {
      const format = this.resolvePostFormat(post);
      const isMeasured = this.isPostMeasured(post);
      const srr = isMeasured ? this.calculateSRR(post.metrics?.saved, post.metrics?.reach) : null;

      return {
        post,
        format,
        isMeasured,
        srr
      };
    });

    // Desglose por formato
    const byFormat = {};
    for (const fmt of SUPPORTED_FORMATS) {
      const formatItems = enriched.filter(e => e.format === fmt);
      byFormat[fmt] = this._aggregateGroup(formatItems);
    }

    // Resumen global
    const globalSummary = this._aggregateGroup(enriched);

    // Lista detallada de posts
    const detailedPosts = enriched.map(e => ({
      id: e.post.id,
      format: e.format,
      hypothesis: e.post.hypothesis || null,
      metrics: e.post.metrics || null,
      srr: e.srr,
      status: e.isMeasured ? 'measured' : 'pending_metrics',
      briefing: e.post.briefing || null,
      timestamp: e.post.timestamp || null,
      publishedAt: e.post.publishedAt || null
    }));

    return {
      summary: globalSummary,
      global: globalSummary,
      byFormat,
      posts: detailedPosts
    };
  }

  /**
   * Registra o actualiza la hipótesis editorial en una publicación.
   *
   * @param {string} postId - ID del post a actualizar.
   * @param {object} hypothesisData - Contiene angle obligatorio y campos opcionales.
   * @returns {object} Post actualizado.
   */
  setPostHypothesis(postId, hypothesisData) {
    if (!postId || typeof postId !== 'string') {
      const err = new Error('El ID de post es obligatorio y debe ser un string.');
      err.statusCode = 400;
      throw err;
    }

    if (!hypothesisData || typeof hypothesisData !== 'object' || Array.isArray(hypothesisData)) {
      const err = new Error('Los datos de hipótesis son inválidos o están ausentes.');
      err.statusCode = 400;
      throw err;
    }

    if (!hypothesisData.angle || typeof hypothesisData.angle !== 'string' || !hypothesisData.angle.trim()) {
      const err = new Error("El campo 'angle' es obligatorio y debe ser un texto no vacío.");
      err.statusCode = 400;
      throw err;
    }

    const allowedStatuses = ['active', 'validated', 'invalidated'];
    if (hypothesisData.status && !allowedStatuses.includes(hypothesisData.status)) {
      const err = new Error(`El campo 'status' debe ser uno de: ${allowedStatuses.join(', ')}.`);
      err.statusCode = 400;
      throw err;
    }

    const posts = this.postService.getAll();
    const existingPost = posts.find(p => p.id === postId);
    if (!existingPost) {
      const err = new Error(`Post con ID '${postId}' no encontrado.`);
      err.statusCode = 404;
      throw err;
    }

    const hypothesis = {
      angle: hypothesisData.angle.trim(),
      expectedOutcome: (typeof hypothesisData.expectedOutcome === 'string' && hypothesisData.expectedOutcome.trim())
        ? hypothesisData.expectedOutcome.trim()
        : null,
      notes: (typeof hypothesisData.notes === 'string' && hypothesisData.notes.trim())
        ? hypothesisData.notes.trim()
        : null,
      status: hypothesisData.status || existingPost.hypothesis?.status || 'active',
      createdAt: existingPost.hypothesis?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const updated = this.postService.update(postId, { hypothesis });
    return updated;
  }
}

const defaultExperimentService = new ExperimentService();
defaultExperimentService.ExperimentService = ExperimentService;
module.exports = defaultExperimentService;
