const fs = require('fs');
const path = require('path');
const geminiService = require('./geminiService');
const agroDataService = require('./agroDataService');
const productContextService = require('./productContextService');

const NEWS_TEMPLATES = [
  {
    id: 'editorial-bottom',
    prompt: (titulo, footerLine) => `Create a professional Instagram post image (1:1 square, 1080x1080px) for an agricultural news article.
DESIGN: Square 1:1. Background: original editorial scene of Almería greenhouse fields / Mediterranean agriculture (no real-person portraits). Semi-transparent dark gradient on the BOTTOM third.
Headline in white bold sans-serif over the dark area: "${titulo}". Green/teal accent bar ABOVE the headline.${footerLine}
Clean editorial/news aesthetic. Text fully readable. Polished social media composition.`
  },
  {
    id: 'magazine-cover',
    prompt: (titulo, footerLine) => `Create a bold magazine-cover style Instagram post (1:1, 1080x1080px) about agriculture.
DESIGN: Full-bleed agricultural background (fields, greenhouses) with slight cinematic grade — no identifiable people. Large stacked headline in the CENTER/UPPER half in heavy white typography with soft shadow: "${titulo}".
Thin green accent line under the title. Minimal chrome, high-impact cover look.${footerLine}
No clutter. Premium agricultural magazine vibe.`
  },
  {
    id: 'split-panel',
    prompt: (titulo, footerLine) => `Create a split-panel Instagram post (1:1, 1080x1080px) for agricultural news.
DESIGN: Left 55% = agricultural photo full bleed (crops/greenhouses, no faces). Right 45% = solid dark green/teal panel with the headline in white bold text: "${titulo}".
Modern newspaper digital layout. Strong contrast. Clean sans-serif.${footerLine}
Keep text fully readable on the panel side.`
  },
  {
    id: 'top-banner',
    prompt: (titulo, footerLine) => `Create an Instagram news post (1:1, 1080x1080px).
DESIGN: Agricultural landscape fills the frame (no real-person portraits). A solid dark banner strip across the TOP with white headline: "${titulo}".
Small green accent on the left edge of the banner. Contemporary broadcast-news look.${footerLine}
Sharp, readable typography.`
  },
  {
    id: 'quote-focus',
    prompt: (titulo, footerLine) => `Create an Instagram post (1:1, 1080x1080px) with quote/impact style.
DESIGN: Softened/desaturated agricultural background. Large translucent dark card centered with headline: "${titulo}".
Accent quotation mark or green corner marks. Modern NGO/press release aesthetic.${footerLine}
High readability, elegant spacing. No identifiable faces.`
  },
  {
    id: 'map-region',
    prompt: (titulo, footerLine) => `Create an Instagram post (1:1, 1080x1080px) with regional/Almería agricultural identity.
DESIGN: Greenhouse/field scene as background. Overlay subtle greenhouse/map texture in corners. Headline in lower third on dark frosted glass: "${titulo}".
Warm Mediterranean light grade, green accents, sense of place (Andalusia / Almería).${footerLine}
Professional and local. No real-person portraits.`
  }
];

const PRICE_TEMPLATES = [
  {
    id: 'dark-grid',
    build: (ctx) => `Create a professional Instagram Story image (9:16, 1080x1920px) showing 6 price cards${ctx.industry}.
DESIGN: Vertical 9:16, dark background with subtle texture.
Header: "${ctx.headerTitle}" bold white. Date "${ctx.fecha}" in cyan/teal.
6 glass cards in 2-column 3-row grid. Product name white, price large cyan with €/kg.
${ctx.footerText ? `Footer: "${ctx.footerText}"` : ''}
Green/teal accents. Modern market dashboard.${ctx.cardsText}
Use exact product names and prices. MUST be 9:16.`
  },
  {
    id: 'light-cards',
    build: (ctx) => `Create a bright Instagram Story (9:16, 1080x1920px) with 6 produce price cards${ctx.industry}.
DESIGN: Soft cream/light green gradient background. Header "${ctx.headerTitle}" in deep green.
Date "${ctx.fecha}" in muted olive. 6 white rounded cards with soft shadow in 2x3 grid.
Product names dark, prices in bold emerald green with €/kg.
${ctx.footerText ? `Footer small: "${ctx.footerText}"` : ''}
Fresh, clean, supermarket flyer energy.${ctx.cardsText}
Exact names/prices. MUST be 9:16.`
  },
  {
    id: 'ranking-list',
    build: (ctx) => `Create an Instagram Story (9:16, 1080x1920px) as a vertical RANKING LIST of 6 crop prices${ctx.industry}.
DESIGN: Dark navy background. Header "${ctx.headerTitle}" + "${ctx.fecha}".
Six horizontal rows (not a grid): left product name, right big price €/kg, thin dividers.
Accent teal highlights on prices. Minimal, data-forward.
${ctx.footerText ? `Footer: "${ctx.footerText}"` : ''}
${ctx.cardsText}
Exact names/prices. MUST be 9:16.`
  },
  {
    id: 'hero-plus-grid',
    build: (ctx) => `Create an Instagram Story (9:16, 1080x1920px) for daily produce prices${ctx.industry}.
DESIGN: Top third = bold hero title "${ctx.headerTitle}" over abstract greenhouse/field texture, date "${ctx.fecha}".
Bottom two-thirds = 6 compact cards in 2x3 with dark glass look and green accents.
${ctx.footerText ? `Footer: "${ctx.footerText}"` : ''}
${ctx.cardsText}
Exact names/prices. MUST be 9:16.`
  }
];

class AgroImageService {
  _ensureOutputDir() {
    const dir = path.join(__dirname, '..', process.env.AGRO_PRICE_CARD_OUTPUT_DIR || 'output/agro/');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  _pickTemplate(list, seed) {
    const n = Math.abs(Number(seed) || Date.now());
    return list[n % list.length];
  }

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

    const cardsData = prices.map(p => ({
      nombre: p.NombreProductoCompleto,
      precio: parseFloat(p.Precio).toFixed(2)
    }));

    const cardsText = '\nPRODUCT DATA:\n' + cardsData.map((c, i) =>
      `Card ${i + 1}: "${c.nombre}" - ${c.precio} EUR/kg`
    ).join('\n');

    const daySeed = new Date(prices[0].Fecha).getDate() + new Date().getMonth();
    const template = this._pickTemplate(PRICE_TEMPLATES, daySeed);
    console.log(`[AgroImage] Plantilla precios: ${template.id}`);

    const prompt = template.build({
      industry: industry ? ` for ${industry} products` : '',
      headerTitle: productName ? `PRECIOS ${productName.toUpperCase()}` : 'PRECIOS MEDIOS',
      fecha,
      footerText: website || '',
      cardsText
    });

    const result = await geminiService.generateImage(prompt);
    if (!result) throw new Error('Gemini no pudo generar la imagen de precios.');
    return result;
  }

  async generateNewsCopy(newsItem, newsUrl) {
    const meta = productContextService.getMetadata();
    const productContext = productContextService.getAsPromptSection();
    const industry = meta.industry || 'el sector';
    const defaultHashtags = meta.defaultHashtags || '';

    const prompt = `
Eres un community manager experto${industry !== 'el sector' ? ` del sector ${industry}` : ''}. Genera copy para redes sociales sobre esta noticia.

${productContext ? productContext : ''}

TITULO: ${newsItem.Titulo}
RESUMEN: ${(newsItem.Resumen || '').substring(0, 300)}
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
- Si la noticia es de Almería, menciónalo con naturalidad
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
    const footerLine = footerParts.length > 0
      ? `\n- Bottom of image: white text "${footerParts.join('" and smaller text "')}"`
      : '';

    const template = this._pickTemplate(NEWS_TEMPLATES, newsItem.Id || Date.now());
    console.log(`[AgroImage] Plantilla noticia: ${template.id}`);
    const prompt = template.prompt(titulo, footerLine);

    // 1:1 fijo para posts de noticia. Si Gemini bloquea la foto de referencia
    // (p.ej. político / persona real → IMAGE_OTHER), generateImage reintenta sin ella.
    const result = await geminiService.generateImage(prompt, referenceImages, '1:1');
    if (!result) throw new Error('Gemini no pudo generar la imagen de la noticia.');
    return result;
  }

  async _downloadNewsImage(imageUrl) {
    try {
      const outputDir = this._ensureOutputDir();
      const response = await fetch(imageUrl);
      if (!response.ok) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      let ext = 'jpg';
      if (contentType.includes('png') || (buffer[0] === 0x89 && buffer[1] === 0x50)) ext = 'png';
      else if (contentType.includes('webp') || (buffer[0] === 0x52 && buffer[1] === 0x49)) ext = 'webp';
      else if (contentType.includes('gif') || (buffer[0] === 0x47 && buffer[1] === 0x49)) ext = 'gif';
      else if (buffer[0] === 0xFF && buffer[1] === 0xD8) ext = 'jpg';

      const filePath = path.join(outputDir, `news_ref_${Date.now()}.${ext}`);
      fs.writeFileSync(filePath, buffer);
      return filePath;
    } catch (e) {
      console.warn('[AgroImageService] No se pudo descargar imagen de noticia:', e.message);
      return null;
    }
  }
}

module.exports = new AgroImageService();
