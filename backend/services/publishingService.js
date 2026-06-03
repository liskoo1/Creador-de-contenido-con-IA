const fs = require('fs');
const path = require('path');
const instagramPublisher = require('../automation/instagramPublisher');

/**
 * Servicio de publicación.
 * Con ngrok, las imágenes se sirven directamente desde /output/ 
 * sin necesidad de copiarlas a una carpeta externa.
 */
class PublishingService {
  /**
   * Publica contenido construyendo la URL pública desde SERVER_URL.
   * @param {string|string[]} localPath Ruta (ej: /output/img.png) o URL local o array para carrusel.
   * @param {string} type 'image', 'story', 'reel', 'carousel'
   * @param {any} extra Caption o tipo de historia (IMAGE/VIDEO)
   */
  async publishViaBridge(localPath, type, extra) {
    const serverUrl = (process.env.SERVER_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');

    const toPublicUrl = (p) => {
      // Ya es una URL externa (no localhost)
      if (typeof p === 'string' && p.startsWith('http') && !p.startsWith('http://localhost')) {
        return p;
      }
      // URL localhost: reemplazar dominio por SERVER_URL
      if (typeof p === 'string' && p.startsWith('http://localhost')) {
        const urlObj = new URL(p);
        return `${serverUrl}${urlObj.pathname}`;
      }
      // Ruta relativa: construir URL completa
      const cleanPath = p.startsWith('/') ? p : `/${p}`;
      return `${serverUrl}${cleanPath}`;
    };

    // Carrusel (array de rutas)
    if (Array.isArray(localPath)) {
      const imageUrls = localPath.map(toPublicUrl);
      console.log(`[PublishingService] Publicando carrusel (${imageUrls.length} imágenes)`);
      return await instagramPublisher.publishCarousel(imageUrls, extra);
    }

    const publicUrl = toPublicUrl(localPath);
    console.log(`[PublishingService] Publicando ${type}: ${publicUrl}`);

    if (type === 'story') return await instagramPublisher.publishStory(publicUrl, extra);
    if (type === 'reel') return await instagramPublisher.publishReel(publicUrl, extra);
    return await instagramPublisher.publishImage(publicUrl, extra);
  }
}

module.exports = new PublishingService();
