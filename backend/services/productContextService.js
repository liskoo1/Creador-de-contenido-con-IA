const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONTEXT_PATH = path.join(__dirname, '../data/productContext.json');
const BACKUP_PATH = path.join(__dirname, '../data/productContext.backup.json');

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
          defaultHashtags: '',
          presenterProfile: '',
          tone: '',
          offering: '',
          targetAudience: '',
          keyBenefits: '',
          location: '',
          webImport: null
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
    // Mantener backup del estado anterior antes de escribir
    if (fs.existsSync(CONTEXT_PATH)) {
      try {
        fs.copyFileSync(CONTEXT_PATH, BACKUP_PATH);
      } catch (_) {}
    }
    fs.writeFileSync(CONTEXT_PATH, JSON.stringify(data, null, 2), 'utf8');
  }

  /**
   * Calcula un fingerprint / revisión SHA-256 del contenido actual para control de concurrencia.
   */
  getRevision(data = null) {
    const current = data || this._read();
    const payload = JSON.stringify({
      context: current.context || '',
      metadata: current.metadata || {}
    });
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /**
   * Obtiene el contexto completo del producto con su número de revisión.
   */
  get() {
    const data = this._read();
    return {
      ...data,
      revision: this.getRevision(data)
    };
  }

  /**
   * Obtiene solo el texto del contexto del producto.
   */
  getContextText() {
    const data = this._read();
    return data.context || '';
  }

  /**
   * Obtiene los metadatos del producto.
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
    if (meta.presenterProfile) {
      section += `PRESENTADOR DE MARCA (usar como characterProfile recurrente en Reels): ${meta.presenterProfile}\n`;
    }
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
    return { ...data, revision: this.getRevision(data) };
  }

  /**
   * Guarda los metadatos del producto, preservando presenterProfile y webImport existentes.
   */
  saveMetadata(metadata) {
    const data = this._read();
    data.metadata = {
      ...data.metadata,
      ...metadata,
      presenterProfile: metadata.presenterProfile !== undefined ? metadata.presenterProfile : (data.metadata?.presenterProfile || ''),
      webImport: metadata.webImport !== undefined ? metadata.webImport : (data.metadata?.webImport || null)
    };
    data.lastUpdated = new Date().toISOString();
    this._write(data);
    console.log('[ProductContext] Metadatos actualizados.');
    return { ...data, revision: this.getRevision(data) };
  }

  /**
   * Guarda tanto contexto como metadatos en una sola operación atómica.
   * Preserva presenterProfile y webImport si no se sobrescriben explícitamente.
   */
  saveAll(contextText, metadata) {
    const existing = this._read();
    const data = {
      context: contextText !== undefined ? contextText : (existing.context || ''),
      lastUpdated: new Date().toISOString(),
      metadata: {
        productName: metadata?.productName !== undefined ? metadata.productName : (existing.metadata?.productName || ''),
        industry: metadata?.industry !== undefined ? metadata.industry : (existing.metadata?.industry || ''),
        website: metadata?.website !== undefined ? metadata.website : (existing.metadata?.website || ''),
        hashtags: metadata?.hashtags !== undefined ? metadata.hashtags : (existing.metadata?.hashtags || ''),
        defaultHashtags: metadata?.defaultHashtags !== undefined ? metadata.defaultHashtags : (existing.metadata?.defaultHashtags || ''),
        presenterProfile: metadata?.presenterProfile !== undefined ? metadata.presenterProfile : (existing.metadata?.presenterProfile || ''),
        tone: metadata?.tone !== undefined ? metadata.tone : (existing.metadata?.tone || ''),
        offering: metadata?.offering !== undefined ? metadata.offering : (existing.metadata?.offering || ''),
        targetAudience: metadata?.targetAudience !== undefined ? metadata.targetAudience : (existing.metadata?.targetAudience || ''),
        keyBenefits: metadata?.keyBenefits !== undefined ? metadata.keyBenefits : (existing.metadata?.keyBenefits || ''),
        location: metadata?.location !== undefined ? metadata.location : (existing.metadata?.location || ''),
        webImport: metadata?.webImport !== undefined ? metadata.webImport : (existing.metadata?.webImport || null)
      }
    };
    this._write(data);
    console.log('[ProductContext] Contexto y metadatos guardados.');
    return { ...data, revision: this.getRevision(data) };
  }

  /**
   * Aplica un borrador validado de contexto web con verificación de baseRevision y fusión no destructiva.
   *
   * @param {object} params
   * @returns {object} Resultado de la operación
   */
  applyWebProposal({ jobId, proposal, selectedFields = [], baseRevision = null, sources = [], sourceUrl = '' }) {
    const current = this._read();
    const currentRev = this.getRevision(current);

    // Verificación de conflicto de revisión
    if (baseRevision && baseRevision !== currentRev) {
      const err = new Error('Conflicto de edición: el contexto del producto fue modificado mientras se realizaba el análisis.');
      err.code = 'CONFLICT';
      err.currentRevision = currentRev;
      err.currentData = current;
      throw err;
    }

    const updatedContext = (selectedFields.includes('summary') && proposal?.summary?.value)
      ? proposal.summary.value
      : current.context;

    const currentMeta = current.metadata || {};
    const updatedMeta = {
      ...currentMeta,
      productName: (selectedFields.includes('businessName') && proposal?.businessName?.value) ? proposal.businessName.value : (currentMeta.productName || ''),
      industry: (selectedFields.includes('industry') && proposal?.industry?.value) ? proposal.industry.value : (currentMeta.industry || ''),
      website: (selectedFields.includes('website') && proposal?.website?.value) ? proposal.website.value : (currentMeta.website || sourceUrl || ''),
      defaultHashtags: (selectedFields.includes('defaultHashtags') && proposal?.defaultHashtags?.value) ? proposal.defaultHashtags.value : (currentMeta.defaultHashtags || ''),
      tone: (selectedFields.includes('tone') && proposal?.tone?.value) ? proposal.tone.value : (currentMeta.tone || ''),
      offering: (selectedFields.includes('offering') && proposal?.offering?.value) ? proposal.offering.value : (currentMeta.offering || ''),
      targetAudience: (selectedFields.includes('targetAudience') && proposal?.targetAudience?.value) ? proposal.targetAudience.value : (currentMeta.targetAudience || ''),
      keyBenefits: (selectedFields.includes('keyBenefits') && proposal?.keyBenefits?.value) ? proposal.keyBenefits.value : (currentMeta.keyBenefits || ''),
      location: (selectedFields.includes('location') && proposal?.location?.value) ? proposal.location.value : (currentMeta.location || ''),
      presenterProfile: currentMeta.presenterProfile || '',
      webImport: {
        jobId: jobId || null,
        sourceUrl: sourceUrl || (proposal?.website?.value || ''),
        appliedAt: new Date().toISOString(),
        fieldsUpdated: selectedFields,
        sources: Array.isArray(sources) ? sources.slice(0, 5) : []
      }
    };

    const finalData = {
      context: updatedContext,
      lastUpdated: new Date().toISOString(),
      metadata: updatedMeta
    };

    try {
      this._write(finalData);
    } catch (writeErr) {
      // Rollback si falló la escritura
      if (fs.existsSync(BACKUP_PATH)) {
        try { fs.copyFileSync(BACKUP_PATH, CONTEXT_PATH); } catch (_) {}
      }
      throw writeErr;
    }

    console.log(`[ProductContext] Propuesta web aplicada con éxito (Job: ${jobId}, Campos: ${selectedFields.join(', ')})`);
    return {
      success: true,
      context: finalData,
      revision: this.getRevision(finalData)
    };
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
