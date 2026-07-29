/**
 * Publicación en Facebook Page mediante Graph API.
 * Credenciales desde .env (sin OAuth):
 *   FACEBOOK_PAGE_ID
 *   FACEBOOK_PAGE_ACCESS_TOKEN  (Page Access Token de larga duración)
 */
const GRAPH_BASE = 'https://graph.facebook.com/v25.0';

class FacebookPublisher {

  _getCredentials() {
    return {
      pageId: (process.env.FACEBOOK_PAGE_ID || '').trim(),
      pageToken: (process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '').trim()
    };
  }

  isConfigured() {
    const { pageId, pageToken } = this._getCredentials();
    return !!(pageId && pageToken);
  }

  _ensurePublicUrl(url) {
    if (typeof url === 'string' && url.includes('localhost')) {
      throw new Error('Meta no puede acceder a URLs de "localhost". Configura SERVER_URL con una URL pública (ej: ngrok).');
    }
  }

  async publishImage(imageUrl, caption) {
    const { pageId, pageToken } = this._getCredentials();

    if (!pageId || !pageToken) {
      console.warn('[Facebook] FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN no configurados. Simulado.');
      return { success: false, mock: true, message: 'Credenciales de Facebook no configuradas.', platform: 'facebook' };
    }

    this._ensurePublicUrl(imageUrl);
    console.log(`[Facebook] Publicando imagen en Page ${pageId}...`);

    try {
      const params = new URLSearchParams();
      params.append('url', imageUrl);
      params.append('caption', caption || '');
      params.append('access_token', pageToken);

      const res = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      console.log(`\x1b[32m[Facebook] ✅ Foto publicada. ID: ${data.id || data.post_id}\x1b[0m`);
      return { success: true, postId: data.post_id || data.id, platform: 'facebook' };
    } catch (error) {
      console.error('[Facebook] Error publicando foto:', error.message);
      return { success: false, error: error.message, platform: 'facebook' };
    }
  }

  async publishVideo(videoUrl, caption) {
    const { pageId, pageToken } = this._getCredentials();

    if (!pageId || !pageToken) {
      console.warn('[Facebook] Credenciales no configuradas. Vídeo simulado.');
      return { success: false, mock: true, message: 'Credenciales de Facebook no configuradas.', platform: 'facebook' };
    }

    this._ensurePublicUrl(videoUrl);
    console.log(`[Facebook] Publicando vídeo en Page ${pageId}...`);

    try {
      const params = new URLSearchParams();
      params.append('file_url', videoUrl);
      params.append('description', caption || '');
      params.append('access_token', pageToken);

      const res = await fetch(`${GRAPH_BASE}/${pageId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);

      console.log(`\x1b[32m[Facebook] ✅ Vídeo publicado. ID: ${data.id}\x1b[0m`);
      return { success: true, postId: data.id, platform: 'facebook', mediaType: 'video' };
    } catch (error) {
      console.error('[Facebook] Error publicando vídeo:', error.message);
      return { success: false, error: error.message, platform: 'facebook' };
    }
  }

  async publishCarousel(imageUrls, caption) {
    const { pageId, pageToken } = this._getCredentials();

    if (!pageId || !pageToken) {
      console.warn('[Facebook] Credenciales no configuradas. Carrusel simulado.');
      return { success: false, mock: true, platform: 'facebook' };
    }

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      return { success: false, error: 'No hay imágenes para el carrusel de Facebook.', platform: 'facebook' };
    }

    imageUrls.forEach(url => this._ensurePublicUrl(url));

    try {
      const mediaFbids = [];

      for (let i = 0; i < imageUrls.length; i++) {
        console.log(`[Facebook] Subiendo foto ${i + 1}/${imageUrls.length} (unpublished)...`);
        const params = new URLSearchParams();
        params.append('url', imageUrls[i]);
        params.append('published', 'false');
        params.append('access_token', pageToken);

        const res = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        const data = await res.json();
        if (data.error) throw new Error(`Foto ${i + 1}: ${data.error.message}`);
        if (!data.id) throw new Error(`Meta no devolvió ID para la foto ${i + 1}.`);
        mediaFbids.push(data.id);
      }

      const feedParams = new URLSearchParams();
      feedParams.append('message', caption || '');
      mediaFbids.forEach((id, idx) => {
        feedParams.append(`attached_media[${idx}]`, JSON.stringify({ media_fbid: id }));
      });
      feedParams.append('access_token', pageToken);

      console.log(`[Facebook] Publicando post multi-foto con ${mediaFbids.length} imágenes...`);
      const feedRes = await fetch(`${GRAPH_BASE}/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: feedParams.toString()
      });
      const feedData = await feedRes.json();
      if (feedData.error) throw new Error(feedData.error.message);

      console.log(`\x1b[32m[Facebook] ✅ Carrusel publicado. ID: ${feedData.id}\x1b[0m`);
      return { success: true, postId: feedData.id, platform: 'facebook', mediaType: 'carousel' };
    } catch (error) {
      console.error('[Facebook] Error en carrusel:', error.message);
      return { success: false, error: error.message, platform: 'facebook' };
    }
  }

  /** Stories de Page: se publican como post de feed. */
  async publishStory(mediaUrl, mediaType = 'IMAGE') {
    console.log('[Facebook] Story → feed de la Page...');
    if (mediaType === 'VIDEO') return this.publishVideo(mediaUrl, '');
    return this.publishImage(mediaUrl, '');
  }
}

module.exports = new FacebookPublisher();
