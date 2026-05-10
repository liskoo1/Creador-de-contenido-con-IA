const fs = require('fs');
const path = require('path');

const POSTS_PATH = path.join(__dirname, '../data/posts.json');
const OUTPUT_DIR = path.join(__dirname, '../output');

class PostService {
  constructor() {
    this.initDB();
  }

  initDB() {
    const dir = path.dirname(POSTS_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(POSTS_PATH)) fs.writeFileSync(POSTS_PATH, JSON.stringify([], null, 2));
  }

  getAll() {
    try {
      const data = fs.readFileSync(POSTS_PATH, 'utf8');
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  }

  save(post) {
    const posts = this.getAll();
    const newPost = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      ...post
    };
    posts.unshift(newPost);
    fs.writeFileSync(POSTS_PATH, JSON.stringify(posts, null, 2));
    return newPost;
  }

  /**
   * Convierte una URL o ruta relativa de un archivo generado a su ruta absoluta en disco.
   * Acepta formatos: "http://localhost:PORT/output/file.png", "/output/file.png", "output/file.png"
   */
  _resolveFilePath(urlOrPath) {
    if (!urlOrPath || typeof urlOrPath !== 'string') return null;
    try {
      // Si es una URL completa, extraer solo la parte del path
      let filePath = urlOrPath;
      if (urlOrPath.startsWith('http')) {
        const url = new URL(urlOrPath);
        filePath = url.pathname; // "/output/image_xxx.png"
      }
      // Quitar la barra inicial y resolver desde el directorio output del backend
      const relative = filePath.replace(/^\/output\//, '').replace(/^output\//, '');
      const absolute = path.join(OUTPUT_DIR, relative);
      return absolute;
    } catch {
      return null;
    }
  }

  /**
   * Elimina un archivo del disco de forma segura (sin lanzar error si no existe).
   */
  _deleteFile(urlOrPath) {
    const absPath = this._resolveFilePath(urlOrPath);
    if (!absPath) return;
    try {
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
        console.log(`[PostService] 🗑️ Archivo eliminado: ${path.basename(absPath)}`);
      }
    } catch (e) {
      console.warn(`[PostService] No se pudo eliminar ${absPath}: ${e.message}`);
    }
  }

  /**
   * Elimina un post del registro JSON y borra todos sus archivos asociados del disco.
   */
  delete(id) {
    const posts = this.getAll();
    const post = posts.find(p => p.id === id);

    if (post) {
      // Borrar imágenes del carrusel / slides
      if (Array.isArray(post.visuals)) {
        post.visuals.forEach(url => this._deleteFile(url));
      }
      // Borrar video final si existe
      if (post.video?.url) {
        this._deleteFile(post.video.url);
      }
    }

    const updated = posts.filter(p => p.id !== id);
    fs.writeFileSync(POSTS_PATH, JSON.stringify(updated, null, 2));
    return true;
  }
}

module.exports = new PostService();
