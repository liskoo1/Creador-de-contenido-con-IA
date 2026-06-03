const path = require('path');
const fs = require('fs');
const Agent = require('../agents/Agent');
const knowledgeService = require('../services/knowledgeService');
const productContextService = require('../services/productContextService');
const geminiService = require('../services/geminiService');
const videoService = require('../services/videoService');
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
      architect: new Agent("Arquitecto", "carousel-orchestrator", "text"),
      writer: new Agent("Escritor", "content-writer", "text"),
      reviewer: new Agent("Revisor", "content-reviewer", "text"),
      designer: new Agent("Diseñador Visual", "visual-designer", "image"),
      photoOptimizer: new Agent("Optimizador Visual", "photo-prompt-optimizer", "text"),
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

    // --- FASE 1: ESCRITURA ---
    if (contentType !== 'flyer') {
      console.log(`[Swarm] Fase 1: Redacción estratégica...`);
      const cleanBrandContext = knowledgeService.getAllAsText().split("ARCHIVOS Y ACTIVOS:")[0];
      const productContextSection = productContextService.getAsPromptSection();
      let writingPrompt = `BRIEFING: ${briefing}\nFORMATO: ${contentType}\nRATIO: ${aspectRatio}`;
      
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
        // === RUTA A: UN SOLO CLIP DE 8 SEGUNDOS ===
        console.log(`[Swarm] MODO SINGLE VIDEO: Generando 1 clip de 8 segundos con Google Veo...`);
        const videoPrompt = `${optimizedBriefing}. Cinematic quality, photorealistic, 1024px.`;
        try {
          const videoData = await this.agents.editor.execute(videoPrompt, { 
            briefing: optimizedBriefing,
            is_pure_video_request: true,
            aspectRatio: aspectRatio
          });
          if (videoData && videoData.url) {
            projectState.video = { url: videoData.url };
            projectState.visuals.push(videoData.url);
          }
        } catch (err) { console.error(`[Swarm] Error Veo:`, err); }

      } else if (isMultiScene && engineMode === 'remotion') {
        // === RUTA B: MÚLTIPLES CLIPS + MONTAJE CON REMOTION ===
        console.log(`[Swarm] MODO MULTI-ESCENA REMOTION: Planificando...`);
        emitProgress('planning', 'Planificando guion del Reel...');
        const scenes = [];

        // 1. Generar directiva visual para coherencia
        const visualDirective = await this._generateVisualDirective(effectiveBriefing, projectState.content);
        console.log(`[Remotion] 🎨 Directiva visual: ${JSON.stringify(visualDirective)}`);

        // 2. Construir contexto de investigación
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

        // 3. Planificar escenas con el video-orchestrator mejorado
        const remotionPlan = await this.agents.remotionAgent.execute(`
          CONTENIDO GENERADO: ${JSON.stringify(projectState.content)}
          BRIEFING: ${effectiveBriefing}
          ${researchContext}
          ACTIVOS DISPONIBLES: ${JSON.stringify(brandAssets.map(a => a.description))}
          DIRECTIVA VISUAL OBLIGATORIA: ${JSON.stringify(visualDirective)}
          RESTRICCIÓN: Cada clip = EXACTAMENTE 8 SEGUNDOS.
          
          Devuelve SOLO el JSON sin markdown:
          {
            "characterProfile": "Short character profile description in English (if any people are present, e.g. A modern organic farmer in his 30s, clean shaved, wearing a clean navy polo shirt, professional and confident look). If no characters are involved, use null.",
            "visualDirective": { "colorPalette": "...", "photographyStyle": "...", "lightingSetup": "..." },
            "scenes": [
              { 
                "promptVisual": "Visual description in English...", 
                "spokenDialog": "Spoken dialogue in Spanish by the character (if the character speaks in this scene, otherwise null)...",
                "voiceOver": "Background voice-over text in Spanish (if any, otherwise null)...",
                "title": "...", 
                "subtitle": "...", 
                "mood": "...", 
                "animationStyle": "cinematic", 
                "requiredAsset": null 
              }
            ]
          }
        `, { briefing: effectiveBriefing });

        // 4. Validar escenas
        const plannedScenes = this._parseAndValidateScenes(remotionPlan, optimizedBriefing);
        const totalScenes = plannedScenes.length;
        console.log(`[Remotion] 🎬 ${totalScenes} escenas validadas.`);
        emitProgress('generating', `Generando ${totalScenes} escenas...`, 0, totalScenes);

        // 5. Optimizar TODOS los prompts primero (batch)
        const optimizedPrompts = await Promise.all(
          plannedScenes.map(async (sp, i) => {
            const refs = this._filterReferences(sp.promptVisual, sp.requiredAsset, allReferences);
            const directive = remotionPlan?.visualDirective || visualDirective;
            
            // Incluir el characterProfile en la optimización del prompt visual
            const characterInfo = remotionPlan?.characterProfile ? `Subject is ${remotionPlan.characterProfile}. ` : '';
            const enriched = `${characterInfo}${sp.promptVisual}. ESTILO VISUAL OBLIGATORIO: ${directive.photographyStyle || 'hyper-realistic'}. ILUMINACIÓN: ${directive.lightingSetup || 'cinematic'}. PALETA: ${directive.colorPalette || 'warm'}.`;
            
            let optimized = await this._optimizeScenePrompt(enriched, refs, i + 1, totalScenes, aspectRatio);
            
            // Inyectar la instrucción de diálogo hablado para el lip-sync después de optimizar
            if (sp.spokenDialog) {
              optimized = `${optimized}. The character in the video is looking directly at the camera and speaking in clear, native Castilian Spanish from Spain (Español de España) with a natural and professional accent. The character's exact spoken dialogue is: "${sp.spokenDialog}". Sychronize lips and voice generation to this Spanish speech.`;
            }
            return optimized;
          })
        );

        // 6. Generar escenas EN PARALELO (batches de 3)
        const BATCH_SIZE = 3;
        for (let batch = 0; batch < Math.ceil(totalScenes / BATCH_SIZE); batch++) {
          const start = batch * BATCH_SIZE;
          const end = Math.min(start + BATCH_SIZE, totalScenes);
          const batchPromises = [];

          for (let i = start; i < end; i++) {
            const prompt = optimizedPrompts[i];
            if (mediaType === 'video') {
              console.log(`[Remotion] 🎬 Clip Veo ${i+1}/${totalScenes} (batch ${batch+1})...`);
              batchPromises.push(
                this.agents.editor.execute(prompt, { briefing: prompt, is_pure_video_request: true, aspectRatio })
                  .then(d => ({ index: i, data: d }))
                  .catch(e => { console.error(`[Remotion] Error escena ${i+1}:`, e.message); return { index: i, data: null }; })
              );
            } else {
              console.log(`[Remotion] 🖼️ Imagen ${i+1}/${totalScenes} (batch ${batch+1})...`);
              const refs = this._filterReferences(plannedScenes[i].promptVisual, plannedScenes[i].requiredAsset, allReferences);
              batchPromises.push(
                this.executeVisualWithReview(this.agents.designer, this.agents.reviewer, prompt, { briefing: prompt, imageModel, aspectRatio }, refs)
                  .then(d => ({ index: i, data: d }))
                  .catch(e => { console.error(`[Remotion] Error escena ${i+1}:`, e.message); return { index: i, data: null }; })
              );
            }
          }

          const batchResults = await Promise.allSettled(batchPromises);
          for (const result of batchResults) {
            const { index, data } = result.status === 'fulfilled' ? result.value : { index: -1, data: null };
            if (index === -1 || !data) continue;
            const backgroundUrl = data.url;
            if (backgroundUrl) {
              emitProgress('generating', `Escena ${index+1}/${totalScenes} completada`, index + 1, totalScenes);
              projectState.visuals.push(backgroundUrl);
              const sp = plannedScenes[index];
              scenes.push({
                url: backgroundUrl.startsWith('http') ? backgroundUrl : `http://localhost:3001${backgroundUrl.startsWith('/') ? '' : '/'}${backgroundUrl}`,
                title: sp.title,
                subtitle: sp.subtitle
              });
            }
          }
        }

        // 7. Renderizar con Remotion y limpiar archivos intermedios
        if (scenes.length > 0) {
          emitProgress('rendering', 'Montando Reel con Remotion...');
          const intermediateFiles = scenes.map(s => s.url);
          try {
            projectState.video = await videoService.renderSwarmReel(scenes);
            // Limpiar imágenes/clips intermedios tras render exitoso
            this._cleanupFiles(intermediateFiles);
            // En el estado final solo guardamos el vídeo, no los intermedios
            projectState.visuals = projectState.video ? [projectState.video.url] : [];
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
         
         Devuelve JSON:
         {
           "slides": [
             { "promptVisual": "descripción visual de la slide", "text": "texto informativo de la slide", "requiredAsset": "keyword del activo" }
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

       for (let i = 0; i < slides.length; i++) { 
         const slidePlan = slides[i];
         const slideRefs = this._filterReferences(slidePlan.promptVisual, slidePlan.requiredAsset, allReferences);
         const slideText = (slidePlan.text || '').trim().toUpperCase();
         console.log(`[Swarm] Generando slide ${i+1}/${slides.length}: "${slideText}"...`);
         
         // Optimizar el prompt visual de cada slide
         const optimizedSlidePrompt = await this._optimizeScenePrompt(slidePlan.promptVisual, slideRefs, i + 1, slides.length, aspectRatio);
         
         // Añadir instrucción de texto narrativo directamente al prompt de Gemini
         const promptWithText = slideText
           ? `${optimizedSlidePrompt}. In the lower third of the image there is a dark semi-transparent gradient overlay. Overlaid on top of that gradient, bold white uppercase sans-serif text reads: "${slideText}". The text is centered horizontally, highly legible, clean modern typography, high contrast against the dark background.`
           : optimizedSlidePrompt;

         const imgData = await this.executeVisualWithReview(this.agents.designer, this.agents.reviewer, promptWithText, { briefing: promptWithText, imageModel, aspectRatio }, slideRefs);
         if (imgData) projectState.visuals.push(imgData.url);
       }
    }
    else {
       // Para imagen única, enviamos todo el pool relevante pero priorizando logos si se menciona la marca
       const imgRefs = this._filterReferences(optimizedBriefing, null, allReferences);
       const imagePrompt = `IMAGEN TÁCTICA: ${optimizedBriefing}. FORMATO: ${aspectRatio}.`;
       const imgData = await this.executeVisualWithReview(this.agents.designer, this.agents.reviewer, imagePrompt, { briefing: optimizedBriefing, imageModel, aspectRatio }, imgRefs);
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
        aspectRatio
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
    for (const urlOrPath of urlsOrPaths) {
      if (!urlOrPath || typeof urlOrPath !== 'string') continue;
      try {
        let filePath = urlOrPath;
        if (urlOrPath.startsWith('http')) {
          const url = new URL(urlOrPath);
          filePath = url.pathname;
        }
        const relative = filePath.replace(/^\/output\//, '').replace(/^output\//, '');
        const absolute = path.join(OUTPUT_DIR, relative);
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
      // Eliminar bloques de código markdown
      .replace(/```[\s\S]*?```/g, '')
      // Eliminar cabeceras markdown y negritas con etiquetas como "**Optimized Prompt:**"
      .replace(/\*\*[^*]+\*\*:?\s*/g, '')
      // Eliminar líneas que empiezan por # (cabeceras)
      .replace(/^#+\s.*/gm, '')
      // Eliminar notas entre paréntesis con asteriscos *(Note: ...)*
      .replace(/\*\([^)]*\)\*\.?/g, '')
      // Eliminar el bloque de cita de blockquote (>)
      .replace(/^>\s*/gm, '')
      // Eliminar parámetros de Midjourney/Stable Diffusion
      .replace(/--\w[\w-]*(\s+\S+)?/g, '')
      // Eliminar líneas que contengan "💡" o instrucciones para el usuario
      .replace(/^.*💡.*$/gm, '')
      .replace(/^.*\[INSERT_/gm, '')
      // Eliminar asteriscos sueltos de énfasis
      .replace(/\*+/g, '')
      // Colapsar múltiples líneas en blanco
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Si hay varias líneas, coger solo el primer párrafo de contenido sustancial
    const lines = clean.split('\n').map(l => l.trim()).filter(l => l.length > 20);
    return lines.length > 0 ? lines[0] : clean;
  }

  /**
   * Optimiza el prompt visual de una escena individual (Remotion, carrusel, vídeo).
   * Pasa el prompt por el photo-prompt-optimizer y construye instrucciones sobre las referencias.
   */
  async _optimizeScenePrompt(rawPrompt, sceneRefs, sceneNumber, totalScenes, aspectRatio) {
    try {
      // Construir input para el optimizer incluyendo info de referencias
      let optimizerInput = `ESCENA ${sceneNumber}/${totalScenes}. RATIO: ${aspectRatio}.\nDESCRIPCIÓN: ${rawPrompt}`;
      
      // Si hay referencias adjuntas, describir QUÉ son y PARA QUÉ usarlas
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

      console.log(`[Optimizer] Optimizando prompt escena ${sceneNumber}/${totalScenes}...`);
      const optResult = await this.agents.photoOptimizer.execute(optimizerInput);
      const raw = optResult?.text || optResult;
      const optimized = this._sanitizePrompt(typeof raw === 'string' ? raw : JSON.stringify(raw));
      
      // Validar que el resultado es un string útil
      if (optimized && optimized.length > 30) {
        console.log(`[Optimizer] Prompt final escena ${sceneNumber}: "${optimized.substring(0, 100)}..."`);
        return optimized;
      }
      
      // Fallback: si el optimizer devuelve algo inútil, enriquecer manualmente
      console.log(`[Optimizer] Resultado insuficiente, usando prompt enriquecido manual.`);
      return `${rawPrompt}. Hyper-realistic, cinematic lighting, professional photography, ${aspectRatio} format, 4K detail, dramatic composition.`;
    } catch (err) {
      console.error(`[Optimizer] Error optimizando escena ${sceneNumber}:`, err.message);
      return `${rawPrompt}. Hyper-realistic, cinematic lighting, professional photography, ${aspectRatio} format, 4K detail.`;
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
   * Valida y normaliza el array de escenas devuelto por el agente planificador.
   */
  _parseAndValidateScenes(plan, fallbackPrompt) {
    const raw = plan?.scenes || [];
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn(`[Swarm] ⚠️ Plan de escenas vacío, usando fallback de 3 escenas.`);
      return [
        { promptVisual: fallbackPrompt, spokenDialog: null, voiceOver: null, title: 'DESCUBRE', subtitle: 'La nueva forma de gestionar', mood: 'inspiring', animationStyle: 'cinematic', requiredAsset: null },
        { promptVisual: fallbackPrompt, spokenDialog: null, voiceOver: null, title: 'CONTROLA TODO', subtitle: 'Desde tu móvil', mood: 'epic', animationStyle: 'slide-up', requiredAsset: 'dashboard' },
        { promptVisual: fallbackPrompt, spokenDialog: null, voiceOver: null, title: 'EMPIEZA HOY', subtitle: 'Pruébalo gratis', mood: 'inspiring', animationStyle: 'zoom-reveal', requiredAsset: 'logo' },
      ];
    }

    const VALID_MOODS = ['epic', 'calm', 'urgent', 'playful', 'dark', 'inspiring'];
    const VALID_STYLES = ['cinematic', 'glitch', 'slide-up', 'zoom-reveal', 'split', 'typewriter', 'neon-glow', 'minimal-bar'];

    return raw.slice(0, 6).map((s, i) => ({
      promptVisual: (typeof s.promptVisual === 'string' && s.promptVisual.length > 10) ? s.promptVisual : fallbackPrompt,
      spokenDialog: (typeof s.spokenDialog === 'string' && s.spokenDialog.length > 0) ? s.spokenDialog : null,
      voiceOver: (typeof s.voiceOver === 'string' && s.voiceOver.length > 0) ? s.voiceOver : null,
      title: (typeof s.title === 'string' && s.title.length > 1) ? s.title.toUpperCase() : `ESCENA ${i + 1}`,
      subtitle: (typeof s.subtitle === 'string') ? s.subtitle : '',
      mood: VALID_MOODS.includes(s.mood) ? s.mood : 'inspiring',
      animationStyle: VALID_STYLES.includes(s.animationStyle) ? s.animationStyle : VALID_STYLES[i % VALID_STYLES.length],
      requiredAsset: s.requiredAsset || null,
    }));
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

    while (attempts < this.maxRetries && !approved) {
      attempts++;
      console.log(`[Flow] ${worker.name} (Texto) - Intento ${attempts}...`);
      result = await worker.execute(input, { ...context, previous_feedback: feedback });
      
      const reviewInstruction = `
        Analiza este copy: ${JSON.stringify(result)}
        REGLAS:
        1. Evalúa SOLO el texto. NO pidas imágenes.
        2. Siglas invariables (ej: 'los DAT').
        Devuelve JSON: { "approved": true/false, "feedback": "...", "score": 1-10 }
      `;
      
      const review = await reviewer.execute(reviewInstruction, context);
      approved = review.approved;
      feedback = review.feedback;
    }
    return result;
  }

  async executeVisualWithReview(worker, reviewer, input, context, brandReferenceImages = []) {
    console.log(`[Flow] ${worker.name} (Visual) - Generando imagen única...`);
    
    // Generamos la imagen directamente sin pasar por el proceso de revisión
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
