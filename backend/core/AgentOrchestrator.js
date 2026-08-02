const path = require('path');
const fs = require('fs');
const Agent = require('../agents/Agent');
const knowledgeService = require('../services/knowledgeService');
const productContextService = require('../services/productContextService');
const geminiService = require('../services/geminiService');
const videoService = require('../services/videoService');
const bgmService = require('../services/bgmService');
const EventEmitter = require('events');

const OUTPUT_DIR = path.join(__dirname, '../output');

// Emisor global de progreso para SSE
const progressEmitter = new EventEmitter();

/**
 * Orquestador del Enjambre de Agentes.
 */
class AgentOrchestrator {
  constructor() {
    this.agents = {
      strategist: new Agent("Estratega", "marketing-ideas", "text"),
      architect: new Agent("Arquitecto", "carousel-orchestrator", "text"),
      writer: new Agent("Escritor", "content-writer", "text"),
      reviewer: new Agent("Revisor", "content-reviewer", "text"),
      designer: new Agent("Diseñador Visual", "visual-designer", "image"),
      photoOptimizer: new Agent("Optimizador Visual", "photo-prompt-optimizer", "text"),
      videoPromptOptimizer: new Agent("Optimizador de Vídeo", "video-prompt-optimizer", "text"),
      editor: new Agent("Montador de Vídeo", "video-orchestrator", "video"),
      remotionAgent: new Agent("Especialista en Remotion", "video-orchestrator", "text"),
      researcher: new Agent("Investigador", "web-scraper", "text")
    };
    
    this.maxRetries = 3;
  }

  async runFullWorkflow(briefing, brandContext, contentType, mediaType, aspectRatio = '1:1', externalReferences = [], refMode = 'reference', engineMode = 'remotion', imageModel = 'google', projectId = null) {
    let projectState = {
      briefing,
      brandContext,
      contentType,
      mediaType,
      aspectRatio,
      engineMode,
      content: null,
      visuals: [], 
      video: null,
      researchData: null,
      progress: { phase: 'init', detail: '', sceneProgress: 0, totalScenes: 0 }
    };

    const emitProgress = (phase, detail = '', sceneProgress = 0, totalScenes = 0) => {
      projectState.progress = { phase, detail, sceneProgress, totalScenes };
      if (projectId) progressEmitter.emit(projectId, projectState.progress);
    };

    console.log(`\x1b[32m[Swarm] Iniciando misión: ${contentType} [${aspectRatio}] [Media: ${mediaType}] [Engine: ${engineMode}]\x1b[0m`);

    // --- FASE 0: INVESTIGACIÓN DE URLs CON GROUNDING ---
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    let detectedUrlsRaw = briefing.match(urlRegex);
    let detectedUrls = null;
    if (detectedUrlsRaw) {
      detectedUrls = detectedUrlsRaw.map(url => {
        let cleaned = url.replace(/[.,;!?]+$/, '');
        return cleaned.startsWith('http') ? cleaned : `https://${cleaned}`;
      });
    }

    if (detectedUrls && detectedUrls.length > 0) {
      console.log(`[Swarm] Fase 0: 🔍 Investigando ${detectedUrls.length} URLs con Grounding (Google Search)...`);
      try {
        const researchPrompt = `
          MISIÓN CRÍTICA: Investiga a fondo estas URLs y extrae TODO el contenido relevante.
          
          URLs A INVESTIGAR: ${detectedUrls.join(', ')}
          
          FORMATO DE CONTENIDO SOLICITADO: ${contentType} (${contentType === 'single' ? 'Post único' : contentType === 'carousel' ? 'Carrusel de varias slides' : contentType === 'video' ? 'Reel/Vídeo' : 'Flyer/Cartel'})
          
          INSTRUCCIONES:
          1. Accede a cada URL y extrae el contenido principal: título, subtítulos, párrafos clave, datos, cifras.
          2. Usa Google Search para complementar con contexto adicional, tendencias y relevancia actual.
          3. Identifica el "gancho" para contenido de redes sociales: qué hace esta información interesante/viral.
          4. Extrae citas textuales si son potentes.
          5. Identifica datos duros, estadísticas o cifras impactantes.
          
          DEVUELVE UN JSON COMPLETO:
          {
            "source_url": "URL principal investigada",
            "page_title": "Título de la página/artículo",
            "main_content": "Resumen detallado del contenido principal (mínimo 200 palabras)",
            "key_facts": ["Dato clave 1", "Dato clave 2", "Dato clave 3"],
            "powerful_quotes": ["Cita textual potente si existe"],
            "grounding_context": "Contexto adicional encontrado en Google Search sobre este tema",
            "strategic_insights": {
              "what_happened": "Qué dice/muestra la URL",
              "why_it_matters": "Por qué es relevante para redes sociales",
              "content_angles": ["Ángulo persuasivo 1", "Ángulo educativo 2", "Ángulo viral 3"],
              "suggested_hook": "Gancho sugerido para captar atención"
            },
            "visual_suggestions": "Sugerencias de dirección visual basadas en el contenido"
          }
        `;
        projectState.researchData = await this.agents.researcher.execute(researchPrompt, { 
          briefing, 
          use_grounding: true 
        });
        console.log(`[Swarm] ✅ Investigación con Grounding completada.`);
        console.log(`[Swarm] Tipo de researchData: ${typeof projectState.researchData}, keys: ${Object.keys(projectState.researchData || {}).join(', ')}`);
      } catch (err) {
        console.error(`[Swarm] Error en fase de investigación con agente:`, err.message);
        
        // FALLBACK: Si el agente falló, intentar Grounding directo sin pasar por el agente
        console.log(`[Swarm] 🔄 Intentando fallback: Grounding directo...`);
        try {
          const geminiService = require('../services/geminiService');
          const fallbackResult = await geminiService.generateTextWithGrounding(
            `Lee y resume el contenido de esta URL para crear contenido de redes sociales: ${detectedUrls.join(', ')}. Extrae: título, resumen completo, datos clave y dirección visual sugerida.`
          );
          projectState.researchData = { text: fallbackResult };
          console.log(`[Swarm] ✅ Fallback de Grounding completado.`);
        } catch (fallbackErr) {
          console.error(`[Swarm] ❌ Fallback también falló:`, fallbackErr.message);
        }
      }
    }

    // Crear un briefing efectivo: si hay datos de investigación, sustituir la URL cruda por contenido real
    // Esto asegura que TODOS los agentes downstream trabajen con la información de la URL
    let effectiveBriefing = briefing;
    if (projectState.researchData) {
      const rd = projectState.researchData;
      
      // El researcher puede devolver JSON estructurado O texto plano en rd.text
      // Manejar ambos casos
      if (rd.page_title || rd.main_content) {
        // Caso 1: JSON estructurado con campos esperados
        const title = rd.page_title || '';
        const content = rd.main_content || '';
        const facts = rd.key_facts ? rd.key_facts.join('. ') : '';
        const hook = rd.strategic_insights?.suggested_hook || '';
        const angles = rd.strategic_insights?.content_angles ? rd.strategic_insights.content_angles.join(', ') : '';
        
        effectiveBriefing = `CONTENIDO BASADO EN NOTICIA/URL:\nTÍTULO: ${title}\nRESUMEN: ${content}\nDATOS CLAVE: ${facts}\nGANCHO: ${hook}\nÁNGULOS: ${angles}\nDIRECCIÓN VISUAL: ${rd.visual_suggestions || 'Imágenes que representen visualmente la noticia/contenido de la URL'}`;
      } else if (rd.text && rd.text.length > 50) {
        // Caso 2: Texto plano del Grounding (respuesta no-JSON)
        effectiveBriefing = `CONTENIDO BASADO EN NOTICIA/URL:\n${rd.text}`;
      } else {
        // Caso 3: Respuesta corta o inesperada — usar JSON serializado como último recurso
        const serialized = JSON.stringify(rd);
        if (serialized.length > 100) {
          effectiveBriefing = `CONTENIDO BASADO EN NOTICIA/URL:\n${serialized}`;
        }
      }
      
      console.log(`[Swarm] 📰 Briefing efectivo generado (${effectiveBriefing.length} chars). Preview: ${effectiveBriefing.substring(0, 150)}...`);
    } else if (detectedUrls && detectedUrls.length > 0) {
      // Si se detectaron URLs pero la investigación falló completamente, loguear advertencia
      console.warn(`[Swarm] ⚠️ Se detectaron URLs pero no se pudo extraer contenido. El contenido puede no reflejar la URL.`);
    }

    // --- FASE 0.5: HASHTAGS TRENDING CON GROUNDING ---
    const productMeta = productContextService.getMetadata();
    const productIndustry = productMeta.industry || '';
    const productName = productMeta.productName || '';
    let trendingHashtagsContext = '';

    try {
      console.log(`[Swarm] Buscando hashtags trending para "${productIndustry}" con Grounding...`);
      const hashtagQuery = `hashtags más populares y virales ahora en Instagram para ${productIndustry}${productName ? ' ' + productName : ''}. Busca los hashtags con mayor volumen y engagement actual para contenido de marketing.`;
      const hashtagResearch = await geminiService.generateTextWithGrounding(hashtagQuery, process.env.GEMINI_TEXT_GROUNDING_MODEL || 'gemini-3-flash-preview', { temperature: 0.4 });
      if (hashtagResearch && hashtagResearch.length > 30) {
        trendingHashtagsContext = `\n\n🔥 HASHTAGS TRENDING EN INSTAGRAM (datos de Google Search en tiempo real):\n${hashtagResearch}\nINSTRUCCIÓN: Selecciona los 10-15 hashtags más relevantes y virales de esta lista para tu contenido. Combina hashtags de alto volumen con hashtags de nicho específicos al tema del post. NO uses todos, filtra los mejores.`;
        console.log(`[Swarm] Hashtags trending obtenidos (${hashtagResearch.length} chars).`);
      }
    } catch (err) {
      console.warn(`[Swarm] No se pudieron obtener hashtags trending: ${err.message}`);
    }

    // --- FASE 0.75: ESTRATEGIA (marketing-ideas) ---
    let strategyContext = '';
    if (contentType !== 'flyer') {
      try {
        console.log(`[Swarm] Fase 0.75: Ángulo estratégico (marketing-ideas)...`);
        const strategyRaw = await this.agents.strategist.execute(`
BRIEFING: ${effectiveBriefing}
FORMATO: ${contentType}
PRODUCTO/SECTOR: ${productName || productIndustry || 'marca'}

Devuelve JSON:
{
  "angle": "ángulo persuasivo principal",
  "hook": "gancho de 1 frase",
  "audience_insight": "insight de audiencia",
  "cta": "CTA concreta",
  "avoid": ["clichés a evitar"]
}
`, { briefing: effectiveBriefing });

        const angle = strategyRaw?.angle || strategyRaw?.text || '';
        const hook = strategyRaw?.hook || '';
        const cta = strategyRaw?.cta || '';
        if (angle || hook) {
          strategyContext = `\n\nESTRATEGIA (obligatoria):\nÁNGULO: ${angle}\nGANCHO: ${hook}\nCTA: ${cta}\nINSIGHT: ${strategyRaw?.audience_insight || ''}\nEVITAR: ${JSON.stringify(strategyRaw?.avoid || [])}`;
          console.log(`[Swarm] ✅ Estrategia: ${String(angle).substring(0, 80)}...`);
        }
      } catch (err) {
        console.warn(`[Swarm] Estrategia omitida: ${err.message}`);
      }
    }

    // --- FASE 1: ESCRITURA ---
    if (contentType !== 'flyer') {
      console.log(`[Swarm] Fase 1: Redacción estratégica...`);
      const cleanBrandContext = knowledgeService.getAllAsText().split("ARCHIVOS Y ACTIVOS:")[0];
      const productContextSection = productContextService.getAsPromptSection();
      let writingPrompt = `BRIEFING: ${briefing}\nFORMATO: ${contentType}\nRATIO: ${aspectRatio}${strategyContext}`;
      
      // Inyectar hashtags trending SIEMPRE
      if (trendingHashtagsContext) {
        writingPrompt += trendingHashtagsContext;
      }
      
      // Inyectar contexto de producto SIEMPRE como sección prioritaria
      if (productContextSection) {
        writingPrompt += `\n\n${productContextSection}`;
        writingPrompt += `\nINSTRUCCIÓN: El contenido que generes DEBE estar sesgado hacia el producto/servicio descrito arriba. Usa su tono, su terminología y sus beneficios clave. NO generes contenido genérico.\n`;
      }
      
      if (projectState.researchData) {
        const rd = projectState.researchData;
        writingPrompt += `\n\n⚠️ DATOS DE INVESTIGACIÓN EXTRAÍDOS DE URL — BASA TU CONTENIDO EN ESTO ⚠️`;
        writingPrompt += `\nFUENTE: ${rd.source_url || rd.text || ''}`;
        writingPrompt += `\nTÍTULO: ${rd.page_title || ''}`;
        writingPrompt += `\nCONTENIDO PRINCIPAL: ${rd.main_content || JSON.stringify(rd)}`;
        if (rd.key_facts) writingPrompt += `\nDATOS CLAVE: ${JSON.stringify(rd.key_facts)}`;
        if (rd.powerful_quotes) writingPrompt += `\nCITAS POTENTES: ${JSON.stringify(rd.powerful_quotes)}`;
        if (rd.grounding_context) writingPrompt += `\nCONTEXTO GOOGLE: ${rd.grounding_context}`;
        if (rd.strategic_insights) {
          writingPrompt += `\nGANCHO SUGERIDO: ${rd.strategic_insights.suggested_hook || ''}`;
          writingPrompt += `\nÁNGULOS DE CONTENIDO: ${JSON.stringify(rd.strategic_insights.content_angles || [])}`;
        }
        writingPrompt += `\n\nINSTRUCCIÓN: El copy que generes DEBE estar basado al 100% en la información anterior. No inventes datos. Adapta el tono al formato ${contentType}.`;
      }

      let writingContext = { brandSummary: cleanBrandContext };

      const visionRefs = (externalReferences || []).filter(ref => ref.mode === 'vision');
      if (visionRefs.length > 0) {
        console.log(`[Flow] Modo VISIÓN activo para ${visionRefs.length} imágenes.`);
        writingContext.image_to_review = path.isAbsolute(visionRefs[0].path) ? visionRefs[0].path : path.join(__dirname, '..', visionRefs[0].path);
        writingPrompt += `\n\nTAREA CRÍTICA: Analiza las imágenes adjuntas. Describe su contenido y genera copy coherente.`;
      }
      
      projectState.content = await this.executeWithReview(
        this.agents.writer,
        this.agents.reviewer,
        writingPrompt,
        writingContext
      );
    } else {
      projectState.content = { text: "Modo gráfico (Flyer) - Sin textos generados." };
    }

    // --- FASE 2: PREPARACIÓN VISUAL ---
    const manualRefs = (externalReferences || []).map(ref => ({
      absolutePath: path.isAbsolute(ref.path) ? ref.path : path.join(__dirname, '..', ref.path),
      description: `REFERENCIA EXTERNA [MODO: ${ref.mode.toUpperCase()}]`,
      mode: ref.mode
    }));

    // Obtenemos TODOS los activos de imagen de la marca para tener un pool completo
    const brandAssets = knowledgeService.getImageAssets().map(a => ({ 
      absolutePath: a.absolutePath, 
      description: a.description 
    }));
    const allReferences = [...manualRefs, ...brandAssets];
    const baseImage = manualRefs.find(r => r.mode === 'edit' || r.mode === 'vision');

    // --- FASE 3: GENERACIÓN VISUAL ---
    // Usar effectiveBriefing (basado en URL si existe) en lugar del briefing crudo
    const productMetaForVisuals = productContextService.getMetadata();
    let visualBriefing = effectiveBriefing.includes("DIRECCIÓN VISUAL:") 
      ? effectiveBriefing.split("DIRECCIÓN VISUAL:")[1].split("STORYTELLING:")[0].trim()
      : effectiveBriefing;

    // Enriquecer el visual briefing con metadatos del producto para sesgo visual
    if (productMetaForVisuals.productName || productMetaForVisuals.industry) {
      visualBriefing += `\nPRODUCT CONTEXT: ${productMetaForVisuals.productName || ''} — ${productMetaForVisuals.industry || ''}. Visual style must be consistent with this product's brand identity.`;
    }

    console.log(`[Swarm] Optimizando prompt visual...`);
    let optimizerInput = visualBriefing;
    if (baseImage) optimizerInput = `TAREA: MODIFICAR IMAGEN BASE.\nIMAGEN_BASE: ${baseImage.absolutePath}\nBRIEFING_CAMBIOS: ${visualBriefing}`;

    const optObj = await this.agents.photoOptimizer.execute(optimizerInput);
    const optimizedBriefing = optObj.text ? optObj.text : optObj;

    if (contentType === 'video' || mediaType === 'video') {
      const isSingleVideo = (contentType === 'single');
      const isMultiScene = (contentType === 'video' || contentType === 'carousel');

      if (isSingleVideo || engineMode === 'direct') {
        // === RUTA A: UN SOLO CLIP DE 8 SEGUNDOS (Veo nativo con audio) ===
        console.log(`[Swarm] MODO SINGLE VIDEO: Generando 1 clip de 8s con Veo (audio nativo)...`);
        const brandChar = productContextService.getMetadata()?.presenterProfile || null;
        const singleScene = {
          promptVisual: typeof optimizedBriefing === 'string' ? optimizedBriefing : JSON.stringify(optimizedBriefing),
          spokenDialog: projectState.content?.instagram?.copy
            ? String(projectState.content.instagram.copy).split(/[.!?]/)[0].trim().split(/\s+/).slice(0, 14).join(' ')
            : null,
          title: null,
          subtitle: null,
          mood: 'inspiring'
        };
        let singleLock = null;
        if (brandChar) {
          singleLock = await this._generateCharacterLock(brandChar, aspectRatio);
          projectState.characterLock = singleLock;
        }
        const singleDirective = {
          photographyStyle: 'cinematic photorealistic, 35mm lens, shallow depth of field',
          lightingSetup: 'natural soft light',
          colorPalette: 'warm natural tones'
        };
        const { prompt: veoPrompt, enriched, wordCount } = await this._enrichVideoScenePrompt(
          singleScene, brandChar, singleDirective, { role: singleScene.spokenDialog ? 'talking' : 'broll', aspectRatio }
        );
        console.log(`[Swarm] Veo direct prompt: enriched=${enriched} words=${wordCount}`);
        try {
          const videoData = await this.agents.editor.execute(veoPrompt, {
            briefing: veoPrompt,
            is_pure_video_request: true,
            aspectRatio: aspectRatio,
            referenceImagePath: singleLock || null,
            personGeneration: 'allow_adult',
            videoTask: singleLock ? 'reference_to_video' : 'text_to_video'
          });
          if (videoData && videoData.url) {
            // Direct: publicar el MP4 de Veo sin Remotion (preserva audio/lip-sync)
            projectState.video = {
              url: videoData.url,
              hasAudio: videoData.hasAudio,
              duration: videoData.duration,
              engine: 'veo-direct'
            };
            projectState.visuals.push(videoData.url);
            // La imagen ancla del personaje ya no hace falta tras generar el clip final
            this._cleanupFiles([singleLock, projectState.characterLock]);
            projectState.characterLock = null;
            console.log(`[Swarm] ✅ Clip directo Veo listo (hasAudio=${videoData.hasAudio}).`);
          }
        } catch (err) { console.error(`[Swarm] Error Veo:`, err); }

      } else if (isMultiScene && engineMode === 'remotion') {
        // === RUTA B: MÚLTIPLES CLIPS + MONTAJE CON REMOTION ===
        console.log(`[Swarm] MODO MULTI-ESCENA REMOTION: Planificando...`);
        emitProgress('planning', 'Planificando guion del Reel...');
        const scenes = [];

        const visualDirective = await this._generateVisualDirective(effectiveBriefing, projectState.content);
        console.log(`[Remotion] 🎨 Directiva visual: ${JSON.stringify(visualDirective)}`);

        let researchContext = '';
        if (projectState.researchData) {
          const rd = projectState.researchData;
          researchContext = `
          ⚠️ CONTENIDO BASADO EN URL/NOTICIA ⚠️
          TÍTULO: ${rd.page_title || ''}
          CONTENIDO: ${rd.main_content || rd.text || ''}
          DATOS CLAVE: ${JSON.stringify(rd.key_facts || [])}
          GANCHO: ${rd.strategic_insights?.suggested_hook || ''}
          INSTRUCCIÓN: Cada escena DEBE representar visualmente el contenido de la noticia.
          `;
        }

        const brandPresenter = productContextService.getMetadata()?.presenterProfile || null;
        const remotionPlan = await this.agents.remotionAgent.execute(`
          CONTENIDO GENERADO: ${JSON.stringify(projectState.content)}
          BRIEFING: ${effectiveBriefing}
          ${researchContext}
          ACTIVOS DISPONIBLES: ${JSON.stringify(brandAssets.map(a => a.description))}
          DIRECTIVA VISUAL OBLIGATORIA: ${JSON.stringify(visualDirective)}
          ${brandPresenter ? `PERSONAJE DE MARCA PREFERIDO: ${brandPresenter}` : ''}

          Eres el PLANIFICADOR (pasada 1). NO escribas el prompt final de Veo.
          promptVisual = intención corta (1-3 frases EN): sujeto + acción + lugar concreto.
          Un optimizador posterior expandirá cada escena a 120-180 palabras.

          RESTRICCIÓN: Cada clip Veo = EXACTAMENTE 8 SEGUNDOS.
          AUDIO NATIVO VEO: spokenDialog en español castellano (máx 14 palabras) o null.
          Escena 1 = GANCHO (diálogo o impacto visual). Producto/marca: ≥1-2 spokenDialog.
          Títulos concretos (NUNCA "Descubre Más", "Contenido de calidad").
          
          Devuelve SOLO el JSON sin markdown:
          {
            "characterProfile": "Detailed English character lock OR null",
            "mood": "epic|calm|urgent|playful|dark|inspiring|farm|news",
            "visualDirective": { "colorPalette": "...", "photographyStyle": "...", "lightingSetup": "..." },
            "scenes": [
              { 
                "promptVisual": "Short EN intention: subject + action + specific place", 
                "spokenDialog": "Short Castilian Spanish line OR null",
                "voiceOver": null,
                "title": "SHORT TITLE", 
                "subtitle": "short subtitle", 
                "mood": "inspiring", 
                "animationStyle": "cinematic", 
                "requiredAsset": null 
              }
            ]
          }
        `, { briefing: effectiveBriefing });

        const planCheck = this._validateRemotionPlan(remotionPlan);
        if (planCheck.warnings.length) {
          console.warn(`[Remotion] Checklist plan: ${planCheck.warnings.join(' | ')}`);
        }

        let plannedScenes = this._parseAndValidateScenes(remotionPlan, optimizedBriefing);
        const directive = remotionPlan?.visualDirective || visualDirective;
        let characterProfile = remotionPlan?.characterProfile || brandPresenter || null;
        if (characterProfile === 'null') characterProfile = null;

        // Character lock: 1 imagen ancla si hay personaje
        let characterLockPath = null;
        const needsPerson = plannedScenes.some(s => s.spokenDialog) || !!characterProfile;
        if (needsPerson && characterProfile) {
          emitProgress('planning', 'Generando character lock...');
          characterLockPath = await this._generateCharacterLock(characterProfile, aspectRatio);
          projectState.characterLock = characterLockPath;
        }

        const totalScenes = plannedScenes.length;
        console.log(`[Remotion] 🎬 ${totalScenes} escenas. Character lock: ${characterLockPath || 'none'}`);
        emitProgress('generating', `Generando ${totalScenes} escenas...`, 0, totalScenes);

        // Doble pasada: enriquecer prompts Veo (talking secuencial; b-roll en paralelo)
        console.log(`[Remotion] 🔬 Enrichment de ${totalScenes} prompts Veo...`);
        emitProgress('generating', `Optimizando prompts de vídeo...`, 0, totalScenes);
        const veoPrompts = new Array(totalScenes).fill(null);

        const talkingForEnrich = [];
        const brollForEnrich = [];
        plannedScenes.forEach((sp, i) => {
          if (sp.spokenDialog) talkingForEnrich.push(i);
          else brollForEnrich.push(i);
        });

        for (const i of talkingForEnrich) {
          const sp = plannedScenes[i];
          const { prompt, enriched, wordCount } = await this._enrichVideoScenePrompt(
            sp, characterProfile, directive, { role: 'talking', aspectRatio }
          );
          veoPrompts[i] = prompt;
          console.log(`[Remotion] Prompt escena ${i + 1}: enriched=${enriched} words=${wordCount} role=talking`);
        }

        await Promise.all(brollForEnrich.map(async (i) => {
          const sp = plannedScenes[i];
          const { prompt, enriched, wordCount } = await this._enrichVideoScenePrompt(
            sp, characterProfile, directive, { role: 'broll', aspectRatio }
          );
          veoPrompts[i] = prompt;
          console.log(`[Remotion] Prompt escena ${i + 1}: enriched=${enriched} words=${wordCount} role=broll`);
        }));

        // Generación: escenas con persona SECUENCIALES; B-roll en paralelo
        const resultsByIndex = new Array(totalScenes).fill(null);

        // Talking (con diálogo) → secuencial + reference image
        // B-roll → paralelo (el CHARACTER LOCK textual sigue en el prompt)
        const talkingIndexes = [];
        const brollIndexes = [];
        plannedScenes.forEach((sp, i) => {
          if (sp.spokenDialog) talkingIndexes.push(i);
          else brollIndexes.push(i);
        });

        // Talking / character scenes — sequential for consistency
        for (const i of talkingIndexes) {
          const sp = plannedScenes[i];
          console.log(`[Remotion] 🎬 Clip Veo talking ${i + 1}/${totalScenes}...`);
          try {
            const data = await this.agents.editor.execute(veoPrompts[i], {
              briefing: veoPrompts[i],
              is_pure_video_request: true,
              aspectRatio,
              referenceImagePath: characterLockPath || null,
              personGeneration: 'allow_adult',
              videoTask: characterLockPath ? 'reference_to_video' : 'text_to_video'
            });
            resultsByIndex[i] = data;
            console.log(`[Remotion] Telemetría escena ${i + 1}: hasAudio=${data?.hasAudio} dialog=${!!sp.spokenDialog} ref=${!!characterLockPath}`);
          } catch (e) {
            console.error(`[Remotion] Error escena ${i + 1}:`, e.message);
          }
          emitProgress('generating', `Escena ${i + 1}/${totalScenes}`, i + 1, totalScenes);
        }

        // B-roll — parallel batches of 3
        const BATCH_SIZE = 3;
        for (let b = 0; b < Math.ceil(brollIndexes.length / BATCH_SIZE); b++) {
          const slice = brollIndexes.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
          const batchPromises = slice.map(async (i) => {
            if (mediaType === 'video') {
              console.log(`[Remotion] 🎬 Clip Veo b-roll ${i + 1}/${totalScenes}...`);
              try {
                const data = await this.agents.editor.execute(veoPrompts[i], {
                  briefing: veoPrompts[i],
                  is_pure_video_request: true,
                  aspectRatio,
                  referenceImagePath: characterLockPath || null,
                  personGeneration: characterLockPath ? 'allow_adult' : null,
                  videoTask: characterLockPath ? 'reference_to_video' : 'text_to_video'
                });
                console.log(`[Remotion] Telemetría escena ${i + 1}: hasAudio=${data?.hasAudio} dialog=false ref=${!!characterLockPath}`);
                return { index: i, data };
              } catch (e) {
                console.error(`[Remotion] Error escena ${i + 1}:`, e.message);
                return { index: i, data: null };
              }
            }
            const refs = this._filterReferences(plannedScenes[i].promptVisual, plannedScenes[i].requiredAsset, allReferences);
            const imgPrompt = await this._optimizeScenePrompt(
              plannedScenes[i].promptVisual,
              refs, i + 1, totalScenes, aspectRatio,
              { visualDirective: directive, characterProfile }
            );
            try {
              const data = await this.executeVisualWithReview(
                this.agents.designer, this.agents.reviewer, imgPrompt,
                { briefing: imgPrompt, imageModel, aspectRatio }, refs
              );
              return { index: i, data };
            } catch (e) {
              return { index: i, data: null };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          for (const { index, data } of batchResults) {
            resultsByIndex[index] = data;
            emitProgress('generating', `Escena ${index + 1}/${totalScenes}`, index + 1, totalScenes);
          }
        }

        for (let i = 0; i < totalScenes; i++) {
          const data = resultsByIndex[i];
          if (!data?.url) continue;
          const backgroundUrl = data.url;
          projectState.visuals.push(backgroundUrl);
          const sp = plannedScenes[i];
          const hasDialog = !!sp.spokenDialog;
          scenes.push({
            url: backgroundUrl.startsWith('http') ? backgroundUrl : `http://localhost:3001${backgroundUrl.startsWith('/') ? '' : '/'}${backgroundUrl}`,
            title: hasDialog ? this._shortTitle(sp.title, 6) : sp.title,
            subtitle: hasDialog ? this._shortTitle(sp.subtitle, 8) : sp.subtitle,
            animationStyle: hasDialog ? 'minimal-bar' : (sp.animationStyle || null),
            mood: sp.mood || null,
            spokenDialog: sp.spokenDialog || null,
            voiceOver: sp.voiceOver || null,
            hasNativeAudio: data.hasAudio === true || hasDialog,
            role: hasDialog ? 'talking' : 'broll'
          });
        }

        // Ordenar por índice original (talking/broll pueden completar desordenados en visuals, pero scenes se pushean en orden)
        // scenes already pushed in order 0..n

        if (scenes.length > 0) {
          emitProgress('rendering', 'Montando Reel con Remotion (audio nativo)...');
          const intermediateFiles = scenes.map(s => s.url);
          try {
            const hasAnyDialog = scenes.some(s => s.role === 'talking' || s.hasNativeAudio);
            const planMood = remotionPlan?.mood || null;
            const mood = bgmService.pickMoodFromScenes(scenes, planMood);
            const track = await bgmService.ensureTrack(mood);
            const localServer = `http://localhost:${process.env.PORT || 3001}`;
            const bgmUrl = track.absolutePath
              ? bgmService.toPublicUrl(track.absolutePath, localServer)
              : null;
            // Duck BGM fuerte si hay diálogo nativo
            const bgmVolume = bgmService.resolveVolume({ hasNativeDialog: hasAnyDialog });

            if (bgmUrl) {
              console.log(`[Remotion] 🎵 BGM mood=${track.mood} vol=${bgmVolume} (ducked=${hasAnyDialog})`);
            }

            projectState.video = await videoService.renderSwarmReel(scenes, {
              bgmUrl,
              bgmVolume
            });
            // Clips/imágenes de escena + character lock solo eran inputs del montaje final
            this._cleanupFiles([
              ...intermediateFiles,
              characterLockPath,
              projectState.characterLock
            ]);
            projectState.characterLock = null;
            projectState.visuals = projectState.video ? [projectState.video.url] : [];
            if (projectState.video) {
              projectState.video.bgm = track.fileName || null;
              projectState.video.mood = track.mood;
              projectState.video.hasNativeDialog = hasAnyDialog;
            }
          } catch (err) { console.error(`[Swarm] Error Remotion:`, err); }
        }
      }
    } 
    else if (contentType === 'carousel') {
       console.log(`[Swarm] Planificando carrusel narrativo...`);
       
       // Construir contexto de investigación para el carrusel
       let carouselResearchCtx = '';
       if (projectState.researchData) {
         const rd = projectState.researchData;
         carouselResearchCtx = `
         ⚠️ CONTENIDO BASADO EN URL/NOTICIA — LAS SLIDES DEBEN CONTAR ESTA INFORMACIÓN ⚠️
         TÍTULO: ${rd.page_title || ''}
         CONTENIDO: ${rd.main_content || rd.text || ''}
         DATOS CLAVE: ${JSON.stringify(rd.key_facts || [])}
         INSTRUCCIÓN: Cada slide debe informar sobre el contenido de la URL. NO hagas slides promocionales genéricos.
         `;
       }
       
       const carouselPlan = await this.agents.architect.execute(`
         Crea la estructura de un carrusel de Instagram.
         BRIEFING: ${effectiveBriefing}
         ${carouselResearchCtx}
         ACTIVOS DISPONIBLES: ${JSON.stringify(brandAssets.map(a => a.description))}
         
         promptVisual = intención corta (sujeto + acción + lugar). Un optimizador expandirá a prompt fotográfico detallado.
         
         Devuelve JSON:
         {
           "slides": [
             { "promptVisual": "short visual intention in English", "text": "texto informativo de la slide", "requiredAsset": "keyword del activo" }
           ]
         }
       `, { briefing: effectiveBriefing });

       const slides = carouselPlan?.slides || [];
       console.log(`[Swarm] Plan de carrusel: ${slides.length} slides detectadas.`);
       
       if (slides.length === 0) {
         console.warn(`[Swarm] ⚠️ El plan de carrusel no devolvió slides. Intentando usar el briefing como slide única.`);
         slides.push({
           promptVisual: optimizedBriefing,
           text: projectState.content?.text?.substring(0, 100) || "Desliza para saber más",
           requiredAsset: null
         });
       }

       const carouselDirective = await this._generateVisualDirective(effectiveBriefing, projectState.content);
       const carouselCharacter = productContextService.getMetadata()?.presenterProfile || null;

       for (let i = 0; i < slides.length; i++) { 
         const slidePlan = slides[i];
         const slideRefs = this._filterReferences(slidePlan.promptVisual, slidePlan.requiredAsset, allReferences);
         const slideText = (slidePlan.text || '').trim().toUpperCase();
         console.log(`[Swarm] Generando slide ${i+1}/${slides.length}: "${slideText}"...`);
         
         const optimizedSlidePrompt = await this._optimizeScenePrompt(
           slidePlan.promptVisual, slideRefs, i + 1, slides.length, aspectRatio,
           { visualDirective: carouselDirective, characterProfile: carouselCharacter }
         );
         
         // Añadir instrucción de texto narrativo directamente al prompt de Gemini
         const promptWithText = slideText
           ? `${optimizedSlidePrompt}. In the lower third of the image there is a dark semi-transparent gradient overlay. Overlaid on top of that gradient, bold white uppercase sans-serif text reads: "${slideText}". The text is centered horizontally, highly legible, clean modern typography, high contrast against the dark background.`
           : optimizedSlidePrompt;

         const imgData = await this.executeVisualWithReview(this.agents.designer, this.agents.reviewer, promptWithText, { briefing: promptWithText, imageModel, aspectRatio }, slideRefs);
         if (imgData) projectState.visuals.push(imgData.url);
       }
    }
    else {
       // Imagen única: segunda pasada photo-optimizer con directiva + presentador
       const imgRefs = this._filterReferences(optimizedBriefing, null, allReferences);
       const singleDirective = await this._generateVisualDirective(effectiveBriefing, projectState.content);
       const singleCharacter = productContextService.getMetadata()?.presenterProfile || null;
       const enrichedImagePrompt = await this._optimizeScenePrompt(
         typeof optimizedBriefing === 'string' ? optimizedBriefing : JSON.stringify(optimizedBriefing),
         imgRefs, 1, 1, aspectRatio,
         { visualDirective: singleDirective, characterProfile: singleCharacter }
       );
       const imagePrompt = `IMAGEN TÁCTICA: ${enrichedImagePrompt}. FORMATO: ${aspectRatio}.`;
       const imgData = await this.executeVisualWithReview(this.agents.designer, this.agents.reviewer, imagePrompt, { briefing: enrichedImagePrompt, imageModel, aspectRatio }, imgRefs);
       if (imgData) projectState.visuals.push(imgData.url);
    }

    console.log(`\x1b[32m[Swarm] MISION COMPLETADA.\x1b[0m`);
    return projectState;
  }

  /**
   * Workflow especializado para Audio Reel.
   * Transcribe audio → segmenta escenas → genera imágenes → monta con Remotion.
   */
  async runAudioReelWorkflow(audioPath, aspectRatio = '9:16', imageModel = 'google') {
    const geminiService = require('../services/geminiService');
    
    let projectState = {
      contentType: 'audio-reel',
      aspectRatio,
      content: null,
      visuals: [],
      video: null,
      audioPath
    };

    console.log(`\x1b[32m[Swarm] Iniciando misión AUDIO REEL [${aspectRatio}]\x1b[0m`);

    // --- FASE 1: TRANSCRIPCIÓN Y SEGMENTACIÓN ---
    console.log(`[Swarm] Fase 1: 🎙️ Transcripción y segmentación del audio...`);
    let audioData;
    try {
      audioData = await geminiService.transcribeAndSegmentAudio(audioPath);
    } catch (err) {
      console.error(`[Swarm] Error en transcripción:`, err.message);
      throw err;
    }

    projectState.content = {
      text: audioData.scenes.map(s => s.transcript).join(' '),
      scenes: audioData.scenes
    };

    console.log(`[Swarm] ✅ ${audioData.scenes.length} escenas detectadas (${audioData.totalDuration}s)`);

    // --- FASE 2: GENERACIÓN DE IMÁGENES POR ESCENA ---
    console.log(`[Swarm] Fase 2: 🖼️ Generando imágenes para ${audioData.scenes.length} escenas...`);
    const scenesWithImages = [];

    const brandAssets = knowledgeService.getImageAssets().map(a => ({
      absolutePath: a.absolutePath,
      description: a.description
    }));

    for (let i = 0; i < audioData.scenes.length; i++) {
      const scene = audioData.scenes[i];
      console.log(`[AudioReel] 🖼️ Escena ${i + 1}/${audioData.scenes.length}: "${scene.imagePrompt.substring(0, 60)}..."`);

      // Optimizar el prompt visual
      const optimizedPrompt = await this._optimizeScenePrompt(
        scene.imagePrompt,
        brandAssets.slice(0, 2),
        i + 1,
        audioData.scenes.length,
        aspectRatio,
        { characterProfile: productContextService.getMetadata()?.presenterProfile || null }
      );

      // Generar imagen
      const imgData = await this.executeVisualWithReview(
        this.agents.designer,
        this.agents.reviewer,
        optimizedPrompt,
        { briefing: optimizedPrompt, imageModel, aspectRatio },
        brandAssets.slice(0, 2)
      );

      if (imgData) {
        projectState.visuals.push(imgData.url);
        scenesWithImages.push({
          ...scene,
          imageUrl: imgData.url
        });
      }
    }

    // --- FASE 3: MONTAJE CON REMOTION ---
    if (scenesWithImages.length > 0) {
      console.log(`[Swarm] Fase 3: 🎬 Montando Audio Reel con Remotion...`);
      const intermediateImages = scenesWithImages.map(s => s.imageUrl).filter(Boolean);
      try {
        projectState.video = await videoService.renderAudioReel(
          scenesWithImages,
          audioPath,
          audioData.totalDuration
        );
        console.log(`[Swarm] ✅ Audio Reel renderizado: ${projectState.video.url}`);
        // Limpiar imágenes de escenas intermedias tras render exitoso
        this._cleanupFiles(intermediateImages);
        projectState.visuals = projectState.video ? [projectState.video.url] : [];
      } catch (err) {
        console.error(`[Swarm] Error en render Remotion:`, err.message);
      }
    }

    console.log(`\x1b[32m[Swarm] MISION AUDIO REEL COMPLETADA.\x1b[0m`);
    return projectState;
  }

  /**
   * Elimina del disco una lista de archivos generados (URLs o rutas relativas /output/...).
   * Se usa para limpiar imágenes/vídeos intermedios tras un render final.
   */
  _cleanupFiles(urlsOrPaths = []) {
    let deleted = 0;
    const seen = new Set();
    for (const urlOrPath of urlsOrPaths) {
      if (!urlOrPath || typeof urlOrPath !== 'string') continue;
      try {
        let absolute;
        // character lock y similares llegan como ruta absoluta en disco
        if (path.isAbsolute(urlOrPath) && fs.existsSync(urlOrPath)) {
          absolute = urlOrPath;
        } else {
          let filePath = urlOrPath;
          if (urlOrPath.startsWith('http')) {
            const url = new URL(urlOrPath);
            filePath = url.pathname;
          }
          const relative = filePath.replace(/^\/output\//, '').replace(/^output\//, '');
          absolute = path.join(OUTPUT_DIR, relative);
        }
        if (!absolute || seen.has(absolute)) continue;
        seen.add(absolute);
        if (fs.existsSync(absolute)) {
          fs.unlinkSync(absolute);
          deleted++;
        }
      } catch (e) {
        console.warn(`[Swarm] No se pudo eliminar archivo intermedio: ${e.message}`);
      }
    }
    if (deleted > 0) {
      console.log(`[Swarm] 🗑️ ${deleted} archivo(s) intermedio(s) eliminado(s).`);
    }
  }

  /**
   * Elimina artefactos de markdown y parámetros de herramientas externas (Midjourney, etc.)
   * de los prompts generados por el optimizador antes de enviarlos a Gemini.
   */
  _sanitizePrompt(text) {
    if (!text || typeof text !== 'string') return text;
    
    let clean = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/\*\*[^*]+\*\*:?\s*/g, '')
      .replace(/^#+\s.*/gm, '')
      .replace(/\*\([^)]*\)\*\.?/g, '')
      .replace(/^>\s*/gm, '')
      .replace(/--\w[\w-]*(\s+\S+)?/g, '')
      .replace(/^.*💡.*$/gm, '')
      .replace(/^.*\[INSERT_/gm, '')
      .replace(/\*+/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Conservar el prompt completo (antes se truncaba a la 1ª línea y perdía detalle)
    if (clean.length > 1200) {
      clean = clean.slice(0, 1200).trim();
      const lastStop = Math.max(clean.lastIndexOf('.'), clean.lastIndexOf(','));
      if (lastStop > 800) clean = clean.slice(0, lastStop + 1);
    }
    return clean;
  }

  /**
   * Optimiza el prompt visual de una escena individual (imagen: Remotion-foto, carrusel, single).
   * Pasa el prompt por el photo-prompt-optimizer con directiva y character lock.
   */
  async _optimizeScenePrompt(rawPrompt, sceneRefs, sceneNumber, totalScenes, aspectRatio, extra = {}) {
    try {
      const directive = extra.visualDirective || null;
      const characterProfile = extra.characterProfile || null;

      let optimizerInput = `ESCENA ${sceneNumber}/${totalScenes}. RATIO: ${aspectRatio}.\nDESCRIPCIÓN: ${rawPrompt}`;
      optimizerInput += `\nOUTPUT: One dense English photography paragraph, 120-160 words, 8-layer enrichment. No markdown.`;

      if (directive) {
        optimizerInput += `\nVISUAL DIRECTIVE (MUST KEEP — do not change style):\n${JSON.stringify(directive)}`;
      }
      if (characterProfile) {
        optimizerInput += `\nCHARACTER LOCK / subjectConsistency (MUST KEEP identical):\n${characterProfile}`;
      }

      if (sceneRefs && sceneRefs.length > 0) {
        const refDescriptions = sceneRefs.map((ref, idx) => {
          const mode = ref.mode || 'reference';
          const desc = ref.description || 'Activo de marca';
          if (mode === 'edit') return `[REF ${idx+1} - EDITAR]: "${desc}" — Usa esta imagen como BASE y aplícale los cambios del prompt.`;
          if (mode === 'vision') return `[REF ${idx+1} - ANALIZAR]: "${desc}" — Analiza esta imagen para inspirar la composición.`;
          return `[REF ${idx+1} - ESTILO]: "${desc}" — Mantén coherencia visual con este activo de marca.`;
        }).join('\n');
        optimizerInput += `\n\nIMÁGENES DE REFERENCIA ADJUNTAS:\n${refDescriptions}\nIMPORTANTE: Integra las referencias en tu prompt.`;
      }

      console.log(`[Optimizer] Optimizando prompt imagen escena ${sceneNumber}/${totalScenes}...`);
      const optResult = await this.agents.photoOptimizer.execute(optimizerInput);
      const raw = this._extractPromptText(optResult);
      // No truncar tan agresivo: prompts ricos necesitan espacio
      let optimized = raw
        .replace(/```/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (optimized.length > 2500) {
        optimized = optimized.slice(0, 2500).trim();
      }

      const words = this._wordCount(optimized);
      if (optimized && words >= 60) {
        console.log(`[Optimizer] Prompt imagen escena ${sceneNumber}: words=${words} "${optimized.substring(0, 100)}..."`);
        return optimized;
      }

      console.log(`[Optimizer] Resultado insuficiente (words=${words}), usando prompt enriquecido manual.`);
      const lock = characterProfile ? ` CHARACTER LOCK: ${characterProfile}.` : '';
      const dir = directive
        ? ` Style: ${directive.photographyStyle || ''}. Light: ${directive.lightingSetup || ''}. Palette: ${directive.colorPalette || ''}.`
        : '';
      return `${rawPrompt}.${lock}${dir} Hyper-realistic photograph, cinematic lighting, professional photography, ${aspectRatio} format, 4K detail, natural anatomy, no text in image, no watermarks.`;
    } catch (err) {
      console.error(`[Optimizer] Error optimizando escena ${sceneNumber}:`, err.message);
      return `${rawPrompt}. Hyper-realistic, cinematic lighting, professional photography, ${aspectRatio} format, 4K detail, no text in image.`;
    }
  }

  /**
   * Genera una directiva visual unificada para mantener coherencia entre escenas.
   */
  async _generateVisualDirective(briefing, content) {
    try {
      const result = await this.agents.photoOptimizer.execute(`
        Analiza este briefing y define UNA directiva visual UNIFICADA para todas las escenas de un Reel.
        BRIEFING: ${briefing}
        CONTENIDO: ${JSON.stringify(content)?.substring(0, 500)}
        
        Responde SOLO con JSON:
        {
          "colorPalette": "Descripción de paleta (ej: warm golden tones with deep shadows)",
          "photographyStyle": "Estilo fotográfico (ej: cinematic, shallow depth of field, 35mm)",
          "lightingSetup": "Iluminación (ej: golden hour natural light)"
        }
      `);
      if (result?.colorPalette) return result;
      return { colorPalette: 'warm natural tones', photographyStyle: 'hyper-realistic cinematic photography, 35mm lens', lightingSetup: 'natural golden hour lighting' };
    } catch (e) {
      return { colorPalette: 'warm natural tones', photographyStyle: 'hyper-realistic cinematic, 35mm', lightingSetup: 'golden hour lighting' };
    }
  }

  /**
   * Extrae texto de prompt desde respuesta de agente (string | {text} | JSON).
   */
  _extractPromptText(result) {
    if (!result) return '';
    if (typeof result === 'string') return result.trim();
    if (typeof result.text === 'string') return result.text.trim();
    if (typeof result.prompt === 'string') return result.prompt.trim();
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  _wordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * Fallback estructurado por capas para Veo (si falla el optimizer).
   */
  _buildVeoPrompt(scene, characterProfile, visualDirective = {}) {
    const dialog = scene.spokenDialog
      ? String(scene.spokenDialog).trim().split(/\s+/).slice(0, 14).join(' ')
      : null;

    const style = visualDirective.photographyStyle || 'cinematic photorealistic, 35mm lens, shallow depth of field';
    const light = visualDirective.lightingSetup || 'natural soft cinematic lighting';
    const palette = visualDirective.colorPalette || 'warm natural tones';
    const visual = scene.promptVisual || 'A professional vertical social video scene in a modern greenhouse';

    const subject = characterProfile
      ? `CHARACTER LOCK (must stay identical — do not change face, hair, age, or clothing): ${characterProfile}.`
      : 'Primary subject is the scene focus with clear photoreal detail.';

    const action = dialog
      ? 'Single continuous unbroken 8-second medium close-up shot (no scene cuts): the same character looks directly at the camera and speaks naturally with matching lip sync, subtle natural gestures.'
      : 'Single continuous unbroken 8-second shot (no scene cuts) with clear camera motion (slow push-in or gentle lateral glide), natural environmental motion.';

    const camera = 'Camera: vertical 9:16 Instagram Reels framing, 35mm cinematic feel, eye-level, rule of thirds, shallow depth of field. One continuous take only.';

    const audio = dialog
      ? `Audio: one speaker only, native Castilian Spanish (Español de España), professional natural voice, exact spoken dialogue with matching lip sync: "${dialog}". Soft ambient bed matching the location under the voice.`
      : 'Audio: rich ambient soundscape matching the location. No invented dialogue.';

    const finish = 'Photorealistic live-action, natural motion, high detail. No text overlays, no watermarks, no floating logos, no holograms, no drones as clichés, correct human anatomy, single coherent scene.';

    return `${subject} Scene intention: ${visual}. ${action} Environment and style: ${style}. Lighting: ${light}. Color palette: ${palette}. ${camera} ${audio} ${finish}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Doble pasada: expande intención de escena → prompt Veo 120–180 palabras.
   * Si falla, usa _buildVeoPrompt.
   */
  async _enrichVideoScenePrompt(scene, characterProfile, visualDirective = {}, options = {}) {
    const role = options.role || (scene.spokenDialog ? 'talking' : 'broll');
    const aspectRatio = options.aspectRatio || '9:16';
    const fallback = this._buildVeoPrompt(scene, characterProfile, visualDirective);

    const dialogLiteral = scene.spokenDialog
      ? String(scene.spokenDialog).trim().split(/\s+/).slice(0, 14).join(' ')
      : null;

    try {
      const input = `
Expand this Veo 3.1 scene brief into ONE dense English cinematic paragraph (120-180 words).
DURATION: about 8 seconds (must fit 3-10s Omni Flash range). ASPECT: ${aspectRatio}. ROLE: ${role}.
IMPORTANT: Omni Flash defaults to multi-shot — you MUST specify a single continuous unbroken shot with no scene cuts.

promptVisual (intention only): ${scene.promptVisual || ''}
spokenDialog (INSERT VERBATIM IN QUOTES — do not rewrite; null if none): ${dialogLiteral === null ? 'null' : JSON.stringify(dialogLiteral)}
characterProfile: ${characterProfile || 'null'}
visualDirective: ${JSON.stringify(visualDirective)}

RULES: Keep spokenDialog exact if present. Respect CHARACTER LOCK and visualDirective. No markdown. Output ONLY the prompt paragraph.
`.trim();

      const result = await this.agents.videoPromptOptimizer.execute(input, {
        briefing: scene.promptVisual,
        spokenDialog: dialogLiteral
      });

      let enriched = this._extractPromptText(result);
      enriched = enriched
        .replace(/^```[\s\S]*?\n/, '')
        .replace(/```$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      // Si el modelo omitió el diálogo, forzar inserción literal
      if (dialogLiteral && !enriched.includes(dialogLiteral)) {
        enriched += ` Exact spoken dialogue in native Castilian Spanish with matching lip sync: "${dialogLiteral}". One speaker only.`;
      }

      const words = this._wordCount(enriched);
      if (words >= 100 && enriched.length > 200) {
        console.log(`[VeoOptimizer] enriched=${true} words=${words} role=${role} dialog=${!!dialogLiteral}`);
        return { prompt: enriched, enriched: true, wordCount: words };
      }

      console.warn(`[VeoOptimizer] Resultado corto (words=${words}), usando fallback capas.`);
      return { prompt: fallback, enriched: false, wordCount: this._wordCount(fallback) };
    } catch (e) {
      console.warn(`[VeoOptimizer] Falló (${e.message}), usando fallback capas.`);
      return { prompt: fallback, enriched: false, wordCount: this._wordCount(fallback) };
    }
  }

  _shortTitle(text, maxWords = 6) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().split(/\s+/).slice(0, maxWords).join(' ');
  }

  /**
   * Genera imagen ancla del personaje para consistencia entre clips Veo.
   */
  async _generateCharacterLock(characterProfile, aspectRatio = '9:16') {
    try {
      const prompt = `Photorealistic portrait reference sheet of: ${characterProfile}. Neutral background, soft studio light, looking at camera, shoulders-up, consistent identity reference photo, no text, no logos.`;
      const img = await geminiService.generateImage(prompt, [], aspectRatio === '9:16' ? '9:16' : '1:1');
      if (img?.path && fs.existsSync(img.path)) {
        console.log(`[Remotion] 🔒 Character lock guardado: ${img.path}`);
        return img.path;
      }
      if (img?.url) {
        const local = path.join(OUTPUT_DIR, path.basename(img.url));
        if (fs.existsSync(local)) return local;
      }
    } catch (e) {
      console.warn(`[Remotion] Character lock falló: ${e.message}`);
    }
    return null;
  }

  /**
   * Checklist barato del plan Remotion antes de gastar en Veo.
   */
  _validateRemotionPlan(plan) {
    const warnings = [];
    const scenes = plan?.scenes || [];
    if (scenes.length < 3) warnings.push('Menos de 3 escenas');
    if (scenes.length > 0) {
      const t0 = (scenes[0].title || '').toLowerCase();
      if (/descubre|contenido|calidad|swarm/.test(t0)) warnings.push('Título genérico en escena 1');
    }
    const dialogs = scenes.filter(s => s.spokenDialog && String(s.spokenDialog).trim().length > 0);
    if (plan?.characterProfile && dialogs.length === 0) {
      warnings.push('Hay personaje pero ninguna escena con spokenDialog');
    }
    for (const d of dialogs) {
      const words = String(d.spokenDialog).trim().split(/\s+/).length;
      if (words > 16) warnings.push(`Diálogo demasiado largo (${words} palabras)`);
    }
    if (plan?.characterProfile && /straw|dirty|ragged|peasant/i.test(plan.characterProfile)) {
      warnings.push('characterProfile con estereotipo no deseado');
    }
    return { ok: warnings.length === 0, warnings };
  }

  /**
   * Valida y normaliza el array de escenas devuelto por el agente planificador.
   */
  _parseAndValidateScenes(plan, fallbackPrompt) {
    const raw = plan?.scenes || [];
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn(`[Swarm] ⚠️ Plan de escenas vacío, usando fallback de 3 escenas.`);
      return [
        { promptVisual: fallbackPrompt, spokenDialog: 'Así transformamos el campo con datos reales.', voiceOver: null, title: 'DATOS QUE IMPORTAN', subtitle: 'Agricultura conectada', mood: 'inspiring', animationStyle: 'cinematic', requiredAsset: null },
        { promptVisual: fallbackPrompt, spokenDialog: null, voiceOver: null, title: 'CONTROL TOTAL', subtitle: 'Desde tu móvil', mood: 'epic', animationStyle: 'slide-up', requiredAsset: 'dashboard' },
        { promptVisual: fallbackPrompt, spokenDialog: 'Empieza hoy con HelpMeAgro.', voiceOver: null, title: 'EMPIEZA HOY', subtitle: 'Pruébalo gratis', mood: 'inspiring', animationStyle: 'minimal-bar', requiredAsset: 'logo' },
      ];
    }

    const VALID_MOODS = ['epic', 'calm', 'urgent', 'playful', 'dark', 'inspiring', 'farm', 'news'];
    const VALID_STYLES = ['cinematic', 'glitch', 'slide-up', 'zoom-reveal', 'split', 'typewriter', 'neon-glow', 'minimal-bar'];
    const GENERIC = /^(descubre|contenido|calidad|swarm|más info)/i;

    return raw.slice(0, 6).map((s, i) => {
      let dialog = (typeof s.spokenDialog === 'string' && s.spokenDialog.trim().length > 0) ? s.spokenDialog.trim() : null;
      if (dialog) {
        dialog = dialog.split(/\s+/).slice(0, 14).join(' ');
      }
      let title = (typeof s.title === 'string' && s.title.length > 1) ? s.title.toUpperCase() : `ESCENA ${i + 1}`;
      if (GENERIC.test(title)) {
        title = i === 0 ? 'EL DATO CLAVE' : `PUNTO ${i + 1}`;
      }
      return {
        promptVisual: (typeof s.promptVisual === 'string' && s.promptVisual.length > 10) ? s.promptVisual : fallbackPrompt,
        spokenDialog: dialog,
        voiceOver: (typeof s.voiceOver === 'string' && s.voiceOver.length > 0) ? s.voiceOver : null,
        title,
        subtitle: (typeof s.subtitle === 'string') ? s.subtitle : '',
        mood: VALID_MOODS.includes(s.mood) ? s.mood : 'inspiring',
        animationStyle: VALID_STYLES.includes(s.animationStyle) ? s.animationStyle : VALID_STYLES[i % VALID_STYLES.length],
        requiredAsset: s.requiredAsset || null,
      };
    });
  }

  /**
   * Filtra las referencias visuales basándose en el prompt y el activo sugerido por el agente.
   */
  _filterReferences(prompt, requiredKeyword, allRefs) {
    const p = prompt.toLowerCase();
    const kw = requiredKeyword ? requiredKeyword.toLowerCase() : null;

    // 1. Siempre incluimos las referencias manuales del usuario (modo edit o vision)
    const filtered = allRefs.filter(r => r.mode === 'edit' || r.mode === 'vision');

    // 2. Si el agente ha sugerido un activo específico, lo buscamos con prioridad
    if (kw) {
      const specific = allRefs.find(r => r.description.toLowerCase().includes(kw));
      if (specific) filtered.push(specific);
    }

    // 3. Si el prompt menciona "logo", incluimos el primer logo de la marca
    if (p.includes('logo') || p.includes('marca') || p.includes('brand')) {
      const logo = allRefs.find(r => r.description.toLowerCase().includes('logo'));
      if (logo && !filtered.includes(logo)) filtered.push(logo);
    }

    // 4. Si el prompt menciona "interfaz", "app" o "dashboard", buscamos capturas
    if (p.includes('interfaz') || p.includes('app') || p.includes('dashboard') || p.includes('pantalla')) {
      const screenshot = allRefs.find(r => 
        r.description.toLowerCase().includes('interfaz') || 
        r.description.toLowerCase().includes('dashboard') ||
        r.description.toLowerCase().includes('captura')
      );
      if (screenshot && !filtered.includes(screenshot)) filtered.push(screenshot);
    }

    // Limitamos a 3 referencias para no confundir a la IA
    return filtered.slice(0, 3);
  }

  async executeWithReview(worker, reviewer, input, context) {
    let attempts = 0;
    let approved = false;
    let result = null;
    let feedback = "";
    let best = { result: null, score: -1 };

    while (attempts < this.maxRetries && !approved) {
      attempts++;
      console.log(`[Flow] ${worker.name} (Texto) - Intento ${attempts}...`);
      result = await worker.execute(input, { ...context, previous_feedback: feedback });
      
      const reviewInstruction = `
        Analiza este copy: ${JSON.stringify(result)}
        REGLAS:
        1. Evalúa SOLO el texto. NO pidas imágenes.
        2. Siglas invariables (ej: 'los DAT').
        3. Exige gancho fuerte, CTA, hashtags y fidelidad al briefing.
        4. score < 7 = NO aprobado.
        Devuelve JSON: { "approved": true/false, "feedback": "...", "score": 1-10 }
      `;
      
      const review = await reviewer.execute(reviewInstruction, context);
      const score = typeof review.score === 'number' ? review.score : (review.approved ? 7 : 5);
      if (score > best.score) best = { result, score };
      approved = review.approved === true && score >= 7;
      feedback = review.feedback || (approved ? '' : `Mejora el copy (score ${score}/10).`);
      console.log(`[Flow] Review score=${score}, approved=${approved}`);
    }

    if (!approved) {
      console.warn(`[Flow] Copy no alcanzó umbral tras ${attempts} intentos. Usando mejor score=${best.score}.`);
      return best.result || result;
    }
    return result;
  }

  async executeVisualWithReview(worker, reviewer, input, context, brandReferenceImages = []) {
    // Revisión visual desactivada a propósito: el humano aprueba desde el móvil.
    console.log(`[Flow] ${worker.name} (Visual) - Generando imagen única...`);
    
    const mediaData = await worker.execute(input, { 
      is_pure_image_request: true,
      referenceImages: brandReferenceImages,
      imageModel: context.imageModel,
      aspectRatio: context.aspectRatio || null
    });

    if (!mediaData) {
      console.error(`[Flow] Error: No se pudo generar la imagen con ${worker.name}`);
      return null;
    }

    return mediaData;
  }
}

const instance = new AgentOrchestrator();
instance.progressEmitter = progressEmitter;
module.exports = instance;
