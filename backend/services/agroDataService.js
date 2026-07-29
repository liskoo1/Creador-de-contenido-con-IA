const mysql = require('mysql2/promise');
const geminiService = require('./geminiService');
const botStateService = require('./botStateService');

const ALMERIA_KEYWORDS = [
  'almería', 'almeria', 'el ejido', 'níjar', 'nijar', 'roquetas',
  'vícar', 'vicar', 'adra', 'berja', 'cuevas del almanzora',
  'huércal', 'huercal', 'gádor', 'gador', 'dalías', 'dalias',
  'poniente almeriense', 'levante almeriense', 'costa de almería',
  'costa de almeria', 'campo de dalías', 'campo de nijar'
];

const ANDALUCIA_KEYWORDS = [
  'andalucía', 'andalucia', 'andluz', 'sevilla', 'granada', 'málaga',
  'malaga', 'córdoba', 'cordoba', 'jaén', 'jaen', 'huelva', 'cádiz', 'cadiz',
  'invernadero', 'hortícola', 'horticola'
];

class AgroDataService {
  constructor() {
    this.pool = null;
  }

  _getPool() {
    if (this.pool) return this.pool;

    const host = process.env.MYSQL_HOST;
    if (!host) {
      throw new Error('Configura las credenciales MySQL en el archivo .env (MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD)');
    }

    this.pool = mysql.createPool({
      host,
      port: parseInt(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'fullagro',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0
    });
    return this.pool;
  }

  async getLatestPrices(count = 6) {
    const pool = this._getPool();
    const limit = parseInt(count || process.env.AGRO_PRICE_CARD_COUNT || 6);

    const [rows] = await pool.query(
      `SELECT NombreProductoCompleto, Precio, Fecha
       FROM preciosmedios
       WHERE Fecha = (SELECT MAX(Fecha) FROM preciosmedios)
       ORDER BY RAND()
       LIMIT ?`,
      [limit]
    );

    return rows;
  }

  /**
   * Noticias del día: prioriza CURDATE(); si no hay, el día más reciente en BD.
   */
  async getLatestNews() {
    const pool = this._getPool();

    const [todayRows] = await pool.execute(
      `SELECT Id, Titulo, Resumen, UrlImagenPrincipal, FechaPublicacionNoticia, TemasRelacionados, Slug
       FROM noticias
       WHERE DATE(FechaPublicacionNoticia) = CURDATE()
       ORDER BY FechaPublicacionNoticia DESC`
    );

    if (todayRows.length > 0) {
      console.log(`[AgroData] ${todayRows.length} noticias de hoy (CURDATE).`);
      return todayRows;
    }

    const [rows] = await pool.execute(
      `SELECT Id, Titulo, Resumen, UrlImagenPrincipal, FechaPublicacionNoticia, TemasRelacionados, Slug
       FROM noticias
       WHERE DATE(FechaPublicacionNoticia) = (
         SELECT DATE(MAX(FechaPublicacionNoticia)) FROM noticias
       )
       ORDER BY FechaPublicacionNoticia DESC`
    );

    console.log(`[AgroData] Sin noticias de hoy; usando último día en BD (${rows.length} items).`);
    return rows;
  }

  _newsSearchText(n) {
    const temas = typeof n.TemasRelacionados === 'string'
      ? n.TemasRelacionados
      : JSON.stringify(n.TemasRelacionados || '');
    return `${n.Titulo || ''} ${n.Resumen || ''} ${temas}`.toLowerCase();
  }

  _matchesAny(text, keywords) {
    return keywords.some(k => text.includes(k.toLowerCase()));
  }

  /**
   * Selección con prioridad: Almería → Andalucía → resto.
   * Evita noticias ya publicadas recientemente.
   */
  async selectMostImportantNews(noticias) {
    if (!noticias || noticias.length === 0) return null;
    if (noticias.length === 1) return noticias[0];

    const recentIds = new Set((botStateService.getRecentNewsIds() || []).map(String));
    let pool = noticias.filter(n => !recentIds.has(String(n.Id)));
    if (pool.length === 0) {
      console.warn('[AgroData] Todas las noticias del día ya se publicaron; reutilizando pool completo.');
      pool = [...noticias];
    }

    const almeria = pool.filter(n => this._matchesAny(this._newsSearchText(n), ALMERIA_KEYWORDS));
    const andalucia = pool.filter(n => this._matchesAny(this._newsSearchText(n), ANDALUCIA_KEYWORDS));

    let candidates = pool;
    let tier = 'general';
    if (almeria.length > 0) {
      candidates = almeria;
      tier = 'Almería';
    } else if (andalucia.length > 0) {
      candidates = andalucia;
      tier = 'Andalucía';
    }

    console.log(`[AgroData] Selección noticia: tier=${tier}, candidatas=${candidates.length}/${pool.length}`);

    if (candidates.length === 1) return candidates[0];

    const resumenList = candidates.map((n, i) =>
      `${i + 1}. TITULO: ${n.Titulo}\n   RESUMEN: ${(n.Resumen || '').substring(0, 200)}...`
    ).join('\n\n');

    const geoHint = tier === 'Almería'
      ? 'PRIORIDAD MÁXIMA: todas estas noticias ya son de Almería o su entorno. Elige la más impactante.'
      : tier === 'Andalucía'
        ? 'PRIORIDAD: noticias andaluzas. Prefiere Almería si aparece; si no, la más relevante para agricultura andaluza.'
        : 'PRIORIDAD GEOGRÁFICA: si alguna menciona Almería, elígela. Si no, Andalucía. Si no, la más importante del sector.';

    const prompt = `
Eres un editor jefe de HelpMeAgro (Almería / agricultura andaluza).
${geoHint}
De estas noticias, selecciona LA MÁS IMPORTANTE para nuestra audiencia local.
Responde SOLO con el numero de la noticia elegida (1, 2, 3, etc.), sin explicaciones.

NOTICIAS:
${resumenList}

NUMERO ELEGIDO:`;

    const response = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.3 });
    const match = response.match(/\d+/);
    const index = match ? parseInt(match[0]) - 1 : 0;

    return candidates[Math.min(Math.max(index, 0), candidates.length - 1)];
  }

  getNewsUrl(noticia) {
    const base = (process.env.HELPMEAGRO_PUBLIC_URL || 'https://www.helpmeagro.com').replace(/\/+$/, '');
    const slug = noticia.Slug || '';
    return `${base}/noticia/${noticia.Id}/${slug}`;
  }

  getNewsImageUrl(noticia) {
    if (!noticia.UrlImagenPrincipal) return null;
    const imagePath = noticia.UrlImagenPrincipal.startsWith('/')
      ? noticia.UrlImagenPrincipal.substring(1)
      : noticia.UrlImagenPrincipal;
    const serverUrl = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`).trim().replace(/\/+$/, '');
    return `${serverUrl}/${imagePath}`;
  }

  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = new AgroDataService();
