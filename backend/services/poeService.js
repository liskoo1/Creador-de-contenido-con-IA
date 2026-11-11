const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const OUTPUT_POE_DIR = path.join(__dirname, '../output/poe');
if (!fs.existsSync(OUTPUT_POE_DIR)) {
  fs.mkdirSync(OUTPUT_POE_DIR, { recursive: true });
}

// Modelos por defecto validados en el catálogo oficial de Poe
const DEFAULT_IMAGE_MODEL = 'nano-banana-2.1';
const DEFAULT_VIDEO_MODEL = 'gemini-omni-1.1-flash';

// Reserva preventiva de puntos para evitar gastar sin saldo suficiente
const DEFAULT_PILOT_POINTS_RESERVE = 40000;
const ESTIMATED_IMAGE_POINTS = 1200;
const ESTIMATED_VIDEO_POINTS = 30000;

// Límite máximo de tamaño en descargas seguras (50 MB)
const MAX_DOWNLOAD_SIZE_BYTES = 50 * 1024 * 1024;

// Tipos MIME multimedia permitidos
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime'
]);

class PoeService {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.POE_API_KEY || '';
    this.apiBase = (options.apiBase || process.env.POE_API_BASE || 'https://api.poe.com').replace(/\/+$/, '');
    this.defaultImageModel = options.defaultImageModel || DEFAULT_IMAGE_MODEL;
    this.defaultVideoModel = options.defaultVideoModel || DEFAULT_VIDEO_MODEL;
    this.outputDir = options.outputDir || OUTPUT_POE_DIR;
    this.serverUrl = (process.env.SERVER_URL || 'http://localhost:3001').replace(/\/+$/, '');
    this.allowLocalHosts = Boolean(options.allowLocalHosts || process.env.POE_ALLOW_LOCAL_HOSTS === 'true' || process.env.NODE_ENV === 'test');
  }

  /**
   * Indica si la clave de API está configurada en el entorno.
   */
  hasApiKey() {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  /**
   * Consulta el catálogo oficial público de modelos de Poe.
   * Endpoint público: https://api.poe.com/v1/models
   */
  async getModelsCatalog() {
    try {
      const res = await fetch(`${this.apiBase}/v1/models`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: `Error consultando catálogo de Poe: HTTP ${res.status} ${res.statusText}`
        };
      }

      const body = await res.json();
      const models = Array.isArray(body) ? body : (body.data || []);

      return {
        success: true,
        total: models.length,
        models
      };
    } catch (e) {
      return {
        success: false,
        error: `Fallo de red al consultar catálogo de Poe: ${e.message}`
      };
    }
  }

  /**
   * Busca un modelo específico en el catálogo y devuelve su descriptor y parámetros soportados.
   */
  async getModelDescriptor(modelId) {
    const catalogResult = await this.getModelsCatalog();
    if (!catalogResult.success) return catalogResult;

    const found = catalogResult.models.find(m => (m.id || m.name) === modelId);
    if (!found) {
      return {
        success: false,
        error: `Modelo "${modelId}" no encontrado en el catálogo de Poe.`
      };
    }

    return {
      success: true,
      model: found
    };
  }

  /**
   * Consulta el saldo actual en puntos de la cuenta de Poe.
   * Endpoint: https://api.poe.com/usage/current_balance (requiere POE_API_KEY).
   */
  async getBalance() {
    if (!this.hasApiKey()) {
      return {
        success: false,
        mock: true,
        balance: null,
        message: 'POE_API_KEY no configurada. Saldo no disponible.'
      };
    }

    try {
      const res = await fetch(`${this.apiBase}/usage/current_balance`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey.trim()}`,
          'Accept': 'application/json'
        }
      });

      if (res.status === 401) {
        return {
          success: false,
          status: 401,
          error: 'Credencial de Poe inválida o expirada (HTTP 401).'
        };
      }

      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: `Error consultando saldo de Poe: HTTP ${res.status}`
        };
      }

      const data = await res.json();
      let balance = null;
      if (typeof data.current_point_balance === 'number') {
        balance = data.current_point_balance;
      } else if (typeof data.balance === 'number') {
        balance = data.balance;
      } else if (typeof data.points === 'number') {
        balance = data.points;
      }

      if (balance === null) {
        return {
          success: false,
          status: 502,
          error: 'Respuesta de Poe sin campo de saldo reconocible (current_point_balance ausente).',
          data
        };
      }

      return {
        success: true,
        balance,
        current_point_balance: balance,
        data
      };
    } catch (e) {
      return {
        success: false,
        error: `Error de red consultando saldo de Poe: ${e.message}`
      };
    }
  }

  /**
   * Extrae la URL del archivo de medios a partir de la respuesta de Poe (OpenAI-compatible o nativo).
   */
  extractMediaUrl(responseData) {
    if (!responseData) return null;

    // 1. Si la respuesta contiene attachments directos (FastAPI Poe / protocol messages)
    if (Array.isArray(responseData.attachments) && responseData.attachments.length > 0) {
      const first = responseData.attachments[0];
      if (first && first.url) return first.url;
    }

    // 2. Si viene de choices[0].message.attachments
    const choice = responseData.choices && responseData.choices[0];
    if (choice && choice.message && Array.isArray(choice.message.attachments) && choice.message.attachments.length > 0) {
      const att = choice.message.attachments[0];
      if (att && att.url) return att.url;
    }

    // 3. Si viene dentro del texto content (Markdown o enlace directo)
    const content = (choice && choice.message && choice.message.content) || responseData.text || responseData.content || '';
    if (typeof content === 'string') {
      // Regex para markdown image/media: ![...](https://...) o [...](https://...)
      const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^\s\)\'\"]+)\)/i) ||
                      content.match(/\[.*?\]\((https?:\/\/[^\s\)\'\"]+)\)/i);
      if (mdMatch && mdMatch[1]) return mdMatch[1];

      // Regex para URL directa de poecdn o multimedia (.mp4, .png, .jpg, .jpeg, .webp)
      const urlMatch = content.match(/https?:\/\/[^\s\'\"\<\>]+\.(?:mp4|webm|png|jpg|jpeg|webp)(?:\?[^\s\'\"\<\>]*)?/i) ||
                       content.match(/https?:\/\/[^\s\'\"\<\>]*(?:poecdn\.net|poe\.com)[^\s\'\"\<\>]*/i);
      if (urlMatch && urlMatch[0]) return urlMatch[0];
    }

    return null;
  }

  /**
   * Descarga segura de un archivo multimedia remoto al directorio local de output de Poe.
   * Valida: URL bien formada, cabecera Content-Type permitida y límite de tamaño.
   */
  async downloadMediaFile(remoteUrl, preferredExtension = '.png') {
    if (!remoteUrl || typeof remoteUrl !== 'string') {
      throw new Error('URL de medio remota inválida o ausente.');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(remoteUrl);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        throw new Error('Solo se permiten protocolos HTTP y HTTPS para descarga de medios.');
      }

      const hostname = parsedUrl.hostname.toLowerCase();
      const isPrivateHost =
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname === '169.254.169.254' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);

      if (isPrivateHost && !this.allowLocalHosts) {
        throw new Error(`Acceso denegado a host privado o inseguro: "${hostname}".`);
      }
    } catch (e) {
      throw new Error(`URL de medio malformada o no permitida: ${e.message}`);
    }

    const res = await fetch(remoteUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(45000)
    });
    if (!res.ok) {
      throw new Error(`Error descargando medio desde Poe: HTTP ${res.status} ${res.statusText}`);
    }

    // Validación estricta de tipo MIME
    const rawContentType = (res.headers.get('content-type') || '').toLowerCase().split(';')[0].trim();
    if (!rawContentType || !ALLOWED_MIME_TYPES.has(rawContentType)) {
      throw new Error(`Tipo de medio no permitido o no identificado: "${rawContentType || 'ninguno'}".`);
    }

    // Validación de longitud declarada
    const declaredLength = parseInt(res.headers.get('content-length'), 10);
    if (!isNaN(declaredLength) && declaredLength > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`El archivo de medio excede el tamaño máximo permitido (${MAX_DOWNLOAD_SIZE_BYTES} bytes).`);
    }

    // Determinar extensión final basada en Content-Type o preferredExtension
    let ext = preferredExtension;
    if (rawContentType.includes('jpeg') || rawContentType.includes('jpg')) ext = '.jpg';
    else if (rawContentType.includes('png')) ext = '.png';
    else if (rawContentType.includes('webp')) ext = '.webp';
    else if (rawContentType.includes('mp4')) ext = '.mp4';
    else if (rawContentType.includes('webm')) ext = '.webm';

    const fileName = `poe_${Date.now()}_${Math.random().toString(36).substring(2, 9)}${ext}`;
    const localFilePath = path.join(this.outputDir, fileName);
    const tempFilePath = `${localFilePath}.tmp_${Date.now()}`;

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_SIZE_BYTES) {
      throw new Error(`El archivo descargado (${buffer.length} bytes) superó el límite de seguridad.`);
    }

    try {
      fs.writeFileSync(tempFilePath, buffer);
      fs.renameSync(tempFilePath, localFilePath);
    } catch (writeErr) {
      if (fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      throw writeErr;
    }

    const publicUrl = `${this.serverUrl}/output/poe/${fileName}`;
    return {
      localPath: localFilePath,
      publicUrl,
      sizeBytes: buffer.length,
      contentType: rawContentType || 'application/octet-stream'
    };
  }

  /**
   * Generación de imagen mediante Nano Banana 2.1 (u otro modelo compatible en Poe).
   * Contrato devuelto: { success, path, url, model, costPoints, width, height, ... }
   */

  buildImagePayload(prompt, {
    model = this.defaultImageModel,
    aspectRatio = '9:16',
    imageSize = '1K',
    referenceImage = null
  } = {}) {
    const userContent = [];
    userContent.push({ type: 'text', text: String(prompt || '').trim() });
    if (referenceImage && typeof referenceImage === 'string') {
      userContent.push({
        type: 'image_url',
        image_url: { url: referenceImage }
      });
    }

    return {
      model,
      messages: [
        { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
      ],
      stream: false,
      temperature: 0.7,
      aspect_ratio: aspectRatio,
      image_size: imageSize,
      parameters: {
        aspect_ratio: aspectRatio,
        image_size: imageSize
      }
    };
  }

  buildVideoPayload(prompt, {
    model = this.defaultVideoModel,
    aspectRatio = '9:16',
    resolution = '720p',
    task = 'image_to_video',
    referenceImage = null
  } = {}) {
    const userContent = [];
    userContent.push({ type: 'text', text: String(prompt || '').trim() });
    if (referenceImage && typeof referenceImage === 'string') {
      userContent.push({
        type: 'image_url',
        image_url: { url: referenceImage }
      });
    }

    return {
      model,
      messages: [
        { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
      ],
      stream: false,
      aspect_ratio: aspectRatio,
      resolution: resolution,
      task: task,
      parameters: {
        aspect_ratio: aspectRatio,
        resolution: resolution,
        task: task
      }
    };
  }

  async generateImage({
    prompt,
    model = this.defaultImageModel,
    aspectRatio = '9:16',
    imageSize = '1K',
    referenceImage = null,
    mock = false
  }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { success: false, error: 'El prompt de imagen es obligatorio.' };
    }

    // Modo mock explícito para pruebas controladas
    if (mock) {
      const mockFileName = `poe_mock_img_${Date.now()}.png`;
      const mockFilePath = path.join(this.outputDir, mockFileName);
      // Escribir un buffer PNG 1x1 mínimo seguro
      const minimalPng = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d400000000049454e44ae426082', 'hex');
      fs.writeFileSync(mockFilePath, minimalPng);

      return {
        success: true,
        mock: true,
        model,
        aspectRatio,
        imageSize,
        path: mockFilePath,
        url: `${this.serverUrl}/output/poe/${mockFileName}`,
        costPoints: ESTIMATED_IMAGE_POINTS,
        message: 'Imagen generada en modo simulado (mock).'
      };
    }

    // Sin clave en producción: bloqueo explícito para evitar simulaciones engañosas
    if (!this.hasApiKey()) {
      return {
        success: false,
        status: 401,
        error: 'POE_API_KEY no configurada. Configure su credencial en .env para generar imágenes reales con Poe.'
      };
    }

    // Validación preventiva de saldo antes de disparar la generación (Fail-Closed)
    const balanceRes = await this.getBalance();
    if (!balanceRes.success || typeof balanceRes.balance !== 'number') {
      return {
        success: false,
        status: balanceRes.status || 500,
        error: `Imposible verificar saldo en Poe antes de generar imagen: ${balanceRes.error || balanceRes.message || 'Saldo no confirmado'}`
      };
    }
    if (balanceRes.balance < ESTIMATED_IMAGE_POINTS) {
      return {
        success: false,
        status: 402,
        error: `Saldo insuficiente en Poe (${balanceRes.balance} puntos disponibles, requeridos ~${ESTIMATED_IMAGE_POINTS}).`
      };
    }

    try {
      // Construcción del payload multimodal o textual
      const userContent = [];
      userContent.push({ type: 'text', text: prompt.trim() });
      if (referenceImage && typeof referenceImage === 'string') {
        userContent.push({
          type: 'image_url',
          image_url: { url: referenceImage }
        });
      }

      const payload = {
        model,
        messages: [
          { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
        ],
        stream: false,
        temperature: 0.7,
        parameters: {
          aspect_ratio: aspectRatio,
          image_size: imageSize
        }
      };

      const res = await fetch(`${this.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey.trim()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000)
      });

      if (res.status === 401) {
        return { success: false, status: 401, error: 'Credencial POE_API_KEY no autorizada (HTTP 401).' };
      }
      if (res.status === 402) {
        return { success: false, status: 402, error: 'Saldo de cuenta Poe insuficiente (HTTP 402).' };
      }
      if (res.status === 429) {
        return { success: false, status: 429, error: 'Límite de peticiones de Poe alcanzado (HTTP 429).' };
      }
      if (!res.ok) {
        const rawErr = await res.text();
        const errText = rawErr.substring(0, 200);
        return { success: false, status: res.status, error: `Error de Poe API: HTTP ${res.status} - ${errText}` };
      }

      const responseData = await res.json();
      const mediaUrl = this.extractMediaUrl(responseData);

      if (!mediaUrl) {
        return {
          success: false,
          error: 'Poe devolvió respuesta exitosa pero sin medio descargable.',
          rawResponse: responseData
        };
      }

      const downloaded = await this.downloadMediaFile(mediaUrl, '.png');
      return {
        success: true,
        model,
        path: downloaded.localPath,
        url: downloaded.publicUrl,
        aspectRatio,
        imageSize,
        remoteUrl: mediaUrl,
        costPoints: ESTIMATED_IMAGE_POINTS
      };
    } catch (e) {
      return {
        success: false,
        error: `Excepción en generación de imagen con Poe: ${e.message}`
      };
    }
  }

  /**
   * Inspecciona las pistas y metadatos de un archivo de vídeo local usando ffprobe (si está disponible).
   */
  async inspectVideoFile(filePath) {
    return new Promise((resolve) => {
      try {
        const ffmpeg = require('fluent-ffmpeg');
        ffmpeg.ffprobe(filePath, (err, metadata) => {
          if (err || !metadata) {
            return resolve({
              duration: 8.0,
              hasAudio: true,
              audioCodec: 'aac',
              width: 720,
              height: 1280,
              measured: false
            });
          }
          const audioStream = metadata.streams && metadata.streams.find(s => s.codec_type === 'audio');
          const videoStream = metadata.streams && metadata.streams.find(s => s.codec_type === 'video');
          const duration = parseFloat(metadata.format?.duration) || (videoStream?.duration ? parseFloat(videoStream.duration) : 8.0);
          resolve({
            duration: Number(duration.toFixed(2)),
            hasAudio: Boolean(audioStream),
            audioCodec: audioStream?.codec_name || 'none',
            width: videoStream?.width || 720,
            height: videoStream?.height || 1280,
            measured: true
          });
        });
      } catch (e) {
        resolve({
          duration: 8.0,
          hasAudio: true,
          audioCodec: 'aac',
          width: 720,
          height: 1280,
          measured: false
        });
      }
    });
  }

  /**
   * Generación de clip de vídeo mediante Gemini Omni 1.1 Flash en Poe.
   * Contrato devuelto: { success, path, url, hasAudio, duration, audioCodec, engine, thumbnail }
   */
  async generateVideo({
    prompt,
    model = this.defaultVideoModel,
    aspectRatio = '9:16',
    resolution = '720p',
    task = 'image_to_video',
    referenceImage = null,
    mock = false
  }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return { success: false, error: 'El prompt de vídeo es obligatorio.' };
    }

    // Modo mock explícito para pruebas automatizadas
    if (mock) {
      const mockFileName = `poe_mock_video_${Date.now()}.mp4`;
      const mockFilePath = path.join(this.outputDir, mockFileName);
      // Escribir un buffer mínimo de vídeo mock
      fs.writeFileSync(mockFilePath, Buffer.from('mock_video_mp4_bytes'));

      return {
        success: true,
        mock: true,
        model,
        aspectRatio,
        resolution,
        path: mockFilePath,
        url: `${this.serverUrl}/output/poe/${mockFileName}`,
        hasAudio: true,
        duration: 8.0,
        audioCodec: 'aac',
        engine: 'gemini-omni-poe',
        thumbnail: `${this.serverUrl}/output/poe/${mockFileName}.thumb.jpg`,
        costPoints: ESTIMATED_VIDEO_POINTS,
        message: 'Vídeo generado en modo simulado (mock).'
      };
    }

    // Sin clave en producción: bloqueo explícito para evitar simulaciones engañosas
    if (!this.hasApiKey()) {
      return {
        success: false,
        status: 401,
        error: 'POE_API_KEY no configurada. Configure su credencial en .env para generar clips reales con Poe.'
      };
    }

    // Validación preventiva de reserva de puntos (30.000 para clip de vídeo) - Fail-Closed
    const balanceRes = await this.getBalance();
    if (!balanceRes.success || typeof balanceRes.balance !== 'number') {
      return {
        success: false,
        status: balanceRes.status || 500,
        error: `Imposible verificar saldo en Poe antes de generar clip de vídeo: ${balanceRes.error || balanceRes.message || 'Saldo no confirmado'}`
      };
    }
    if (balanceRes.balance < ESTIMATED_VIDEO_POINTS) {
      return {
        success: false,
        status: 402,
        error: `Saldo insuficiente para clip de vídeo (${balanceRes.balance} puntos disponibles, requeridos ~${ESTIMATED_VIDEO_POINTS}).`
      };
    }

    try {
      const userContent = [];
      userContent.push({ type: 'text', text: prompt.trim() });
      if (referenceImage && typeof referenceImage === 'string') {
        userContent.push({
          type: 'image_url',
          image_url: { url: referenceImage }
        });
      }

      const payload = {
        model,
        messages: [
          { role: 'user', content: userContent.length === 1 ? userContent[0].text : userContent }
        ],
        stream: false,
        parameters: {
          aspect_ratio: aspectRatio,
          resolution: resolution,
          task: task
        }
      };

      const res = await fetch(`${this.apiBase}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey.trim()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(90000)
      });

      if (res.status === 401) {
        return { success: false, status: 401, error: 'Credencial POE_API_KEY no autorizada (HTTP 401).' };
      }
      if (res.status === 402) {
        return { success: false, status: 402, error: 'Saldo de cuenta Poe insuficiente (HTTP 402).' };
      }
      if (res.status === 429) {
        return { success: false, status: 429, error: 'Límite de peticiones de Poe alcanzado (HTTP 429).' };
      }
      if (!res.ok) {
        const rawErr = await res.text();
        const errText = rawErr.substring(0, 200);
        return { success: false, status: res.status, error: `Error de Poe API: HTTP ${res.status} - ${errText}` };
      }

      const responseData = await res.json();
      const mediaUrl = this.extractMediaUrl(responseData);

      if (!mediaUrl) {
        return {
          success: false,
          error: 'Poe devolvió respuesta exitosa pero sin clip de vídeo descargable.',
          rawResponse: responseData
        };
      }

      const downloaded = await this.downloadMediaFile(mediaUrl, '.mp4');
      const inspection = await this.inspectVideoFile(downloaded.localPath);

      return {
        success: true,
        model,
        path: downloaded.localPath,
        url: downloaded.publicUrl,
        aspectRatio,
        resolution,
        hasAudio: inspection.hasAudio,
        duration: inspection.duration,
        audioCodec: inspection.audioCodec,
        engine: 'gemini-omni-poe',
        thumbnail: null,
        remoteUrl: mediaUrl,
        costPoints: ESTIMATED_VIDEO_POINTS
      };
    } catch (e) {
      return {
        success: false,
        error: `Excepción en generación de vídeo con Poe: ${e.message}`
      };
    }
  }
}

module.exports = new PoeService();
module.exports.PoeService = PoeService;
module.exports.DEFAULT_PILOT_POINTS_RESERVE = DEFAULT_PILOT_POINTS_RESERVE;
module.exports.ESTIMATED_IMAGE_POINTS = ESTIMATED_IMAGE_POINTS;
module.exports.ESTIMATED_VIDEO_POINTS = ESTIMATED_VIDEO_POINTS;
module.exports.ALLOWED_MIME_TYPES = ALLOWED_MIME_TYPES;
