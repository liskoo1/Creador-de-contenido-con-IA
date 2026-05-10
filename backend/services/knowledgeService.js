const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/knowledge.json');

class KnowledgeService {
  getKnowledge() {
    try {
      if (!fs.existsSync(DB_PATH)) return { assets: [], urls: [] };
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
      return { assets: [], urls: [] };
    }
  }

  saveKnowledge(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  }

  addAsset(asset) {
    const db = this.getKnowledge();
    db.assets.push({ id: Date.now(), ...asset });
    this.saveKnowledge(db);
  }

  addUrl(urlData) {
    const db = this.getKnowledge();
    db.urls.push({ id: Date.now(), ...urlData });
    this.saveKnowledge(db);
  }

  deleteItem(type, id) {
    const db = this.getKnowledge();
    if (type === 'asset') {
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
    db.assets.forEach(a => text += `- ${a.description} (Archivo: ${a.fileName})\n`);
    return text;
  }

  /**
   * Devuelve los activos de imagen con su ruta física absoluta.
   * @param {string} keyword - Filtro opcional por descripción (ej: 'logo', 'dashboard')
   */
  getImageAssets(keyword = null) {
    const db = this.getKnowledge();
    const assetsDir = path.join(__dirname, '../data/assets');
    return db.assets
      .filter(a => a.type === 'image')
      .filter(a => keyword ? a.description.toLowerCase().includes(keyword.toLowerCase()) : true)
      .map(a => ({
        ...a,
        absolutePath: path.join(assetsDir, a.fileName)
      }))
      .filter(a => fs.existsSync(a.absolutePath));
  }

  /**
   * Devuelve los logos detectados (busca 'logo' en la descripción).
   */
  getLogos() {
    return this.getImageAssets('logo');
  }

  /**
   * Devuelve las capturas de pantalla de la app (busca 'interfaz', 'dashboard', 'captura').
   */
  getAppScreenshots() {
    const db = this.getKnowledge();
    const assetsDir = path.join(__dirname, '../data/assets');
    const keywords = ['interfaz', 'dashboard', 'captura', 'app', 'móvil'];
    return db.assets
      .filter(a => a.type === 'image')
      .filter(a => keywords.some(k => a.description.toLowerCase().includes(k)))
      .map(a => ({ ...a, absolutePath: path.join(assetsDir, a.fileName) }))
      .filter(a => fs.existsSync(a.absolutePath));
  }
}

module.exports = new KnowledgeService();
