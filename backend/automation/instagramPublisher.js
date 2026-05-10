const fs = require('fs');
const path = require('path');

/**
 * Módulo de publicación en Instagram mediante la Graph API de Meta.
 * Requiere un Long-Lived Access Token y el ID de la cuenta de IG Business.
 */
class InstagramPublisher {

  /**
   * Intenta publicar el contenedor con reintentos si Meta devuelve "Media ID is not available".
   */
  async _publishContainerWithRetry(baseUrl, targetId, creationId, accessToken) {
    const publishUrl = `${baseUrl}/v25.0/${targetId}/media_publish`;
    let attempts = 0;
    const maxAttempts = 6; // ~30 segundos máximo

    while (attempts < maxAttempts) {
      const publishResponse = await fetch(publishUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: creationId, access_token: accessToken })
      });
      const publishData = await publishResponse.json();

      if (!publishData.error) {
        return publishData; // Éxito
      }

      if (publishData.error.message && publishData.error.message.includes('Media ID is not available')) {
        attempts++;
        console.log(`[Instagram] ⏳ Media ID no disponible aún en Meta. Reintentando en 5s... (Intento ${attempts}/${maxAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else {
        throw new Error(publishData.error.message); // Otro error real
      }
    }
    throw new Error('Timeout esperando a que el Media ID esté disponible para publicación en Meta.');
  }

  /**
   * Publica una imagen con caption en Instagram.
   * @param {string} imageUrl - URL pública de la imagen (debe ser accesible por Meta).
   * @param {string} caption - Texto del post con hashtags.
   * @returns {object} - Resultado de la publicación.
   */
  async publishImage(imageUrl, caption) {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      console.warn('[Instagram] Credenciales de Meta no configuradas. Publicación simulada.');
      return { success: false, mock: true, message: 'Credenciales no configuradas.' };
    }

    if (imageUrl.includes('localhost')) {
      throw new Error('Meta no puede acceder a URLs de "localhost". Configura PUBLIC_BASE_URL en el archivo .env con una URL pública (ej: ngrok).');
    }

    console.log(`[Instagram] Intentando publicar. ID Cuenta: "${accountId}", Token (recortado): "${accessToken.substring(0, 10)}..."`);

    try {
      const isIgToken = accessToken.startsWith('IG');
      const baseUrl = isIgToken ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
      const targetId = isIgToken ? 'me' : accountId;

      // Paso 1: Crear el contenedor de medios
      const createUrl = `${baseUrl}/v25.0/${targetId}/media`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          caption: caption,
          access_token: accessToken
        })
      });
      const createData = await createResponse.json();

      if (createData.error) {
        throw new Error(createData.error.message);
      }

      const creationId = createData.id;
      console.log(`[Instagram] Contenedor creado: ${creationId}`);

      // Paso 1.5: Esperar a que el contenedor esté listo (Meta a veces necesita tiempo incluso para imágenes)
      let isReady = false;
      let attempts = 0;
      while (!isReady && attempts < 10) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Esperar 3s
        attempts++;
        const checkUrl = `${baseUrl}/v25.0/${creationId}?fields=status_code&access_token=${accessToken}`;
        const checkRes = await fetch(checkUrl);
        const checkData = await checkRes.json();
        if (checkData.status_code === 'FINISHED') {
          isReady = true;
        } else if (checkData.status_code === 'ERROR') {
          throw new Error('Meta reportó un error al procesar la imagen.');
        }
      }

      // Paso 2: Publicar el contenedor
      const publishData = await this._publishContainerWithRetry(baseUrl, targetId, creationId, accessToken);

      console.log(`\x1b[32m[Instagram] ✅ Publicado exitosamente. ID: ${publishData.id}\x1b[0m`);
      return { success: true, postId: publishData.id };

    } catch (error) {
      console.error('[Instagram] Error publicando:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Publica un Reel (vídeo) en Instagram.
   * @param {string} videoUrl - URL pública del vídeo (debe ser accesible por Meta).
   * @param {string} caption - Texto del reel con hashtags.
   * @returns {object} - Resultado de la publicación.
   */
  async publishReel(videoUrl, caption) {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      console.warn('[Instagram] Credenciales de Meta no configuradas. Reel simulado.');
      return { success: false, mock: true, message: 'Credenciales no configuradas.' };
    }

    if (videoUrl.includes('localhost')) {
      throw new Error('Meta no puede acceder a URLs de "localhost". Configura PUBLIC_BASE_URL en el archivo .env con una URL pública (ej: ngrok).');
    }

    console.log(`[Instagram] Intentando publicar REEL. ID Cuenta: "${accountId}", Video URL: "${videoUrl}"`);

    try {
      const isIgToken = accessToken.startsWith('IG');
      const baseUrl = isIgToken ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
      const targetId = isIgToken ? 'me' : accountId;

      // Paso 1: Crear el contenedor de medios con media_type REELS
      const createUrl = `${baseUrl}/v25.0/${targetId}/media`;
      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          video_url: videoUrl,
          caption: caption,
          share_to_feed: true,
          access_token: accessToken
        })
      });
      const createData = await createResponse.json();

      if (createData.error) {
        throw new Error(createData.error.message);
      }

      const creationId = createData.id;
      console.log(`[Instagram] Contenedor REEL creado: ${creationId}`);

      // Paso 2: Esperar a que el vídeo se procese (Meta necesita tiempo)
      let isReady = false;
      let attempts = 0;
      const maxAttempts = 30; // ~2.5 minutos máximo
      while (!isReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 5000)); // 5s entre checks
        attempts++;

        const checkUrl = `${baseUrl}/v25.0/${creationId}?fields=status_code&access_token=${accessToken}`;
        const checkRes = await fetch(checkUrl);
        const checkData = await checkRes.json();

        console.log(`[Instagram] REEL status check (${attempts}/${maxAttempts}): ${checkData.status_code}`);

        if (checkData.status_code === 'FINISHED') {
          isReady = true;
        } else if (checkData.status_code === 'ERROR') {
          throw new Error('Meta no pudo procesar el vídeo del Reel.');
        }
      }

      if (!isReady) {
        throw new Error('Timeout esperando a que Meta procese el vídeo del Reel.');
      }

      // Paso 3: Publicar el contenedor
      const publishData = await this._publishContainerWithRetry(baseUrl, targetId, creationId, accessToken);

      console.log(`\x1b[32m[Instagram] ✅ REEL publicado exitosamente. ID: ${publishData.id}\x1b[0m`);
      return { success: true, postId: publishData.id, mediaType: 'reel' };

    } catch (error) {
      console.error('[Instagram] Error publicando REEL:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Publica una historia (Story) en Instagram.
   * @param {string} mediaUrl - URL pública de la imagen o vídeo.
   * @param {string} mediaType - 'IMAGE' o 'VIDEO'.
   * @returns {object} - Resultado de la publicación.
   */
  async publishStory(mediaUrl, mediaType = 'IMAGE') {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      console.warn('[Instagram] Credenciales de Meta no configuradas. Story simulada.');
      return { success: false, mock: true, message: 'Credenciales no configuradas.' };
    }

    if (mediaUrl.includes('localhost')) {
      throw new Error('Meta no puede acceder a URLs de "localhost". Configura PUBLIC_BASE_URL en el archivo .env con una URL pública (ej: ngrok).');
    }

    console.log(`[Instagram] Intentando publicar STORY (${mediaType}). URL: "${mediaUrl}"`);

    try {
      const isIgToken = accessToken.startsWith('IG');
      const baseUrl = isIgToken ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
      const targetId = isIgToken ? 'me' : accountId;

      // Paso 1: Crear el contenedor de medios con media_type STORIES
      const createUrl = `${baseUrl}/v25.0/${targetId}/media`;
      const body = {
        media_type: 'STORIES',
        access_token: accessToken
      };

      if (mediaType === 'VIDEO') {
        body.video_url = mediaUrl;
      } else {
        body.image_url = mediaUrl;
      }

      const createResponse = await fetch(createUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const createData = await createResponse.json();

      if (createData.error) {
        throw new Error(createData.error.message);
      }

      const creationId = createData.id;
      console.log(`[Instagram] Contenedor STORY creado: ${creationId}`);

      // Paso 2: Esperar a que se procese el contenedor en Meta
      let isReady = false;
      let attempts = 0;
      const maxAttempts = mediaType === 'VIDEO' ? 30 : 10; // Videos necesitan más tiempo
      while (!isReady && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        attempts++;
        const checkRes = await fetch(`${baseUrl}/v25.0/${creationId}?fields=status_code&access_token=${accessToken}`);
        const checkData = await checkRes.json();
        if (checkData.status_code === 'FINISHED') isReady = true;
        else if (checkData.status_code === 'ERROR') throw new Error(`Error procesando media de Story (${mediaType}).`);
      }
      if (!isReady) throw new Error(`Timeout procesando media de Story (${mediaType}).`);

      // Paso 3: Publicar el contenedor
      const publishData = await this._publishContainerWithRetry(baseUrl, targetId, creationId, accessToken);

      console.log(`\x1b[32m[Instagram] ✅ STORY publicada exitosamente. ID: ${publishData.id}\x1b[0m`);
      return { success: true, postId: publishData.id, mediaType: 'story' };

    } catch (error) {
      console.error('[Instagram] Error publicando STORY:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Publica un carrusel de imágenes.
   * @param {string[]} imageUrls - Array de URLs públicas.
   * @param {string} caption - Texto del post.
   */
  async publishCarousel(imageUrls, caption) {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      console.warn('[Instagram] Credenciales no configuradas. Carrusel simulado.');
      return { success: false, mock: true };
    }

    if (imageUrls.some(url => url.includes('localhost'))) {
      throw new Error('Meta no puede acceder a URLs de "localhost". Configura PUBLIC_BASE_URL en el archivo .env con una URL pública (ej: ngrok).');
    }

    try {
      const isIgToken = accessToken.startsWith('IG');
      const baseUrl = isIgToken ? 'https://graph.instagram.com' : 'https://graph.facebook.com';
      const targetId = isIgToken ? 'me' : accountId;

      // Crear contenedores individuales para cada imagen
      const childIds = [];
      for (const url of imageUrls) {
        const res = await fetch(`${baseUrl}/v25.0/${targetId}/media`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: url,
            is_carousel_item: true,
            access_token: accessToken
          })
        });
        const data = await res.json();
        if (data.id) childIds.push(data.id);
      }

      // Crear el contenedor del carrusel
      const carouselRes = await fetch(`${baseUrl}/v25.0/${targetId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'CAROUSEL',
          children: childIds,
          caption: caption,
          access_token: accessToken
        })
      });
      const carouselData = await carouselRes.json();

      // Publicar el carrusel
      const publishData = await this._publishContainerWithRetry(baseUrl, targetId, carouselData.id, accessToken);

      console.log(`\x1b[32m[Instagram] ✅ CARRUSEL publicado exitosamente. ID: ${publishData.id}\x1b[0m`);
      return { success: true, postId: publishData.id, mediaType: 'carousel' };

    } catch (error) {
      console.error('[Instagram] Error en carrusel:', error.message);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new InstagramPublisher();
