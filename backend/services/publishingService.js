const instagramPublisher = require('../automation/instagramPublisher');
const facebookPublisher = require('../automation/facebookPublisher');

/**
 * Servicio de publicación multi-plataforma (Instagram + Facebook Page).
 * Credenciales vía .env (tokens de acceso), sin OAuth.
 */
class PublishingService {
  /**
   * @param {string|string[]} localPath
   * @param {string} type 'image' | 'story' | 'reel' | 'carousel'
   * @param {any} extra Caption IG o tipo de historia (IMAGE/VIDEO)
   * @param {string|null} facebookCaption Caption FB (si null, reutiliza el de IG)
   * @param {{ platforms?: Array<'instagram'|'facebook'>, facebookAsPageStory?: boolean }} options
   *   facebookAsPageStory: solo price-story → historia 24h en la Page; el resto de stories van al feed.
   */
  async publishViaBridge(localPath, type, extra, facebookCaption = null, options = {}) {
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
    const fbConfigured = facebookPublisher.isConfigured();

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
            results.instagram = await instagramPublisher.publishCarousel(imageUrls, igCaption);
          } else {
            const publicUrl = toPublicUrl(localPath);
            console.log(`[PublishingService] IG ${type}: ${publicUrl}`);
            if (type === 'story') results.instagram = await instagramPublisher.publishStory(publicUrl, storyMediaType);
            else if (type === 'reel') results.instagram = await instagramPublisher.publishReel(publicUrl, igCaption);
            else results.instagram = await instagramPublisher.publishImage(publicUrl, igCaption);
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
            results.facebook = await facebookPublisher.publishCarousel(imageUrls, fbCaption);
          } else {
            const publicUrl = toPublicUrl(localPath);
            console.log(`[PublishingService] FB ${type}: ${publicUrl}`);
            if (type === 'story') {
              results.facebook = await facebookPublisher.publishStory(publicUrl, storyMediaType, {
                asPageStory: facebookAsPageStory
              });
            } else if (type === 'reel') results.facebook = await facebookPublisher.publishVideo(publicUrl, fbCaption);
            else results.facebook = await facebookPublisher.publishImage(publicUrl, fbCaption);
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

    const igOk = results.instagram?.success === true;
    const fbOk = results.facebook?.success === true;
    const igAttempted = doIg && !results.instagram?.skipped;
    const fbAttempted = doFb && !results.facebook?.skipped;
    const bothMock = !!(results.instagram?.mock && results.facebook?.mock);

    return {
      success: igOk || fbOk,
      mock: bothMock && !igOk && !fbOk,
      platforms,
      instagram: results.instagram,
      facebook: results.facebook,
      mediaType: type === 'reel' ? 'reel' : (Array.isArray(localPath) ? 'carousel' : type),
      error: ((igAttempted && !igOk) && (fbAttempted && !fbOk)) || (!igOk && !fbOk && (igAttempted || fbAttempted))
        ? (results.instagram?.error || results.facebook?.error || 'Ninguna red pudo publicar.')
        : undefined
    };
  }
}

module.exports = new PublishingService();
