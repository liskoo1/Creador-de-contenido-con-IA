const mysql = require('mysql2/promise');
const geminiService = require('./geminiService');

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

  /**
   * Obtiene los precios medios de N hortalizas aleatorias del dia mas reciente.
   * @param {number} count - Numero de hortalizas a seleccionar (default: 6)
   * @returns {Promise<Array>} - Array de { NombreProductoCompleto, Precio, Fecha }
   */
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
   * Obtiene las noticias del dia mas reciente en la base de datos.
   * @returns {Promise<Array>} - Array de objetos noticia
   */
  async getLatestNews() {
    const pool = this._getPool();

    const [rows] = await pool.execute(
      `SELECT Id, Titulo, Resumen, UrlImagenPrincipal, FechaPublicacionNoticia, TemasRelacionados, Slug
       FROM noticias
       WHERE DATE(FechaPublicacionNoticia) = (
         SELECT DATE(MAX(FechaPublicacionNoticia)) FROM noticias
       )
       ORDER BY FechaPublicacionNoticia DESC`
    );

    return rows;
  }

  /**
   * Usa Gemini para seleccionar la noticia mas importante de un listado.
   * @param {Array} noticias - Array de noticias con Titulo y Resumen
   * @returns {Promise<Object>} - La noticia seleccionada
   */
  async selectMostImportantNews(noticias) {
    if (!noticias || noticias.length === 0) return null;
    if (noticias.length === 1) return noticias[0];

    const resumenList = noticias.map((n, i) =>
      `${i + 1}. TITULO: ${n.Titulo}\n   RESUMEN: ${n.Resumen.substring(0, 200)}...`
    ).join('\n\n');

    const prompt = `
Eres un editor jefe de un medio agricola. De estas noticias del dia, selecciona la MAS IMPORTANTE y relevante para el sector agricola andaluz.
Responde SOLO con el numero de la noticia elegida (1, 2, 3, etc.), sin explicaciones.

NOTICIAS:
${resumenList}

NUMERO ELEGIDO:`;

    const response = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.3 });
    const match = response.match(/\d+/);
    const index = match ? parseInt(match[0]) - 1 : 0;

    return noticias[Math.min(Math.max(index, 0), noticias.length - 1)];
  }

  /**
   * Construye la URL publica de una noticia en la web de helpmeagro
   * (para mostrar en el post de Instagram)
   * @param {Object} noticia - Objeto noticia con Id
   * @returns {string} - URL publica
   */
  getNewsUrl(noticia) {
    const base = process.env.HELPMEAGRO_PUBLIC_URL || 'https://www.helpmeagro.com';
    const newsPath = process.env.HELPMEAGRO_NEWS_PATH || '/noticias/';
    return `${base}${newsPath}${noticia.Id}`;
  }

  /**
   * Construye la URL local de la imagen de una noticia.
   * Las imagenes se sirven desde nuestro servidor via /notice_images/
   * apuntando al directorio NOTICE_IMAGES_DIR configurado en .env
   * @param {Object} noticia - Objeto noticia con UrlImagenPrincipal
   * @returns {string|null} - URL local de la imagen o null
   */
  getNewsImageUrl(noticia) {
    if (!noticia.UrlImagenPrincipal) return null;
    // UrlImagenPrincipal en BD es tipo "/notice_images/xxx.png"
    // Nuestro servidor lo sirve en http://localhost:3001/notice_images/xxx.png
    const imagePath = noticia.UrlImagenPrincipal.startsWith('/')
      ? noticia.UrlImagenPrincipal.substring(1)
      : noticia.UrlImagenPrincipal;
    return `http://localhost:${process.env.PORT || 3001}/${imagePath}`;
  }

  /**
   * Cierra el pool de conexiones MySQL.
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

module.exports = new AgroDataService();
