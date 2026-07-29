/**
 * Publicación en Facebook Page mediante Graph API.
 * Credenciales desde .env (sin OAuth):
 *   FACEBOOK_PAGE_ID
 *   FACEBOOK_PAGE_ACCESS_TOKEN  (Page Access Token de larga duración — NO User token)
 *
 * Permisos necesarios al generar el User token (antes de intercambiar por Page token):
 *   pages_show_list, pages_read_engagement, pages_manage_posts
 *   (+ publish_video recomendado si Graph Explorer / App Review lo ofrece)
 * Stories de Page: photo_stories / video_stories (mismo pages_manage_posts).
 * El usuario debe tener tarea CREATE_CONTENT (o Admin) en la Page.
 */
const GRAPH_BASE = 'https://graph.facebook.com/v25.0';

const VIDEO_PERMISSION_HINT =
  'Meta rechazó el vídeo (#100). Usa un Page Access Token (no User token) en FACEBOOK_PAGE_ACCESS_TOKEN. ' +
  'Obténlo con GET /me/accounts tras un User token de larga duración con scopes: ' +
  'pages_show_list, pages_read_engagement, pages_manage_posts. ' +
  'El usuario debe poder CREATE_CONTENT en la Page. Reinicia el backend tras actualizar el .env.';

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

  _formatGraphError(data, fallback = 'Error de Graph API') {
    const err = data?.error;
    if (!err) return fallback;
    const code = err.code != null ? ` (#${err.code})` : '';
    const sub = err.error_subcode != null ? ` subcode=${err.error_subcode}` : '';
    return `${err.message || fallback}${code}${sub}`;
  }

  _isVideoPermissionError(message) {
    const m = String(message || '').toLowerCase();
    return m.includes('no permission to publish the video')
      || (m.includes('#100') && m.includes('permission') && m.includes('video'));
  }

  /**
   * Comprueba que el token sea de Page (no de usuario) y coincida con FACEBOOK_PAGE_ID.
   * Con Page Access Token, GET /me resuelve a la Page.
   */
  async _assertPageAccessToken() {
    const { pageId, pageToken } = this._getCredentials();
    if (!pageId || !pageToken) {
      throw new Error('FACEBOOK_PAGE_ID / FACEBOOK_PAGE_ACCESS_TOKEN no configurados.');
    }

    const meRes = await fetch(
      `${GRAPH_BASE}/me?fields=id,name&access_token=${encodeURIComponent(pageToken)}`
    );
    const me = await meRes.json();
    if (me.error) {
      throw new Error(this._formatGraphError(me, 'Token de Facebook inválido o caducado'));
    }

    const tokenSubjectId = String(me.id || '');
    if (tokenSubjectId && tokenSubjectId !== String(pageId)) {
      throw new Error(
        `FACEBOOK_PAGE_ACCESS_TOKEN no es un Page Access Token de la Page ${pageId}. ` +
        `GET /me devolvió id=${tokenSubjectId} (${me.name || 'sin nombre'}) — parece User token u otra Page. ` +
        'Intercambia un User token de larga duración vía GET /me/accounts y copia el access_token de tu Page.'
      );
    }

    const pageRes = await fetch(
      `${GRAPH_BASE}/${encodeURIComponent(pageId)}?fields=id,name&access_token=${encodeURIComponent(pageToken)}`
    );
    const page = await pageRes.json();
    if (page.error) {
      throw new Error(
        this._formatGraphError(page, 'El token no puede acceder a FACEBOOK_PAGE_ID')
      );
    }

    return { pageId, pageToken, pageName: page.name || me.name };
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
      if (data.error) throw new Error(this._formatGraphError(data));

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
      // Validar Page Access Token antes de subir (evita el #100 críptico de User token).
      await this._assertPageAccessToken();

      const params = new URLSearchParams();
      params.append('file_url', videoUrl);
      params.append('description', caption || '');
      params.append('published', 'true');
      params.append('access_token', pageToken);

      // Host graph.facebook.com (graph-video está deprecado). file_url es válido para vídeos accesibles.
      const res = await fetch(`${GRAPH_BASE}/${pageId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      const data = await res.json();
      if (data.error) {
        const msg = this._formatGraphError(data);
        if (this._isVideoPermissionError(msg)) {
          throw new Error(`${msg} — ${VIDEO_PERMISSION_HINT}`);
        }
        throw new Error(msg);
      }

      console.log(`\x1b[32m[Facebook] ✅ Vídeo publicado. ID: ${data.id}\x1b[0m`);
      return { success: true, postId: data.id, platform: 'facebook', mediaType: 'video' };
    } catch (error) {
      const message = this._isVideoPermissionError(error.message)
        ? (error.message.includes(VIDEO_PERMISSION_HINT) ? error.message : `${error.message} — ${VIDEO_PERMISSION_HINT}`)
        : error.message;
      console.error('[Facebook] Error publicando vídeo:', message);
      return { success: false, error: message, platform: 'facebook' };
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
        if (data.error) throw new Error(`Foto ${i + 1}: ${this._formatGraphError(data)}`);
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
      if (feedData.error) throw new Error(this._formatGraphError(feedData));

      console.log(`\x1b[32m[Facebook] ✅ Carrusel publicado. ID: ${feedData.id}\x1b[0m`);
      return { success: true, postId: feedData.id, platform: 'facebook', mediaType: 'carousel' };
    } catch (error) {
      console.error('[Facebook] Error en carrusel:', error.message);
      return { success: false, error: error.message, platform: 'facebook' };
    }
  }

  /**
   * @param {string} mediaUrl
   * @param {string} mediaType 'IMAGE' | 'VIDEO'
   * @param {{ asPageStory?: boolean }} options
   *   asPageStory=true → Stories API (24h). Solo usar para price-story por ahora.
   *   asPageStory=false/omitido → post de feed (comportamiento anterior).
   */
  async publishStory(mediaUrl, mediaType = 'IMAGE', options = {}) {
    const asPageStory = options.asPageStory === true;

    if (!asPageStory) {
      console.log('[Facebook] Story → feed de la Page (no es price-story)...');
      if (String(mediaType).toUpperCase() === 'VIDEO') return this.publishVideo(mediaUrl, '');
      return this.publishImage(mediaUrl, '');
    }

    const { pageId, pageToken } = this._getCredentials();

    if (!pageId || !pageToken) {
      console.warn('[Facebook] Credenciales no configuradas. Story simulada.');
      return { success: false, mock: true, message: 'Credenciales de Facebook no configuradas.', platform: 'facebook' };
    }

    this._ensurePublicUrl(mediaUrl);

    try {
      if (String(mediaType).toUpperCase() === 'VIDEO') {
        return await this._publishVideoStory(pageId, pageToken, mediaUrl);
      }
      return await this._publishPhotoStory(pageId, pageToken, mediaUrl);
    } catch (error) {
      console.error('[Facebook] Error publicando Story:', error.message);
      return { success: false, error: error.message, platform: 'facebook' };
    }
  }

  async _publishPhotoStory(pageId, pageToken, imageUrl) {
    console.log(`[Facebook] Subiendo foto unpublished para Story (Page ${pageId})...`);

    const uploadParams = new URLSearchParams();
    uploadParams.append('url', imageUrl);
    uploadParams.append('published', 'false');
    uploadParams.append('access_token', pageToken);

    const uploadRes = await fetch(`${GRAPH_BASE}/${pageId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: uploadParams.toString()
    });
    const uploadData = await uploadRes.json();
    if (uploadData.error) throw new Error(this._formatGraphError(uploadData, 'Error subiendo foto para Story'));
    if (!uploadData.id) throw new Error('Meta no devolvió photo_id para la Story.');

    console.log(`[Facebook] Publicando photo_stories con photo_id=${uploadData.id}...`);
    const storyParams = new URLSearchParams();
    storyParams.append('photo_id', uploadData.id);
    storyParams.append('access_token', pageToken);

    const storyRes = await fetch(`${GRAPH_BASE}/${pageId}/photo_stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: storyParams.toString()
    });
    const storyData = await storyRes.json();
    if (storyData.error) throw new Error(this._formatGraphError(storyData, 'Error en photo_stories'));

    const postId = storyData.post_id || storyData.id;
    console.log(`\x1b[32m[Facebook] ✅ Story (foto) publicada. ID: ${postId}\x1b[0m`);
    return { success: true, postId, platform: 'facebook', mediaType: 'story' };
  }

  async _publishVideoStory(pageId, pageToken, videoUrl) {
    await this._assertPageAccessToken();
    console.log(`[Facebook] Iniciando video_stories (Page ${pageId})...`);

    const startParams = new URLSearchParams();
    startParams.append('upload_phase', 'start');
    startParams.append('access_token', pageToken);

    const startRes = await fetch(`${GRAPH_BASE}/${pageId}/video_stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: startParams.toString()
    });
    const startData = await startRes.json();
    if (startData.error) {
      const msg = this._formatGraphError(startData, 'Error iniciando video_stories');
      if (this._isVideoPermissionError(msg)) throw new Error(`${msg} — ${VIDEO_PERMISSION_HINT}`);
      throw new Error(msg);
    }

    const videoId = startData.video_id;
    const uploadUrl = startData.upload_url;
    if (!videoId || !uploadUrl) {
      throw new Error('Meta no devolvió video_id/upload_url para la Story de vídeo.');
    }

    console.log(`[Facebook] Subiendo vídeo a upload_url (video_id=${videoId})...`);
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${pageToken}`,
        file_url: videoUrl
      }
    });
    const uploadData = await uploadRes.json().catch(() => ({}));
    if (uploadData.error) throw new Error(this._formatGraphError(uploadData, 'Error subiendo vídeo de Story'));
    if (uploadData.success === false) {
      throw new Error(uploadData.message || 'Meta rechazó el upload del vídeo de Story.');
    }

    console.log(`[Facebook] Finalizando video_stories (publish)...`);
    const finishParams = new URLSearchParams();
    finishParams.append('upload_phase', 'finish');
    finishParams.append('video_id', videoId);
    finishParams.append('video_state', 'PUBLISHED');
    finishParams.append('access_token', pageToken);

    const finishRes = await fetch(`${GRAPH_BASE}/${pageId}/video_stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: finishParams.toString()
    });
    const finishData = await finishRes.json();
    if (finishData.error) throw new Error(this._formatGraphError(finishData, 'Error finalizando video_stories'));

    const postId = finishData.post_id || finishData.id || videoId;
    console.log(`\x1b[32m[Facebook] ✅ Story (vídeo) publicada. ID: ${postId}\x1b[0m`);
    return { success: true, postId, platform: 'facebook', mediaType: 'story' };
  }
}

module.exports = new FacebookPublisher();
