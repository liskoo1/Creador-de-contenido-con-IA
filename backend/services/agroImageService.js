const fs = require('fs');
const path = require('path');
const geminiService = require('./geminiService');
const agroDataService = require('./agroDataService');
const productContextService = require('./productContextService');

class AgroImageService {
  _ensureOutputDir() {
    const dir = path.join(__dirname, '..', process.env.AGRO_PRICE_CARD_OUTPUT_DIR || 'output/agro/');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Genera una imagen 9:16 con 6 cards de precios.
   * Usa el contexto del producto para branding.
   * @param {Array} prices - Array de { NombreProductoCompleto, Precio, Fecha }
   * @returns {Promise<Object>} - { url, path } de la imagen generada
   */
  async generatePriceCardImage(prices) {
    if (!prices || prices.length === 0) {
      throw new Error('No hay precios para generar la imagen.');
    }

    const meta = productContextService.getMetadata();
    const productName = meta.productName || '';
    const website = meta.website || '';
    const industry = meta.industry || '';

    const fecha = new Date(prices[0].Fecha).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const cardsData = prices.map(p => {
      const nombre = p.NombreProductoCompleto;
      const precio = parseFloat(p.Precio).toFixed(2);
      return { nombre, precio };
    });

    const cardsText = cardsData.map((c, i) =>
      `Card ${i + 1}: "${c.nombre}" - ${c.precio} EUR/kg`
    ).join('\n');

    const headerTitle = productName ? `PRECIOS ${productName.toUpperCase()}` : 'PRECIOS MEDIOS';
    const footerText = website || '';

    const prompt = `Create a professional Instagram Story image (9:16 aspect ratio, 1080x1920px) showing 6 price cards${industry ? ` for ${industry} products` : ''}.

DESIGN SPECIFICATIONS:
- Vertical format 9:16, dark background with subtle texture
- Header at top: "${headerTitle}" in bold modern sans-serif white text
- Below header: "${fecha}" in smaller cyan/teal accent text
- 6 product cards arranged in a 2-column, 3-row grid layout
- Each card: semi-transparent dark glass card with subtle border glow
- Product name on top of each card in white text
- Price in large bold text in cyan/teal accent color with "€/kg" suffix
${footerText ? `- Footer at bottom: "${footerText}" in small white text` : ''}
- Modern, clean, professional brand aesthetic
- Use green and teal accent colors on dark background
- Add subtle gradient accents

PRODUCT DATA FOR THE 6 CARDS:
${cardsText}

IMPORTANT: Use exactly these product names and prices. Make the image look like a professional market data dashboard story. The image MUST be exactly 9:16 aspect ratio (vertical phone screen format).`;

    const result = await geminiService.generateImage(prompt);

    if (!result) {
      throw new Error('Gemini no pudo generar la imagen de precios.');
    }

    return result;
  }

  /**
   * Genera el copy para el post de noticia.
   * Usa el contexto del producto para hashtags y tono.
   * @param {Object} newsItem - Noticia con Titulo, Resumen, etc.
   * @param {string} newsUrl - URL de la noticia
   * @returns {Promise<Object>} - { facebook: {copy, hashtags}, instagram: {copy, hashtags} }
   */
  async generateNewsCopy(newsItem, newsUrl) {
    const meta = productContextService.getMetadata();
    const productContext = productContextService.getAsPromptSection();
    const industry = meta.industry || 'el sector';
    const defaultHashtags = meta.defaultHashtags || '';

    const prompt = `
Eres un community manager experto${industry !== 'el sector' ? ` del sector ${industry}` : ''}. Genera copy para redes sociales sobre esta noticia.

${productContext ? productContext : ''}

TITULO: ${newsItem.Titulo}
RESUMEN: ${newsItem.Resumen.substring(0, 300)}
ENLACE: ${newsUrl}

Genera el copy en formato JSON exacto (sin markdown):
{
  "facebook": {
    "copy": "Texto para Facebook de 2-3 frases atractivas sobre la noticia, incluyendo el enlace",
    "hashtags": "${defaultHashtags} + 3 hashtags relevantes a la noticia"
  },
  "instagram": {
    "copy": "Texto para Instagram mas visual y directo, 1-2 frases impactantes, incluyendo el enlace al final",
    "hashtags": "${defaultHashtags} + 5 hashtags relevantes a la noticia"
  }
}

IMPORTANTE:
- Tanto el copy de Facebook como el de Instagram DEBEN incluir la URL: ${newsUrl}
- Los hashtags deben ser relevantes al tema de la noticia
- Tono profesional pero cercano${industry !== 'el sector' ? `, del sector ${industry}` : ''}`;

    const response = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.7 });
    const cleaned = response.replace(/```json|```/g, '').trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      const fallbackHashtags = defaultHashtags || '#noticia';
      return {
        facebook: {
          copy: `${newsItem.Titulo}\n\nLee la noticia completa: ${newsUrl}`,
          hashtags: fallbackHashtags
        },
        instagram: {
          copy: `${newsItem.Titulo}\n\nEnlace: ${newsUrl}`,
          hashtags: fallbackHashtags
        }
      };
    }
  }

  /**
   * Genera una imagen de post para una noticia.
   * Usa la imagen original de la noticia como referencia visual.
   * @param {Object} newsItem - Noticia con Titulo, Resumen, UrlImagenPrincipal
   * @returns {Promise<Object>} - { url, path } de la imagen generada
   */
  async generateNewsPostImage(newsItem) {
    const meta = productContextService.getMetadata();
    const website = meta.website || '';
    const newsUrl = agroDataService.getNewsUrl(newsItem);
    const titulo = newsItem.Titulo;

    let referenceImages = [];
    const imageUrl = agroDataService.getNewsImageUrl(newsItem);
    if (imageUrl) {
      const localPath = await this._downloadNewsImage(imageUrl);
      if (localPath) {
        referenceImages.push({ absolutePath: localPath, description: 'Imagen original de la noticia' });
      }
    }

    const footerParts = [];
    if (website) footerParts.push(website);
    if (newsUrl) footerParts.push(newsUrl);
    const footerLine = footerParts.length > 0 ? `\n- Bottom of image: white text "${footerParts.join('" and smaller text "')}"` : '';

    const prompt = `Create a professional Instagram post image (1:1 square, 1080x1080px) for a news article.

DESIGN SPECIFICATIONS:
- Square format 1:1
- Use the reference image as the main visual element, keep its context
- Overlay a semi-transparent dark gradient at the bottom third of the image for text readability
- Add the news headline as white bold text over the dark overlay area: "${titulo}"
- IMPORTANT: The headline should be displayed completely. If it is long, wrap it into multiple lines using a clean, modern sans-serif font.
- Add a small accent bar in green/teal above the headline${footerLine}
- Clean, professional editorial/news aesthetic
- If no reference image is provided, create a professional landscape background

IMPORTANT: The text must be clearly readable. Use the reference image style as inspiration but create a new polished composition suitable for social media.`;

    const result = await geminiService.generateImage(prompt, referenceImages);

    if (!result) {
      throw new Error('Gemini no pudo generar la imagen de la noticia.');
    }

    return result;
  }

  /**
   * Descarga una imagen de noticia remota a local para usar como referencia.
   * @param {string} imageUrl - URL completa de la imagen
   * @returns {Promise<string|null>} - Ruta local o null si falla
   */
  async _downloadNewsImage(imageUrl) {
    try {
      const outputDir = this._ensureOutputDir();
      const fileName = `news_ref_${Date.now()}.png`;
      const filePath = path.join(outputDir, fileName);

      const response = await fetch(imageUrl);
      if (!response.ok) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      fs.writeFileSync(filePath, buffer);

      return filePath;
    } catch (e) {
      console.warn('[AgroImageService] No se pudo descargar imagen de noticia:', e.message);
      return null;
    }
  }
}

module.exports = new AgroImageService();
