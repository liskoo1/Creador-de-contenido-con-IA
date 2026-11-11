const fs = require('fs');
const path = require('path');
const geminiService = require('./geminiService');

/**
 * Agente de Extracción de Contexto de Negocio.
 * Procesa la evidencia textual recopilada de una web y genera
 * una propuesta estructurada con citas de evidencia mediante Gemini.
 */
class BusinessContextAgent {
  constructor(options = {}) {
    this.gemini = options.geminiService || geminiService;
    this.skillPath = options.skillPath || path.join(__dirname, '../../.agents/skills/business-context-extractor/SKILL.md');
    this.maxEvidenceLength = options.maxEvidenceLength || 30000;
  }

  /**
   * Carga la directiva del sistema desde la skill de agente.
   */
  _loadSystemInstructions() {
    try {
      if (fs.existsSync(this.skillPath)) {
        return fs.readFileSync(this.skillPath, 'utf8');
      }
    } catch (e) {
      console.warn('[BusinessContextAgent] No se pudo leer SKILL.md, usando plantilla base:', e.message);
    }
    return 'Eres un extractor fáctico de modelos de negocio. Devuelve un JSON estructurado con businessName, industry, website, offering, targetAudience, keyBenefits, location, tone, defaultHashtags, summary y sus evidencias.';
  }

  /**
   * Ejecuta la extracción estructurada sobre los datos recopilados por websiteCaptureService.
   *
   * @param {object} captureData - Datos recopilados por websiteCaptureService
   * @returns {Promise<object>} Borrador estructurado y validado
   */
  async extractContext(captureData) {
    if (!captureData || !captureData.evidenceText) {
      throw new Error('No hay evidencia textual para analizar.');
    }

    const systemPrompt = this._loadSystemInstructions();
    const truncatedEvidence = captureData.evidenceText.slice(0, this.maxEvidenceLength);

    const prompt = `${systemPrompt}

--- DATOS DE NAVEGACIÓN REALIZADA ---
URL OBJETIVO: ${captureData.sourceUrl || ''}
URL FINAL RESUELTA: ${captureData.finalUrl || ''}
TÍTULO DEL SITIO: ${captureData.title || ''}
DESCRIPCIÓN META: ${captureData.metaDescription || ''}
FUENTES VISITADAS: ${JSON.stringify(captureData.sources || [])}

--- EVIDENCIA TEXTUAL EXTRAÍDA DE LA WEB ---
${truncatedEvidence}
--- FIN DE EVIDENCIA ---

Extrae el JSON estructurado según las instrucciones. Recuerda responder ÚNICAMENTE con el objeto JSON válido.`;

    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';

    console.log(`[BusinessContextAgent] Solicitando extracción a ${model} (evidencia: ${truncatedEvidence.length} caracteres)...`);

    const rawResponse = await this.gemini.generateText(prompt, model, null, {
      temperature: 0.2,
      maxOutputTokens: 4000,
      responseMimeType: 'application/json'
    });

    return this.parseAndValidate(rawResponse, captureData);
  }

  /**
   * Parsea y valida el JSON de respuesta del modelo asegurando tipos y estructura.
   *
   * @param {string} rawResponse
   * @param {object} captureData
   * @returns {object} Propuesta normalizada
   */
  parseAndValidate(rawResponse, captureData = {}) {
    if (!rawResponse || typeof rawResponse !== 'string') {
      throw new Error('Respuesta vacía o inválida del modelo de extracción.');
    }

    let parsed = null;
    let cleanText = rawResponse.trim();

    // Limpiar bloques de código markdown si los hay
    if (cleanText.startsWith('```json')) {
      cleanText = cleanText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    } else if (cleanText.startsWith('```')) {
      cleanText = cleanText.replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    }

    try {
      parsed = JSON.parse(cleanText);
    } catch (e) {
      console.error('[BusinessContextAgent] Error parseando JSON de extracción:', e.message);
      throw new Error(`Error de formato en la respuesta del modelo: ${e.message}`);
    }

    const fields = [
      'businessName',
      'industry',
      'website',
      'offering',
      'targetAudience',
      'keyBenefits',
      'location',
      'tone',
      'defaultHashtags',
      'summary'
    ];

    const proposal = {};

    for (const f of fields) {
      const rawField = parsed[f];
      const isProposalField = (f === 'tone' || f === 'defaultHashtags');

      if (rawField && typeof rawField === 'object') {
        proposal[f] = {
          value: typeof rawField.value === 'string' ? rawField.value.trim() : (rawField.value != null ? String(rawField.value) : ''),
          confidence: ['high', 'medium', 'low'].includes(rawField.confidence) ? rawField.confidence : (rawField.value ? 'medium' : 'low'),
          isProposal: isProposalField ? true : Boolean(rawField.isProposal),
          evidence: Array.isArray(rawField.evidence) ? rawField.evidence.map(ev => ({
            url: typeof ev.url === 'string' ? ev.url : (captureData.sourceUrl || ''),
            snippet: typeof ev.snippet === 'string' ? ev.snippet.slice(0, 200) : ''
          })) : []
        };
      } else if (typeof rawField === 'string') {
        proposal[f] = {
          value: rawField.trim(),
          confidence: rawField.trim().length > 0 ? 'medium' : 'low',
          isProposal: isProposalField,
          evidence: []
        };
      } else {
        proposal[f] = {
          value: f === 'website' ? (captureData.finalUrl || captureData.sourceUrl || '') : '',
          confidence: 'low',
          isProposal: isProposalField,
          evidence: []
        };
      }
    }

    // Si website está vacío en proposal, asegurar la URL resuelta
    if (!proposal.website.value && (captureData.finalUrl || captureData.sourceUrl)) {
      proposal.website.value = captureData.finalUrl || captureData.sourceUrl;
      proposal.website.confidence = 'high';
    }

    return proposal;
  }
}

module.exports = BusinessContextAgent;
