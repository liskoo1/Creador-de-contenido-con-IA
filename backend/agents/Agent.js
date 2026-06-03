const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const skillLoader = require('../core/SkillLoader');
const productContextService = require('../services/productContextService');

/**
 * Clase base para representar a un Agente Especialista.
 * v2: Retry con backoff, parseo JSON robusto, logging mejorado.
 */
class Agent {
  constructor(name, skillName, type = 'text') {
    this.name = name;
    this.skillName = skillName;
    this.type = type; // 'text', 'image', or 'video'
    this.maxRetries = 2;
  }

  /**
   * Parseo seguro de JSON que maneja múltiples formatos de respuesta LLM.
   */
  _safeParseJSON(text) {
    if (!text || typeof text !== 'string') return { text: String(text || '') };
    
    // 1. Limpiar bloques de código markdown
    let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    
    // 2. Intentar parsear directamente
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // 3. Buscar el primer { o [ y el último } o ]
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      const start = firstBrace === -1 ? firstBracket : (firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket));
      
      if (start !== -1) {
        const isArray = cleaned[start] === '[';
        const lastClose = cleaned.lastIndexOf(isArray ? ']' : '}');
        if (lastClose > start) {
          try {
            return JSON.parse(cleaned.substring(start, lastClose + 1));
          } catch (e2) {
            // Fall through
          }
        }
      }
      
      // 4. Devolver como texto
      return { text: text.trim() };
    }
  }

  /**
   * Espera con backoff exponencial.
   */
  async _backoff(attempt) {
    const delay = Math.pow(2, attempt) * 1000; // 2s, 4s
    console.log(`[Agent ${this.name}] ⏳ Reintentando en ${delay / 1000}s...`);
    return new Promise(resolve => setTimeout(resolve, delay));
  }

  async execute(input, context = {}) {
    const startTime = Date.now();
    console.log(`[Agent ${this.name}] Ejecutando (${this.type})...`);
    
    let lastError = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[Agent ${this.name}] 🔄 Intento ${attempt + 1}/${this.maxRetries + 1}...`);
          await this._backoff(attempt);
        }
        
        const result = await this._executeInternal(input, context);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Agent ${this.name}] ✅ Completado en ${elapsed}s`);
        return result;
        
      } catch (error) {
        lastError = error;
        const isRetryable = error.message?.includes('503') || 
                           error.message?.includes('429') || 
                           error.message?.includes('RESOURCE_EXHAUSTED') ||
                           error.message?.includes('UNAVAILABLE') ||
                           error.message?.includes('timeout');
        
        if (!isRetryable || attempt === this.maxRetries) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.error(`[Agent ${this.name}] ❌ Error final tras ${elapsed}s:`, error.message);
          throw error;
        }
        
        console.warn(`[Agent ${this.name}] ⚠️ Error retryable: ${error.message}`);
      }
    }
    
    throw lastError;
  }

  async _executeInternal(input, context = {}) {
    // Ruta directa para generación de imagen pura
    if (this.type === 'image' && context.is_pure_image_request) {
      if (context.imageModel === 'openai') {
        return await openaiService.generateImage(input, context.referenceImages || []);
      }
      return await geminiService.generateImage(input, context.referenceImages || [], context.aspectRatio || null);
    }

    // Ruta directa para generación de vídeo pura
    if (this.type === 'video' && context.is_pure_video_request) {
      return await geminiService.generateVideoClip(input, context.aspectRatio);
    }

    // Ruta con skill: cargar instrucciones y generar texto
    const skillPrompt = await skillLoader.loadSkill(this.skillName);
    const productContextSection = productContextService.getAsPromptSection();
    
    const finalPrompt = `
      INSTRUCCIONES DE LA HABILIDAD:
      ${skillPrompt}
      
      ${productContextSection ? productContextSection : ''}
      
      BRIEFING/INPUT DEL USUARIO:
      ${input}
      
      CONTEXTO ACTUAL:
      ${JSON.stringify(context, null, 2)}
    `;

    if (this.type === 'image') {
      if (context.imageModel === 'openai') {
        return await openaiService.generateImage(finalPrompt, context.referenceImages || []);
      }
      return await geminiService.generateImage(finalPrompt, context.referenceImages || [], context.aspectRatio || null);
    } else if (this.type === 'video') {
      return await geminiService.generateVideoClip(finalPrompt);
    } else {
      // Si el contexto pide Grounding (Google Search), usarlo
      if (context.use_grounding) {
        console.log(`[Agent ${this.name}] 🔍 Usando Grounding (Google Search)...`);
        const responseText = await geminiService.generateTextWithGrounding(finalPrompt);
        return this._safeParseJSON(responseText);
      }

      // Soporte para análisis visual si se pasa una imagen en el contexto
      const imageToReview = context.image_to_review || null;
      const textModel = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
      const responseText = await geminiService.generateText(finalPrompt, textModel, imageToReview);
      
      return this._safeParseJSON(responseText);
    }
  }
}

module.exports = Agent;
