const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '../data/knowledge.json');
const ASSETS_DIR = path.join(__dirname, '../data/assets');

class KnowledgeService {
  constructor() {
    if (!fs.existsSync(ASSETS_DIR)) {
      fs.mkdirSync(ASSETS_DIR, { recursive: true });
    }
  }

  getKnowledge() {
    try {
      if (!fs.existsSync(DB_PATH)) return { assets: [], urls: [] };
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
      return { assets: [], urls: [] };
    }
  }

  saveKnowledge(data) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  addAsset(asset) {
    const db = this.getKnowledge();
    const newAsset = { id: Date.now(), ...asset };
    db.assets.push(newAsset);
    this.saveKnowledge(db);
    return newAsset;
  }

  /**
   * Importa de forma segura una captura de pantalla desde el directorio temporal
   * al directorio permanente de activos de la aplicación y la registra en knowledge.json.
   *
   * @param {string} tempFilePath - Ruta física al archivo PNG temporal
   * @param {object} meta - Metadatos de la captura
   * @returns {object} El activo registrado
   */
  importScreenshotAsset(tempFilePath, meta = {}) {
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`El archivo de captura no existe en la ruta temporal: ${tempFilePath}`);
    }

    const fileBuffer = fs.readFileSync(tempFilePath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const ext = path.extname(tempFilePath) || '.png';
    const targetFileName = `web_screenshot_${meta.viewport || 'screen'}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const targetPath = path.join(ASSETS_DIR, targetFileName);

    fs.writeFileSync(targetPath, fileBuffer);

    const assetData = {
      type: 'image',
      fileName: targetFileName,
      description: meta.description || `Captura de sitio web (${meta.viewport === 'mobile' ? 'Móvil responsive 390x844' : 'Escritorio 1440x900'})`,
      assetRole: 'website-screenshot',
      viewport: meta.viewport || 'desktop',
      width: meta.width || (meta.viewport === 'mobile' ? 390 : 1440),
      height: meta.height || (meta.viewport === 'mobile' ? 844 : 900),
      sourceUrl: meta.sourceUrl || '',
      finalUrl: meta.finalUrl || '',
      capturedAt: meta.capturedAt || new Date().toISOString(),
      analysisId: meta.analysisId || null,
      hash
    };

    return this.addAsset(assetData);
  }

  addUrl(urlData) {
    const db = this.getKnowledge();
    const newUrl = { id: Date.now(), ...urlData };
    db.urls.push(newUrl);
    this.saveKnowledge(db);
    return newUrl;
  }

  deleteItem(type, id) {
    const db = this.getKnowledge();
    if (type === 'asset') {
      const assetToDelete = db.assets.find(a => a.id === id);
      if (assetToDelete && assetToDelete.fileName) {
        const fullPath = path.join(ASSETS_DIR, assetToDelete.fileName);
        if (fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch (_) {}
        }
      }
      db.assets = db.assets.filter(a => a.id !== id);
    } else {
      db.urls = db.urls.filter(u => u.id !== id);
    }
    this.saveKnowledge(db);
  }

  getAllAsText() {
    const db = this.getKnowledge();
    let text = "BASE DE CONOCIMIENTO PERSISTENTE:\n";
    text += "\nDATOS DE WEBS:\n";
    db.urls.forEach(u => text += `- ${u.title}: ${u.summary} (${u.url})\n`);
    text += "\nARCHIVOS Y ACTIVOS:\n";
    db.assets.forEach(a => text += `- ${a.description} (Archivo: ${a.fileName}${a.assetRole ? ` | Rol: ${a.assetRole}` : ''})\n`);
    return text;
  }

  /**
   * Devuelve los activos de imagen con su ruta física absoluta.
   * Admite filtrado por palabra clave y opciones de roles para preservar la integridad visual.
   *
   * @param {string|null} keyword - Filtro opcional por descripción
   * @param {object} options - { excludeRoles: string[], includeRoles: string[] }
   */
  getImageAssets(keyword = null, options = {}) {
    const db = this.getKnowledge();
    const { excludeRoles = [], includeRoles = null } = options;

    return db.assets
      .filter(a => a.type === 'image')
      .filter(a => {
        if (includeRoles && Array.isArray(includeRoles) && includeRoles.length > 0) {
          return includeRoles.includes(a.assetRole);
        }
        if (excludeRoles && Array.isArray(excludeRoles) && excludeRoles.length > 0) {
          return !excludeRoles.includes(a.assetRole);
        }
        return true;
      })
      .filter(a => keyword ? a.description.toLowerCase().includes(keyword.toLowerCase()) : true)
      .map(a => ({
        ...a,
        absolutePath: path.join(ASSETS_DIR, a.fileName)
      }))
      .filter(a => fs.existsSync(a.absolutePath));
  }

  /**
   * Devuelve los logos detectados (busca 'logo' en la descripción y excluye capturas web).
   */
  getLogos() {
    return this.getImageAssets('logo', { excludeRoles: ['website-screenshot'] });
  }

  /**
   * Devuelve las capturas de pantalla de la app (busca 'interfaz', 'dashboard', 'captura' excluyendo capturas web externas).
   */
  getAppScreenshots() {
    const keywords = ['interfaz', 'dashboard', 'captura', 'app'];
    return this.getImageAssets(null, { excludeRoles: ['website-screenshot'] })
      .filter(a => keywords.some(k => a.description.toLowerCase().includes(k)));
  }

  /**
   * Devuelve únicamente las capturas de pantalla de sitios web importadas.
   */
  getWebsiteScreenshots() {
    return this.getImageAssets(null, { includeRoles: ['website-screenshot'] });
  }
}

module.exports = new KnowledgeService();
