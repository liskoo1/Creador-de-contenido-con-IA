const geminiService = require('../services/geminiService');
const openaiService = require('../services/openaiService');
const poeService = require('../services/poeService');
const skillLoader = require('../core/SkillLoader');
const productContextService = require('../services/productContextService');
const instagramSkillsService = require('../services/instagramSkillsService');

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

  _resolveMediaProviders(context = {}) {
    const envMedia = (process.env.MEDIA_PROVIDER || '').trim().toLowerCase();
    const envImage = (process.env.IMAGE_PROVIDER || '').trim().toLowerCase();
    const envVideo = (process.env.VIDEO_PROVIDER || '').trim().toLowerCase();

    let imageProvider = context.imageModel || context.imageProvider;
    if (!imageProvider || imageProvider === 'default') {
      if (envMedia === 'poe' || envImage === 'poe') {
        imageProvider = 'poe';
      } else if (envMedia === 'openai' || envImage === 'openai') {
        imageProvider = 'openai';
      } else {
        imageProvider = 'google';
      }
    }

    let videoProvider = context.videoProvider || context.videoModel;
    if (!videoProvider || videoProvider === 'default') {
      if (envMedia === 'poe' || envVideo === 'poe') {
        videoProvider = 'poe';
      } else if (envMedia === 'google' || envVideo === 'google') {
        videoProvider = 'google';
      } else {
        videoProvider = (imageProvider === 'poe' ? 'poe' : 'google');
      }
    }

    return { imageProvider, videoProvider };
  }

  _assertValidMediaResult(result, provider, mediaLabel = 'medio') {
    if (!result || result.success === false || !result.url) {
      throw new Error(result?.error || `${provider} no devolvió una URL de ${mediaLabel} válida.`);
    }
    return result;
  }

  async _executeInternal(input, context = {}) {
    const { imageProvider, videoProvider } = this._resolveMediaProviders(context);

    // Ruta directa para generación de imagen pura
    if (this.type === 'image' && context.is_pure_image_request) {
      if (imageProvider === 'poe') {
        const ref = (context.referenceImages && context.referenceImages[0]) || context.referenceImagePath || null;
        const res = await poeService.generateImage({
          prompt: input,
          aspectRatio: context.aspectRatio || '9:16',
          imageSize: context.imageSize || '1K',
          referenceImage: ref,
          mock: Boolean(context.mock)
        });
        return this._assertValidMediaResult(res, 'Poe', 'imagen');
      }
      if (imageProvider === 'openai') {
        return await openaiService.generateImage(input, context.referenceImages || []);
      }
      return await geminiService.generateImage(input, context.referenceImages || [], context.aspectRatio || null);
    }

    // Ruta directa para generación de vídeo pura (Veo nativo o Gemini Omni en Poe)
    if (this.type === 'video' && context.is_pure_video_request) {
      if (videoProvider === 'poe') {
        const ref = context.referenceImagePath || context.characterLockPath || null;
        const res = await poeService.generateVideo({
          prompt: input,
          aspectRatio: context.aspectRatio || '9:16',
          resolution: context.resolution || '720p',
          task: context.videoTask || 'image_to_video',
          referenceImage: ref,
          mock: Boolean(context.mock)
        });
        return this._assertValidMediaResult(res, 'Poe', 'vídeo');
      }
      return await geminiService.generateVideoClip(input, context.aspectRatio, {
        referenceImagePath: context.referenceImagePath || context.characterLockPath || null,
        resolution: context.resolution || null,
        personGeneration: context.personGeneration || null,
        videoTask: context.videoTask || null
      });
    }

    // Ruta con skill: cargar instrucciones y generar texto
    const skillPrompt = await skillLoader.loadSkill(this.skillName);
    const productContextSection = productContextService.getAsPromptSection();
    const instagramGuidance = await instagramSkillsService.forAgent(this.skillName, context.instagramFormat);
    
    const finalPrompt = `
      INSTRUCCIONES DE LA HABILIDAD:
      ${skillPrompt}
      
      ${productContextSection ? productContextSection : ''}
      
      BRIEFING/INPUT DEL USUARIO:
      ${input}
      
      CONTEXTO ACTUAL:
      ${JSON.stringify(context, null, 2)}

      ${instagramGuidance}
    `;

    if (this.type === 'image') {
      if (imageProvider === 'poe') {
        const ref = (context.referenceImages && context.referenceImages[0]) || context.referenceImagePath || null;
        const res = await poeService.generateImage({
          prompt: finalPrompt,
          aspectRatio: context.aspectRatio || '9:16',
          imageSize: context.imageSize || '1K',
          referenceImage: ref,
          mock: Boolean(context.mock)
        });
        return this._assertValidMediaResult(res, 'Poe', 'imagen');
      }
      if (imageProvider === 'openai') {
        return await openaiService.generateImage(finalPrompt, context.referenceImages || []);
      }
      return await geminiService.generateImage(finalPrompt, context.referenceImages || [], context.aspectRatio || null);
    } else if (this.type === 'video') {
      if (videoProvider === 'poe') {
        const res = await poeService.generateVideo({
          prompt: finalPrompt,
          aspectRatio: context.aspectRatio || '9:16',
          resolution: context.resolution || '720p',
          mock: Boolean(context.mock)
        });
        return this._assertValidMediaResult(res, 'Poe', 'vídeo');
      }
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
