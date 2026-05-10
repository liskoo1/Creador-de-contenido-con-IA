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
   * Genera una imagen usando prompt de texto y, opcionalmente, imágenes de referencia de marca.
   * @param {string} prompt - Descripción de la imagen a generar.
   * @param {Array} referenceImages - Imágenes de referencia de marca.
   * @param {string} aspectRatio - Formato deseado: '1:1', '9:16', '16:9', '4:5', etc.
   */
  async generateImage(prompt, referenceImages = [], aspectRatio = null) {
    try {
      // Mapear el aspect ratio a una descripción verbal clara para el modelo
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
      console.log(`[GeminiService] Pintando con Google (Nano Banana 2): "${finalPrompt.substring(0, 120)}..."`);
      
      const fileName = `image_${uuidv4()}.png`;
      const filePath = path.join(this.outputDir, fileName);

      let contents = [];

      if (referenceImages && referenceImages.length > 0) {
        console.log(`[GeminiService] Adjuntando ${referenceImages.length} referencias visuales:`);
        contents.push({ text: "IMÁGENES DE REFERENCIA DE MARCA (ÚSALAS EXACTAMENTE):" });
        for (const ref of referenceImages) {
          if (fs.existsSync(ref.absolutePath)) {
            const imageData = fs.readFileSync(ref.absolutePath);
            const ext = path.extname(ref.absolutePath).toLowerCase().replace('.', '');
            const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
            contents.push({ text: `[REFERENCIA: ${ref.description}]` });
            contents.push({ inlineData: { data: imageData.toString('base64'), mimeType } });
          }
        }
      }

      contents.push({ text: `IMAGEN A GENERAR: ${finalPrompt}` });

      const response = await this.ai.models.generateContent({
        model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image-preview',
        contents: contents,
      });
      
      if (!response.candidates || response.candidates.length === 0) {
        console.error("[GeminiService] La IA no devolvió ningún candidato.");
        return null;
      }

      const part = response.candidates[0].content.parts.find(p => p.inlineData);
      
      if (part && part.inlineData) {
        fs.writeFileSync(filePath, Buffer.from(part.inlineData.data, 'base64'));
        return {
          url: `http://localhost:${process.env.PORT || 3001}/output/${fileName}`,
          path: filePath
        };
      }
      
      console.error("[GeminiService] La IA no devolvió ningún inlineData de imagen.");
      return null;
    } catch (error) {
      console.error("[GeminiService] Error en generateImage:", error.message);
      return null;
    }
  }

  async generateVideoClip(prompt, aspectRatio = "16:9") {
    try {
      console.log(`[GeminiService] Generando video con Veo [${aspectRatio}]: "${prompt}"`);
      const fileName = `video_${uuidv4()}.mp4`;
      const filePath = path.join(this.outputDir, fileName);

      let operation = await this.ai.models.generateVideos({
        model: process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-lite-generate-preview',
        prompt: prompt,
        config: {
          aspectRatio: aspectRatio
        }
      });

      // Poll the operation status until the video is ready.
      while (!operation.done) {
        console.log("[GeminiService] Esperando a que el video se genere...");
        await new Promise((resolve) => setTimeout(resolve, 10000));
        operation = await this.ai.operations.getVideosOperation({
          operation: operation,
        });
      }

      // Download the generated video.
      await this.ai.files.download({
        file: operation.response.generatedVideos[0].video,
        downloadPath: filePath,
      });

      console.log(`[GeminiService] Video generado exitosamente.`);
      return {
        url: `http://localhost:${process.env.PORT || 3001}/output/${fileName}`,
        path: filePath
      };
    } catch (error) {
      console.error("[GeminiService] Error en generateVideoClip:", error.message);
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
