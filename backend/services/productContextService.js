const fs = require('fs');
const path = require('path');

const CONTEXT_PATH = path.join(__dirname, '../data/productContext.json');

/**
 * Servicio dedicado al Contexto de Producto.
 * Gestiona el contexto narrativo del producto/servicio que se promociona,
 * separado del Knowledge Hub genérico.
 * 
 * Este contexto es la FUENTE DE VERDAD para sesgar todo el contenido generado.
 */
class ProductContextService {
  constructor() {
    this._init();
  }

  _init() {
    const dir = path.dirname(CONTEXT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CONTEXT_PATH)) {
      this._write({
        context: '',
        lastUpdated: null,
        metadata: {
          productName: '',
          industry: '',
          website: '',
          hashtags: '',
          defaultHashtags: ''
        }
      });
    }
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8'));
    } catch (e) {
      console.error('[ProductContext] Error leyendo contexto:', e.message);
      return { context: '', lastUpdated: null, metadata: {} };
    }
  }

  _write(data) {
    fs.writeFileSync(CONTEXT_PATH, JSON.stringify(data, null, 2));
  }

  /**
   * Obtiene el contexto completo del producto.
   */
  get() {
    return this._read();
  }

  /**
   * Obtiene solo el texto del contexto del producto.
   * Si no hay contexto configurado, devuelve cadena vacía.
   */
  getContextText() {
    const data = this._read();
    return data.context || '';
  }

  /**
   * Obtiene los metadatos del producto (nombre, industria, website, hashtags).
   */
  getMetadata() {
    const data = this._read();
    return data.metadata || {};
  }

  /**
   * Obtiene un resumen completo formateado para inyectar en prompts de agentes.
   * Este es el método principal que usan los agentes.
   */
  getAsPromptSection() {
    const data = this._read();
    const meta = data.metadata || {};
    const context = data.context || '';

    if (!context && !meta.productName) {
      return '';
    }

    let section = '=== CONTEXTO DE PRODUCTO/SERVICIO (OBLIGATORIO) ===\n';
    section += 'IMPORTANTE: Todo el contenido que generes DEBE estar alineado con este contexto.\n';
    section += 'Este es el producto/servicio que se promociona. NO generes contenido genérico.\n\n';

    if (meta.productName) section += `PRODUCTO: ${meta.productName}\n`;
    if (meta.industry) section += `INDUSTRIA: ${meta.industry}\n`;
    if (meta.website) section += `WEBSITE: ${meta.website}\n`;
    if (meta.defaultHashtags) section += `HASHTAGS POR DEFECTO: ${meta.defaultHashtags}\n`;
    section += '\n';

    if (context) {
      section += `DESCRIPCIÓN COMPLETA DEL PRODUCTO:\n${context}\n`;
    }

    section += '\n=== FIN CONTEXTO DE PRODUCTO ===\n';
    return section;
  }

  /**
   * Guarda el contexto del producto (texto enriquecido).
   */
  saveContext(contextText) {
    const data = this._read();
    data.context = contextText;
    data.lastUpdated = new Date().toISOString();
    this._write(data);
    console.log('[ProductContext] Contexto actualizado.');
    return data;
  }

  /**
   * Guarda los metadatos del producto.
   */
  saveMetadata(metadata) {
    const data = this._read();
    data.metadata = { ...data.metadata, ...metadata };
    data.lastUpdated = new Date().toISOString();
    this._write(data);
    console.log('[ProductContext] Metadatos actualizados:', JSON.stringify(metadata));
    return data;
  }

  /**
   * Guarda tanto contexto como metadatos en una sola operación.
   */
  saveAll(contextText, metadata) {
    const data = {
      context: contextText || '',
      lastUpdated: new Date().toISOString(),
      metadata: {
        productName: metadata?.productName || '',
        industry: metadata?.industry || '',
        website: metadata?.website || '',
        hashtags: metadata?.hashtags || '',
        defaultHashtags: metadata?.defaultHashtags || ''
      }
    };
    this._write(data);
    console.log('[ProductContext] Contexto y metadatos guardados.');
    return data;
  }

  /**
   * Verifica si hay contexto configurado.
   */
  hasContext() {
    const data = this._read();
    return (data.context && data.context.trim().length > 0) || (data.metadata?.productName && data.metadata.productName.trim().length > 0);
  }
}

module.exports = new ProductContextService();
