const fs = require('fs');
const path = require('path');
const instagramPublisher = require('../automation/instagramPublisher');

/**
 * Servicio encargado de la publicación de contenido con lógica de "puente"
 * para Meta (copiar a carpeta pública -> publicar -> borrar).
 */
class PublishingService {
  /**
   * Publica contenido usando un puente.
   * @param {string|string[]} localPath Ruta relativa (ej: /output/img.png) o array de rutas para carrusel.
   * @param {string} type 'image', 'story', 'reel', 'carousel'
   * @param {any} extra Caption o tipo de historia (IMAGE/VIDEO)
   */
  async publishViaBridge(localPath, type, extra) {
    const publicBase = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
    const publicDir = process.env.PUBLIC_IMAGES_DIR;

    // Normalizar localPath si es una URL local absoluta (ej: http://localhost:3001/output/img.png)
    let pathsToProcess = localPath;
    const serverUrl = (process.env.SERVER_URL || 'http://localhost:3001').trim();
    
    const normalizePath = (p) => {
      if (typeof p === 'string' && p.startsWith(serverUrl)) {
        return p.substring(serverUrl.length); // Devuelve '/output/img.png'
      }
      if (typeof p === 'string' && p.startsWith('http://localhost')) {
        const urlObj = new URL(p);
        return urlObj.pathname;
      }
      return p;
    };

    if (Array.isArray(pathsToProcess)) {
      pathsToProcess = pathsToProcess.map(normalizePath);
    } else {
      pathsToProcess = normalizePath(pathsToProcess);
    }

    // Si sigue siendo una URL externa válida (ej: https://unsplash.com/...), publicar directamente
    if (!pathsToProcess || (typeof pathsToProcess === 'string' && pathsToProcess.startsWith('http'))) {
      if (type === 'story') return await instagramPublisher.publishStory(pathsToProcess, extra);
      if (type === 'reel') return await instagramPublisher.publishReel(pathsToProcess, extra);
      if (type === 'carousel') return await instagramPublisher.publishCarousel(pathsToProcess, extra);
      return await instagramPublisher.publishImage(pathsToProcess, extra);
    }

    // --- Caso A: Carrusel (Array de imágenes) ---
    if (Array.isArray(pathsToProcess)) {
      const imageUrls = pathsToProcess.map(v => {
        const fn = path.basename(v);
        if (publicDir) {
          const src = path.join(__dirname, '..', v.startsWith('/') ? `.${v}` : v);
          const dst = path.join(publicDir, fn);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, dst);
            setTimeout(() => { if (fs.existsSync(dst)) fs.unlinkSync(dst); }, 60000);
          }
        }
        return `${publicBase}/${fn}`;
      });
      return await instagramPublisher.publishCarousel(imageUrls, extra);
    }

    // --- Caso B: Archivo Único ---
    const fileName = path.basename(pathsToProcess);
    const publicUrl = `${publicBase}/${fileName}`;

    if (!publicDir) {
      console.warn('[PublishingService] PUBLIC_IMAGES_DIR no configurado. Usando fallback URL.');
      const fallbackUrl = `${publicBase}${pathsToProcess.startsWith('/') ? pathsToProcess : '/' + pathsToProcess}`;
      if (type === 'story') return await instagramPublisher.publishStory(fallbackUrl, extra);
      if (type === 'reel') return await instagramPublisher.publishReel(fallbackUrl, extra);
      return await instagramPublisher.publishImage(fallbackUrl, extra);
    }

    const source = path.join(__dirname, '..', pathsToProcess.startsWith('/') ? `.${pathsToProcess}` : pathsToProcess);
    const dest = path.join(publicDir, fileName);

    try {
      if (fs.existsSync(source)) {
        console.log(`[PublishingService] Copiando a ${dest}...`);
        fs.copyFileSync(source, dest);
      } else {
        console.warn(`[PublishingService] Archivo fuente no encontrado: ${source}`);
      }

      let result;
      if (type === 'story') result = await instagramPublisher.publishStory(publicUrl, extra);
      else if (type === 'reel') result = await instagramPublisher.publishReel(publicUrl, extra);
      else result = await instagramPublisher.publishImage(publicUrl, extra);

      // Limpieza diferida
      setTimeout(() => {
        try {
          if (fs.existsSync(dest)) {
            fs.unlinkSync(dest);
            console.log(`[PublishingService] Limpieza completada: ${fileName} eliminado.`);
          }
        } catch (e) {
          console.error('[PublishingService] Error borrando temporal:', e.message);
        }
      }, 60000);

      return result;
    } catch (e) {
      console.error('[PublishingService] Error en el puente:', e.message);
      throw e;
    }
  }
}

module.exports = new PublishingService();
