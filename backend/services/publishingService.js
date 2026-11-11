const instagramPublisher = require('../automation/instagramPublisher');
const facebookPublisher = require('../automation/facebookPublisher');

const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v)(?:$|\?)/i;

/**
 * Servicio de publicación multi-plataforma (Instagram + Facebook Page).
 * Credenciales vía .env (tokens de acceso), sin OAuth.
 */
class PublishingService {
  constructor(deps = {}) {
    this.instagramPublisher = deps.instagramPublisher || instagramPublisher;
    this.facebookPublisher = deps.facebookPublisher || facebookPublisher;
  }

  isVideoUrl(url) {
    return typeof url === 'string' && VIDEO_EXT_RE.test(url);
  }

  getVideoUrl(post) {
    if (!post) return null;
    if (typeof post.video === 'string' && this.isVideoUrl(post.video)) return post.video;
    if (post.video && typeof post.video.url === 'string' && this.isVideoUrl(post.video.url)) {
      return post.video.url;
    }
    const visuals = Array.isArray(post.visuals) ? post.visuals : [];
    return visuals.find((u) => this.isVideoUrl(u)) || null;
  }

  /**
   * Decide tipo Graph (reel/image/carousel/story) según el archivo real, no solo contentType.
   * Evita enviar un MP4 a /photos (Facebook #100 subcode 1366046).
   */
  resolvePublishJob(post) {
    if (!post) return null;
    const contentType = post.contentType || 'post';
    const visuals = Array.isArray(post.visuals) ? post.visuals.filter(Boolean) : [];
    const imageVisuals = visuals.filter((u) => !this.isVideoUrl(u));
    const videoUrl = this.getVideoUrl(post);

    if (contentType === 'price-story' && visuals[0]) {
      return {
        type: 'story',
        path: visuals[0],
        extra: this.isVideoUrl(visuals[0]) ? 'VIDEO' : 'IMAGE',
        options: { facebookAsPageStory: true }
      };
    }

    if (videoUrl) {
      return { type: 'reel', path: videoUrl };
    }

    if ((contentType === 'carousel' || imageVisuals.length > 1) && imageVisuals.length > 1) {
      return { type: 'carousel', path: imageVisuals };
    }

    if (imageVisuals.length >= 1) {
      return { type: 'image', path: imageVisuals[0] };
    }

    return null;
  }

  _coerceVideoType(localPath, type) {
    if (Array.isArray(localPath) && localPath.length === 1 && this.isVideoUrl(localPath[0])) {
      return { localPath: localPath[0], type: type === 'story' ? 'story' : 'reel' };
    }
    if (!Array.isArray(localPath) && this.isVideoUrl(localPath) && (type === 'image' || type === 'carousel')) {
      return { localPath, type: 'reel' };
    }
    return { localPath, type };
  }

  _normalizePlatformResult(rawResult, requested) {
    if (!requested) {
      return {
        success: false,
        postId: null,
        error: null,
        mock: false,
        skipped: true,
        message: 'Plataforma no solicitada.'
      };
    }

    if (!rawResult) {
      return {
        success: false,
        postId: null,
        error: 'Sin respuesta del publicador.',
        mock: false,
        skipped: false
      };
    }

    const success = rawResult.success === true;
    const postId = success ? (rawResult.postId || rawResult.id || null) : null;
    const mock = Boolean(rawResult.mock);
    const skipped = Boolean(rawResult.skipped);
    const error = success
      ? null
      : (rawResult.error || (mock ? (rawResult.message || 'Credenciales no configuradas.') : 'Error en la publicación.'));

    return {
      success,
      postId,
      error,
      mock,
      skipped,
      ...(rawResult.message ? { message: rawResult.message } : {})
    };
  }

  /**
   * @param {string|string[]} localPath
   * @param {string} type 'image' | 'story' | 'reel' | 'carousel'
   * @param {any} extra Caption IG o tipo de historia (IMAGE/VIDEO)
   * @param {string|null} facebookCaption Caption FB (si null, reutiliza el de IG)
   * @param {{ platforms?: Array<'instagram'|'facebook'>, facebookAsPageStory?: boolean }} options
   *   facebookAsPageStory: solo price-story → historia 24h en la Page; el resto de stories van al feed.
   */
  async publishViaBridge(localPath, type, extra, facebookCaption = null, options = {}) {
    ({ localPath, type } = this._coerceVideoType(localPath, type));
    const serverUrl = (process.env.SERVER_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
    const platforms = Array.isArray(options.platforms) && options.platforms.length
      ? options.platforms.map(p => String(p).toLowerCase())
      : ['instagram', 'facebook'];
    const doIg = platforms.includes('instagram');
    const doFb = platforms.includes('facebook');
    const facebookAsPageStory = options.facebookAsPageStory === true;

    const toPublicUrl = (p) => {
      if (typeof p === 'string' && p.startsWith('http') && !p.startsWith('http://localhost')) {
        return p;
      }
      if (typeof p === 'string' && p.startsWith('http://localhost')) {
        const urlObj = new URL(p);
        return `${serverUrl}${urlObj.pathname}`;
      }
      const cleanPath = p.startsWith('/') ? p : `/${p}`;
      return `${serverUrl}${cleanPath}`;
    };

    const igConfigured = !!(process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_ACCOUNT_ID);
    const fbConfigured = typeof this.facebookPublisher.isConfigured === 'function'
      ? this.facebookPublisher.isConfigured()
      : false;

    const igCaption = type === 'story' ? null : (extra || '');
    const storyMediaType = type === 'story' ? (extra || 'IMAGE') : 'IMAGE';
    const fbCaption = facebookCaption != null ? facebookCaption : (igCaption || '');

    const results = { instagram: null, facebook: null };

    if (doIg) {
      if (igConfigured) {
        try {
          if (Array.isArray(localPath)) {
            const imageUrls = localPath.map(toPublicUrl);
            console.log(`[PublishingService] IG carrusel (${imageUrls.length})`);
            results.instagram = await this.instagramPublisher.publishCarousel(imageUrls, igCaption);
          } else {
            const publicUrl = toPublicUrl(localPath);
            console.log(`[PublishingService] IG ${type}: ${publicUrl}`);
            if (type === 'story') results.instagram = await this.instagramPublisher.publishStory(publicUrl, storyMediaType);
            else if (type === 'reel') results.instagram = await this.instagramPublisher.publishReel(publicUrl, igCaption);
            else results.instagram = await this.instagramPublisher.publishImage(publicUrl, igCaption);
          }
        } catch (e) {
          console.error('[PublishingService] Error IG:', e.message);
          results.instagram = { success: false, error: e.message };
        }
      } else {
        console.warn('[PublishingService] Instagram no configurado en .env — omitiendo.');
        results.instagram = { success: false, mock: true, message: 'INSTAGRAM_ACCESS_TOKEN / ACCOUNT_ID no configurados.' };
      }
    } else {
      results.instagram = { success: false, skipped: true, message: 'Plataforma no solicitada.' };
    }

    if (doFb) {
      if (fbConfigured) {
        try {
          if (Array.isArray(localPath)) {
            const imageUrls = localPath.map(toPublicUrl);
            console.log(`[PublishingService] FB carrusel (${imageUrls.length})`);
            results.facebook = await this.facebookPublisher.publishCarousel(imageUrls, fbCaption);
          } else {
            const publicUrl = toPublicUrl(localPath);
            console.log(`[PublishingService] FB ${type}: ${publicUrl}`);
            if (type === 'story') {
              results.facebook = await this.facebookPublisher.publishStory(publicUrl, storyMediaType, {
                asPageStory: facebookAsPageStory
              });
            } else if (type === 'reel') results.facebook = await this.facebookPublisher.publishVideo(publicUrl, fbCaption);
            else results.facebook = await this.facebookPublisher.publishImage(publicUrl, fbCaption);
          }
        } catch (e) {
          console.error('[PublishingService] Error FB:', e.message);
          results.facebook = { success: false, error: e.message };
        }
      } else {
        console.warn('[PublishingService] Facebook no configurado en .env — omitiendo.');
        results.facebook = { success: false, mock: true, message: 'FACEBOOK_PAGE_ID / ACCESS_TOKEN no configurados.' };
      }
    } else {
      results.facebook = { success: false, skipped: true, message: 'Plataforma no solicitada.' };
    }

    const igResult = this._normalizePlatformResult(results.instagram, doIg);
    const fbResult = this._normalizePlatformResult(results.facebook, doFb);

    const requestedEntries = [];
    if (doIg) requestedEntries.push({ platform: 'instagram', res: igResult });
    if (doFb) requestedEntries.push({ platform: 'facebook', res: fbResult });

    const totalRequested = requestedEntries.length;
    const successCount = requestedEntries.filter(entry => entry.res.success).length;

    const success = successCount > 0;
    const allOk = totalRequested > 0 && successCount === totalRequested;
    const partial = totalRequested > 1 && successCount > 0 && successCount < totalRequested;
    const bothMock = totalRequested > 0 && requestedEntries.every(entry => entry.res.mock);

    const failedErrors = requestedEntries
      .filter(entry => !entry.res.success)
      .map(entry => `${entry.platform}: ${entry.res.error || entry.res.message || 'falló'}`);

    const topLevelError = !success
      ? (failedErrors.length > 0 ? failedErrors.join(' | ') : 'Ninguna red pudo publicar.')
      : (partial ? `Publicación parcial (${failedErrors.join(' | ')})` : undefined);

    return {
      success,
      allOk,
      partial,
      mock: bothMock,
      platforms,
      instagram: igResult,
      facebook: fbResult,
      mediaType: type === 'reel' ? 'reel' : (Array.isArray(localPath) ? 'carousel' : type),
      error: topLevelError
    };
  }
}

const defaultInstance = new PublishingService();
defaultInstance.PublishingService = PublishingService;

module.exports = defaultInstance;
