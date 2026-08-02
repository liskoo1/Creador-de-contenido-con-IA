const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

class GeminiService {
  constructor() {
    this.ai = ai; 
    this.outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Genera texto CON Grounding (Google Search) activado.
   * El modelo puede buscar en Google en tiempo real para complementar su respuesta.
   */
  async generateTextWithGrounding(prompt, modelName = null, config = {}) {
    const model = modelName || process.env.GEMINI_TEXT_GROUNDING_MODEL || 'gemini-3-flash-preview';
    try {
      console.log(`[GeminiService] Generando con Grounding (Google Search)...`);
      const response = await this.ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          temperature: config.temperature || 0.5,
          tools: [{ googleSearch: {} }],
        }
      });
      return response.text;
    } catch (error) {
      console.error("[GeminiService] Error en generateTextWithGrounding:", error.message);
      // Fallback: intentar sin Grounding
      console.log("[GeminiService] Intentando fallback sin Grounding...");
      return await this.generateText(prompt, modelName, null, config);
    }
  }

  /**
   * Genera texto, opcionalmente incluyendo una imagen para análisis multimodal.
   */
  async generateText(prompt, modelName = null, imagePath = null, config = {}) {
    const model = modelName || process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
    try {
      const contents = [{ text: prompt }];

      if (imagePath) {
        const absolutePath = imagePath.startsWith('http') 
          ? path.join(this.outputDir, path.basename(imagePath))
          : imagePath;

        if (fs.existsSync(absolutePath)) {
          const imageData = fs.readFileSync(absolutePath);
          contents.push({
            inlineData: {
              data: imageData.toString('base64'),
              mimeType: 'image/png'
            }
          });
        }
      }

      const response = await this.ai.models.generateContent({
        model: model,
        contents: contents,
        config: {
          temperature: config.temperature || 0.7,
          topP: 0.9,
          topK: 40,
        }
      });
      return response.text;
    } catch (error) {
      console.error("[GeminiService] Error en generateText:", error.message);
      throw error;
    }
  }

  /**
   * Detecta mime type real por magic bytes (evita enviar JPEG etiquetado como PNG).
   */
  _detectImageMime(buffer, fallbackExt = '') {
    if (buffer && buffer.length >= 3) {
      if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
      if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
      if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
      if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
    }
    const ext = String(fallbackExt || '').toLowerCase().replace('.', '');
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    return 'image/png';
  }

  /**
   * Genera una imagen usando prompt de texto y, opcionalmente, imágenes de referencia de marca.
   * @param {string} prompt - Descripción de la imagen a generar.
   * @param {Array} referenceImages - Imágenes de referencia de marca.
   * @param {string} aspectRatio - Formato deseado: '1:1', '9:16', '16:9', '4:5', etc.
   */
  async generateImage(prompt, referenceImages = [], aspectRatio = null) {
    const result = await this._generateImageOnce(prompt, referenceImages, aspectRatio);
    if (result) return result;

    // IMAGE_OTHER / bloqueos frecuentes con fotos de personas reales en noticias:
    // reintentar sin referencias y con prompt autónomo.
    if (referenceImages && referenceImages.length > 0) {
      console.warn('[GeminiService] Fallo con referencias (posible IMAGE_OTHER). Reintentando sin imagen de referencia...');
      const fallbackPrompt = `${prompt}

IMPORTANT FALLBACK RULES:
- Do NOT recreate or likeness-match any real person from a photo.
- Invent an original agricultural/editorial background (greenhouse fields, Almería landscape, produce market, abstract editorial texture).
- Keep the headline text and footer exactly as requested.
- Generate a complete polished Instagram image from scratch.`;
      return await this._generateImageOnce(fallbackPrompt, [], aspectRatio);
    }
    return null;
  }

  async _generateImageOnce(prompt, referenceImages = [], aspectRatio = null) {
    try {
      const ratioDescriptions = {
        '1:1':  'perfectly square (1:1 ratio, same width and height)',
        '9:16': 'vertical portrait (9:16 ratio, much taller than wide, like an Instagram Story)',
        '16:9': 'horizontal landscape (16:9 ratio, much wider than tall, like a widescreen video)',
        '4:5':  'vertical portrait (4:5 ratio, slightly taller than wide, like an Instagram post)',
        '4:3':  'landscape (4:3 ratio, wider than tall)',
      };
      const ratioText = aspectRatio && ratioDescriptions[aspectRatio]
        ? ` IMPORTANT: Generate this image in ${ratioDescriptions[aspectRatio]} format.`
        : '';

      const finalPrompt = `${prompt}${ratioText}`;
      console.log(`\x1b[36m[GeminiService] === IMAGE GENERATION PROMPT ===\x1b[0m`);
      console.log(`\x1b[36m[GeminiService] Aspect Ratio: ${aspectRatio || 'default'}\x1b[0m`);
      console.log(`\x1b[36m[GeminiService] Prompt completo:\n${finalPrompt}\x1b[0m`);
      if (referenceImages && referenceImages.length > 0) {
        console.log(`\x1b[36m[GeminiService] Referencias adjuntas: ${referenceImages.map(r => r.description).join(', ')}\x1b[0m`);
      }
      console.log(`\x1b[36m[GeminiService] === FIN PROMPT ===\x1b[0m`);

      const fileName = `image_${uuidv4()}.png`;
      const filePath = path.join(this.outputDir, fileName);

      let contents = [];

      if (referenceImages && referenceImages.length > 0) {
        console.log(`[GeminiService] Adjuntando ${referenceImages.length} referencias visuales:`);
        contents.push({
          text: 'REFERENCE IMAGES (use as visual inspiration for background/composition only; do not reproduce identifiable faces or likenesses of real people):'
        });
        for (const ref of referenceImages) {
          if (fs.existsSync(ref.absolutePath)) {
            const imageData = fs.readFileSync(ref.absolutePath);
            const mimeType = this._detectImageMime(imageData, path.extname(ref.absolutePath));
            console.log(`[GeminiService]   - ${ref.description} (${mimeType}, ${imageData.length} bytes)`);
            contents.push({ text: `[REFERENCE: ${ref.description}]` });
            contents.push({ inlineData: { data: imageData.toString('base64'), mimeType } });
          }
        }
      }

      contents.push({ text: `GENERATE THIS IMAGE NOW: ${finalPrompt}` });

      const imageConfig = { imageSize: '1K' };
      if (aspectRatio && ratioDescriptions[aspectRatio]) {
        imageConfig.aspectRatio = aspectRatio;
      }

      const response = await this.ai.models.generateContent({
        model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
        contents: contents,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig,
        },
      });

      if (!response.candidates || response.candidates.length === 0) {
        console.error('[GeminiService] La IA no devolvió ningún candidato.');
        return null;
      }

      const candidate = response.candidates[0];
      const parts = candidate?.content?.parts;
      if (!parts || !Array.isArray(parts)) {
        console.error(
          '[GeminiService] Respuesta sin parts de imagen.',
          `finishReason=${candidate?.finishReason || 'unknown'}`,
          candidate?.safetyRatings ? JSON.stringify(candidate.safetyRatings) : ''
        );
        return null;
      }

      const part = parts.find(p => p.inlineData);

      if (part && part.inlineData) {
        fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
        return {
          url: `http://localhost:${process.env.PORT || 3001}/output/${fileName}`,
          path: filePath
        };
      }

      console.error('[GeminiService] La IA no devolvió ningún inlineData de imagen.');
      return null;
    } catch (error) {
      console.error('[GeminiService] Error en generateImage:', error.message);
      return null;
    }
  }

  /**
   * Detecta si un MP4 tiene pista de audio y su duración (ffprobe).
   */
  async probeVideoAudio(filePath) {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        '-show_format',
        filePath
      ], { timeout: 15000 });

      const data = JSON.parse(stdout || '{}');
      const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');
      const duration = parseFloat(data.format?.duration || audioStream?.duration || 0) || 0;
      return {
        hasAudio: !!audioStream,
        duration,
        audioCodec: audioStream?.codec_name || null
      };
    } catch (e) {
      console.warn(`[GeminiService] ffprobe no disponible o falló: ${e.message}`);
      return { hasAudio: null, duration: null, audioCodec: null };
    }
  }

  _isOmniVideoModel(model) {
    const m = String(model || '').toLowerCase();
    return m.includes('omni') || m.startsWith('gemini-omni');
  }

  /**
   * Extrae VideoContent (data o uri) de una Interaction Omni Flash (schema steps, SDK ≥2).
   * Preferir interaction.output_video (SDK convenience); fallback a steps[].content.
   */
  _extractOmniVideo(interaction) {
    if (!interaction) return null;
    if (interaction.output_video?.data || interaction.output_video?.uri) {
      return interaction.output_video;
    }

    const bags = [];
    // Legacy (no debería aparecer con SDK 2.x)
    if (Array.isArray(interaction.outputs)) bags.push(...interaction.outputs);

    if (Array.isArray(interaction.steps)) {
      // Recorrer de atrás hacia delante: el último model_output suele ser el vídeo final
      for (let i = interaction.steps.length - 1; i >= 0; i--) {
        const step = interaction.steps[i];
        if (step?.type === 'model_output' && Array.isArray(step.content)) {
          bags.push(...step.content);
        } else if (Array.isArray(step?.content)) {
          bags.push(...step.content);
        }
      }
    }

    const video = bags.find((c) => c && (c.type === 'video' || String(c.mime_type || '').startsWith('video/')));
    return video || interaction.output_video || null;
  }

  /**
   * Descarga vídeo Omni Flash (inline base64 o delivery=uri).
   */
  async _saveOmniVideoToFile(videoOutput, filePath) {
    if (!videoOutput) throw new Error('Omni Flash no devolvió vídeo');

    if (videoOutput.data) {
      fs.writeFileSync(filePath, Buffer.from(videoOutput.data, 'base64'));
      return;
    }

    if (!videoOutput.uri) {
      throw new Error('Omni Flash: vídeo sin data ni uri');
    }

    // Poll Files API hasta ACTIVE (docs oficiales delivery=uri)
    const match = String(videoOutput.uri).match(/files\/([a-zA-Z0-9_-]+)/);
    const fileName = match ? `files/${match[1]}` : videoOutput.uri;
    console.log(`[GeminiService] Omni URI delivery: esperando ACTIVE (${fileName})...`);

    const maxPolls = 60;
    for (let i = 0; i < maxPolls; i++) {
      const fInfo = await this.ai.files.get({ name: fileName });
      const state = fInfo?.state?.name || fInfo?.state || '';
      if (String(state).includes('ACTIVE')) break;
      if (String(state).includes('FAILED')) throw new Error('Omni Flash: generación fallida (Files API FAILED)');
      await new Promise((r) => setTimeout(r, 5000));
      if (i === maxPolls - 1) throw new Error('Omni Flash: timeout esperando fichero ACTIVE');
    }

    await this.ai.files.download({
      file: videoOutput,
      downloadPath: filePath
    });
  }

  /**
   * Genera vídeo con Gemini Omni Flash (Interactions API, schema steps — SDK ≥2.0).
   * Docs: https://ai.google.dev/gemini-api/docs/omni
   * Migración: https://ai.google.dev/gemini-api/docs/interactions-breaking-changes-may-2026
   */
  async _generateVideoWithOmni(prompt, aspectRatio, options = {}) {
    const model = process.env.GEMINI_VIDEO_MODEL || 'gemini-omni-flash-preview';
    const referenceImagePath = options.referenceImagePath || options.imagePath || null;
    const ratio = (aspectRatio === '9:16' || aspectRatio === '16:9') ? aspectRatio : '9:16';

    let input;
    let task = 'text_to_video';

    if (referenceImagePath && fs.existsSync(referenceImagePath)) {
      const imageData = fs.readFileSync(referenceImagePath);
      const ext = path.extname(referenceImagePath).toLowerCase().replace('.', '');
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      task = options.videoTask || (options.personGeneration ? 'reference_to_video' : 'image_to_video');
      input = [
        { type: 'image', data: imageData.toString('base64'), mime_type: mimeType },
        { type: 'text', text: prompt }
      ];
      console.log(`[GeminiService] Omni Flash task=${task} con imagen (${mimeType}).`);
    } else {
      input = prompt;
    }

    // Schema nuevo (SDK ≥2): response_format polimórfico type=video
    // delivery=uri exige store=true (error 400 si store=false)
    const params = {
      model,
      input,
      background: false,
      store: true,
      stream: false,
      response_format: {
        type: 'video',
        aspect_ratio: ratio,
        delivery: 'uri'
      },
      generation_config: {
        video_config: { task }
      }
    };

    let sdkVersion = 'unknown';
    try {
      sdkVersion = require(path.join(__dirname, '../node_modules/@google/genai/package.json')).version;
    } catch (_) { /* ignore */ }
    console.log(`[GeminiService] Omni Flash interactions.create model=${model} ratio=${ratio} task=${task} sdk=@google/genai@${sdkVersion}`);
    const interaction = await this.ai.interactions.create(params, {
      timeout: Number(process.env.GEMINI_VIDEO_TIMEOUT_MS || 600000)
    });

    if (interaction?.status === 'failed') {
      throw new Error(`Omni Flash interaction failed: ${JSON.stringify(interaction).slice(0, 500)}`);
    }

    let result = interaction;
    let polls = 0;
    while (result?.status === 'in_progress' && polls < 60) {
      console.log('[GeminiService] Omni Flash in_progress, polling interactions.get...');
      await new Promise((r) => setTimeout(r, 5000));
      result = await this.ai.interactions.get(result.id);
      polls++;
    }

    if (result?.status && result.status !== 'completed') {
      console.warn(`[GeminiService] Omni status inesperado: ${result.status}`);
    }

    const video = this._extractOmniVideo(result);
    if (!video) {
      const stepTypes = (result?.steps || []).map((s) => s.type).join(', ');
      throw new Error(`Omni Flash: sin vídeo en respuesta (status=${result?.status}, steps=[${stepTypes}])`);
    }
    return video;
  }

  /**
   * Legacy Veo via models.generateVideos (si GEMINI_VIDEO_MODEL es veo-*).
   */
  async _generateVideoWithVeo(prompt, aspectRatio, options = {}) {
    const referenceImagePath = options.referenceImagePath || options.imagePath || null;
    const config = { aspectRatio };
    if (options.resolution) config.resolution = options.resolution;
    if (options.personGeneration) config.personGeneration = options.personGeneration;

    const request = {
      model: process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-generate-preview',
      prompt,
      config
    };

    if (referenceImagePath && fs.existsSync(referenceImagePath)) {
      const imageData = fs.readFileSync(referenceImagePath);
      const ext = path.extname(referenceImagePath).toLowerCase().replace('.', '');
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
      request.image = { imageBytes: imageData.toString('base64'), mimeType };
      console.log(`[GeminiService] Veo image-to-video (${mimeType}).`);
    }

    let operation = await this.ai.models.generateVideos(request);
    while (!operation.done) {
      console.log('[GeminiService] Esperando Veo...');
      await new Promise((resolve) => setTimeout(resolve, 10000));
      operation = await this.ai.operations.getVideosOperation({ operation });
    }
    return operation.response.generatedVideos[0].video;
  }

  /**
   * Genera un clip de vídeo (default: Gemini Omni Flash via Interactions API).
   * Docs: https://ai.google.dev/gemini-api/docs/omni
   * @param {string} prompt
   * @param {string} aspectRatio - '9:16' | '16:9'
   * @param {object} options - { referenceImagePath, resolution, personGeneration, videoTask }
   */
  async generateVideoClip(prompt, aspectRatio = '9:16', options = {}) {
    try {
      const model = process.env.GEMINI_VIDEO_MODEL || 'gemini-omni-flash-preview';
      const referenceImagePath = options.referenceImagePath || options.imagePath || null;
      const useOmni = this._isOmniVideoModel(model);

      console.log(`\x1b[35m[GeminiService] === VIDEO GENERATION ===\x1b[0m`);
      console.log(`\x1b[35m[GeminiService] Backend: ${useOmni ? 'Omni Flash (Interactions)' : 'Veo (generateVideos)'}\x1b[0m`);
      console.log(`\x1b[35m[GeminiService] Model: ${model}\x1b[0m`);
      console.log(`\x1b[35m[GeminiService] Aspect Ratio: ${aspectRatio}\x1b[0m`);
      console.log(`\x1b[35m[GeminiService] Reference image: ${referenceImagePath || 'none'}\x1b[0m`);
      console.log(`\x1b[35m[GeminiService] Prompt:\n${prompt}\x1b[0m`);
      console.log(`\x1b[35m[GeminiService] === FIN ===\x1b[0m`);

      const fileName = `video_${uuidv4()}.mp4`;
      const filePath = path.join(this.outputDir, fileName);

      if (useOmni) {
        const videoOutput = await this._generateVideoWithOmni(prompt, aspectRatio, options);
        await this._saveOmniVideoToFile(videoOutput, filePath);
      } else {
        const veoFile = await this._generateVideoWithVeo(prompt, aspectRatio, options);
        await this.ai.files.download({ file: veoFile, downloadPath: filePath });
      }

      const probe = await this.probeVideoAudio(filePath);
      console.log(`[GeminiService] Video OK. hasAudio=${probe.hasAudio} duration=${probe.duration}s codec=${probe.audioCodec}`);

      let thumbnail = null;
      try {
        const videoService = require('./videoService');
        const thumb = await videoService.extractVideoThumbnail(filePath);
        thumbnail = thumb?.url || null;
      } catch (e) {
        console.warn(`[GeminiService] Thumbnail omitido: ${e.message}`);
      }

      return {
        url: `http://localhost:${process.env.PORT || 3001}/output/${fileName}`,
        path: filePath,
        hasAudio: probe.hasAudio,
        duration: probe.duration,
        audioCodec: probe.audioCodec,
        engine: useOmni ? 'omni-flash' : 'veo',
        thumbnail
      };
    } catch (error) {
      console.error('[GeminiService] Error en generateVideoClip:', error.message);
      if (error.stack) console.error(error.stack.split('\n').slice(0, 5).join('\n'));
      return null;
    }
  }

  /**
   * Transcribe un archivo de audio y lo segmenta en escenas visuales.
   * Usa Gemini multimodal para analizar el audio directamente.
   * @param {string} audioFilePath - Ruta absoluta al archivo de audio
   * @returns {Promise<Object>} - JSON con escenas, timestamps y subtítulos
   */
  async transcribeAndSegmentAudio(audioFilePath) {
    try {
      console.log(`[GeminiService] 🎙️ Transcribiendo y segmentando audio: ${path.basename(audioFilePath)}`);

      const audioData = fs.readFileSync(audioFilePath);
      const ext = path.extname(audioFilePath).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.webm': 'audio/webm',
        '.flac': 'audio/flac'
      };
      const mimeType = mimeTypes[ext] || 'audio/mpeg';

      const prompt = `
        Eres un director de vídeo experto. Analiza este audio de narración y devuelve un JSON estructurado.

        TAREAS:
        1. Transcribe el audio completo con timestamps precisos.
        2. Identifica CAMBIOS DE TEMA o ESCENA en la narración (cuando el narrador pasa a hablar de algo diferente).
        3. Para cada escena, genera un prompt visual EN INGLÉS optimizado para generar una imagen fotorrealista que represente lo que se está diciendo.
        4. Segmenta los subtítulos en grupos de 3-5 palabras con timestamps precisos.

        REGLAS:
        - Mínimo 2 escenas, máximo 8 escenas.
        - Los prompts visuales deben ser concretos y descriptivos (no abstractos).
        - Los prompts visuales deben estar EN INGLÉS.
        - Los subtítulos deben mantener el idioma original del audio.
        - Los timestamps deben ser en SEGUNDOS con decimales.
        - Cada grupo de subtítulos debe tener entre 3 y 5 palabras.

        DEVUELVE SOLO el JSON sin markdown, sin backticks:
        {
          "totalDuration": 45.2,
          "scenes": [
            {
              "startTime": 0.0,
              "endTime": 12.5,
              "transcript": "Texto completo de la escena en el idioma original",
              "imagePrompt": "Hyper-realistic photo of [detailed description]. Professional photography, cinematic lighting, 4K detail.",
              "subtitles": [
                {"text": "Grupo de 3-5 palabras", "start": 0.0, "end": 2.1},
                {"text": "Siguiente grupo", "start": 2.1, "end": 4.3}
              ]
            }
          ]
        }
      `;

      const contents = [
        { inlineData: { data: audioData.toString('base64'), mimeType } },
        { text: prompt }
      ];

      const response = await this.ai.models.generateContent({
        model: process.env.GEMINI_AUDIO_MODEL || 'gemini-3-flash-preview',
        contents: contents,
        config: {
          temperature: 0.3,
        }
      });

      const responseText = response.text;
      const cleanedText = responseText.replace(/```json|```/g, '').trim();

      let result;
      try {
        result = JSON.parse(cleanedText);
      } catch (parseErr) {
        console.error("[GeminiService] Error parseando JSON de transcripción:", parseErr.message);
        console.log("[GeminiService] Respuesta cruda:", cleanedText.substring(0, 500));
        throw new Error("La IA no devolvió un JSON válido para la transcripción del audio.");
      }

      // Validación básica
      if (!result.scenes || result.scenes.length === 0) {
        throw new Error("La IA no detectó ninguna escena en el audio.");
      }

      console.log(`[GeminiService] ✅ Audio transcrito: ${result.scenes.length} escenas detectadas, duración total: ${result.totalDuration}s`);
      return result;
    } catch (error) {
      console.error("[GeminiService] Error en transcribeAndSegmentAudio:", error.message);
      throw error;
    }
  }
}

module.exports = new GeminiService();
