const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

// Cargar variables de entorno de forma robusta
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
  console.log(`\n\x1b[32m[Server] ✅ Archivo .env cargado correctamente.\x1b[0m`);
} else {
  console.warn(`\n\x1b[33m⚠️ [Server] Archivo .env no encontrado en: ${envPath}\x1b[0m`);
}

// Diagnóstico inmediato de URL pública
const publicUrl = (process.env.SERVER_URL || 'http://localhost:3001').trim();
console.log(`\x1b[32m[Server] 🌐 URL Pública detectada: ${publicUrl}\x1b[0m\n`);

const orchestrator = require('./core/AgentOrchestrator');
const knowledgeService = require('./services/knowledgeService');
const geminiService = require('./services/geminiService');
const postService = require('./services/postService');
const botStateService = require('./services/botStateService');
const scheduler = require('./automation/scheduler');
const publishingService = require('./services/publishingService');
const instagramPublisher = require('./automation/instagramPublisher');
const agroDataService = require('./services/agroDataService');
const agroImageService = require('./services/agroImageService');
const productContextService = require('./services/productContextService');

// === INICIALIZACIÓN DE DIRECTORIOS ===
const requiredDirs = [
  'data/assets',
  'data/temp_refs',
  'data/audio',
  'output',
  'output/agro'
];

requiredDirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    console.log(`[Init] Creando directorio: ${dir}`);
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
// Middleware para bypass de ngrok interstitial y Content-Type correcto en archivos de output
app.use('/output', cors(), (req, res, next) => {
  // Forzar Content-Type correcto basado en la extensión del archivo
  const ext = path.extname(req.path).toLowerCase();
  const mimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime'
  };
  if (mimeTypes[ext]) {
    res.setHeader('Content-Type', mimeTypes[ext]);
  }
  // Headers para bypass de ngrok interstitial
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  next();
}, express.static('output'));
app.use('/assets', cors(), express.static('data/assets')); 
app.use('/temp_refs', cors(), express.static('data/temp_refs')); 
app.use('/audio', cors(), express.static('data/audio')); 
// Servir imágenes de noticias desde el directorio local de FullAgro
if (process.env.NOTICE_IMAGES_DIR) {
  app.use('/notice_images', cors(), express.static(process.env.NOTICE_IMAGES_DIR));
}
app.use(express.static(path.join(__dirname, '../frontend')));

const projects = new Map();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'data/assets/'),
  filename: (req, file, cb) => cb(null, `context_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

const tempStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'data/temp_refs/'),
  filename: (req, file, cb) => cb(null, `ref_${Date.now()}${path.extname(file.originalname)}`)
});
const uploadTemp = multer({ storage: tempStorage });

const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const audioDir = path.join(__dirname, 'data/audio');
    if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
    cb(null, 'data/audio/');
  },
  filename: (req, file, cb) => cb(null, `audio_${Date.now()}${path.extname(file.originalname)}`)
});
const uploadAudio = multer({ 
  storage: audioStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

/**
 * Endpoints de Conocimiento (Knowledge Hub)
 */
app.get('/api/knowledge', (req, res) => {
  res.json(knowledgeService.getKnowledge());
});

app.post('/api/knowledge/upload', upload.array('files'), async (req, res) => {
  const assets = [];
  
  for (const file of req.files) {
    let description = file.originalname;
    const isImage = file.mimetype.startsWith('image/');
    
    if (isImage) {
      try {
        console.log(`[Vision] Analizando imagen: ${file.filename}...`);
        const prompt = "Describe esta imagen de forma técnica y corta (máximo 5 palabras) para usarla como nombre de archivo descriptivo. Ejemplo: 'Logo corporativo sobre blanco' o 'Captura dashboard analíticas'.";
        const visionAnalysis = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', path.join(__dirname, 'data/assets', file.filename));
        description = visionAnalysis.trim().replace(/[".]/g, '');
      } catch (e) {
        console.error("[Vision] Error analizando imagen:", e.message);
      }
    }

    const asset = {
      fileName: file.filename,
      description: description,
      type: isImage ? 'image' : 'file',
      mimetype: file.mimetype
    };
    
    knowledgeService.addAsset(asset);
    assets.push(asset);
  }
  
  res.json({ success: true, assets });
});

app.post('/api/knowledge/url', async (req, res) => {
  const { url } = req.body;
  try {
    const urlEntry = { 
      url, 
      title: url.replace('https://', '').replace('http://', '').split('/')[0],
      summary: "URL Guardada para investigación del enjambre.",
      keywords: ["web"]
    };
    knowledgeService.addUrl(urlEntry);
    res.json({ success: true, urlEntry });
  } catch (error) {
    res.status(500).json({ error: "No se pudo guardar la URL." });
  }
});

app.delete('/api/knowledge/:type/:id', (req, res) => {
  knowledgeService.deleteItem(req.params.type, parseInt(req.params.id));
  res.json({ success: true });
});

/**
 * Endpoints de Contexto de Producto
 */
app.get('/api/product-context', (req, res) => {
  res.json(productContextService.get());
});

app.post('/api/product-context', (req, res) => {
  const { context, metadata } = req.body;
  const result = productContextService.saveAll(context, metadata);
  console.log(`\x1b[32m[Server] 📝 Contexto de producto actualizado (${(context || '').length} chars).\x1b[0m`);
  res.json({ success: true, data: result });
});

app.put('/api/product-context/context', (req, res) => {
  const { context } = req.body;
  const result = productContextService.saveContext(context);
  res.json({ success: true, data: result });
});

app.put('/api/product-context/metadata', (req, res) => {
  const metadata = req.body;
  const result = productContextService.saveMetadata(metadata);
  res.json({ success: true, data: result });
});

/**
 * Endpoints de Referencias Temporales
 */
app.post('/api/temp-upload', uploadTemp.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo.' });
  res.json({ 
    success: true, 
    path: path.join('data/temp_refs', req.file.filename),
    url: `/temp_refs/${req.file.filename}`
  });
});

/**
 * IA: Refinamiento y Sugerencias
 */
app.post('/api/ai/refine-prompt', async (req, res) => {
  const { prompt } = req.body;
  const context = knowledgeService.getAllAsText();
  const productContextSection = productContextService.getAsPromptSection();
  
  const instruction = `
    Eres un Optimizador de Prompts para un enjambre de marketing.
    TU MISIÓN: Coger el borrador del usuario y convertirlo en un BRIEFING TÉCNICO PROFESIONAL.
    
    1. Hazlo detallado.
    2. Define el tono de voz basado en el contexto de marca.
    3. Añade directrices de composición visual (luces, encuadre, elementos).
    4. Asegúrate de mencionar activos de la Media Library si son relevantes.
    5. Si hay contexto de producto, el briefing DEBE estar alineado con ese producto.
    
    ${productContextSection ? productContextSection : ''}
    
    MARCA: ${context}
    BORRADOR: ${prompt}
    
    Respuesta: SOLO el briefing mejorado, sin introducciones.
  `;
  try {
    const refined = await geminiService.generateText(instruction, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 0.8 });
    res.json({ refined: refined.trim() });
  } catch (e) {
    res.status(500).json({ error: "No se pudo refinar." });
  }
});

app.post('/api/ai/suggest-idea', async (req, res) => {
  const { type, media, aspectRatio, engineMode } = req.body;
  const context = knowledgeService.getAllAsText();
  const productContextSection = productContextService.getAsPromptSection();
  
  const angles = [
    "Dramático y urgente (enfocado en el dolor del usuario)",
    "Educativo y técnico (enfocado en datos y eficiencia)",
    "Disruptivo y sarcástico (enfocado en la competencia o el status quo)",
    "Storytelling emocional (enfocado en el éxito de un cliente real)",
    "Contenido tipo 'How-to' rápido y viral",
    "Comparativa táctica (Antes vs Después)"
  ];
  const randomAngle = angles[Math.floor(Math.random() * angles.length)];
  const seed = Date.now();

  const prompt = `
    Eres un Director Creativo experto encargado de generar una idea ÚNICA para redes sociales.
    
    SEMILLA DE CREATIVIDAD: ${seed}
    ÁNGULO OBLIGATORIO: ${randomAngle}
    
    CONFIGURACIÓN ACTUAL SELECCIONADA POR EL USUARIO:
    - Formato de Publicación: ${type.toUpperCase()} (single = Post/Imagen única, video = Reel/TikTok, carousel = Carrusel, flyer = Cartel Promocional)
    - Medio Visual Principal: ${media.toUpperCase()} (image = Imágenes estáticas, video = Clips de vídeo)
    - Aspect Ratio (Proporción): ${aspectRatio}
    - Motor de Vídeo: ${engineMode} (remotion = composición programática, direct = vídeo IA 100% puro)
    
    CONOCIMIENTO DE MARCA:
    ${context}
    
    ${productContextSection ? productContextSection : ''}
    
    ⚠️ RESTRICCIÓN TÉCNICA CRÍTICA DE VÍDEO ⚠️
    El generador de vídeo por IA (Google Veo) produce EXACTAMENTE 8 SEGUNDOS por clip.
    NO se puede generar un vídeo más largo ni más corto. Son siempre 8 segundos fijos.
    
    TU MISIÓN: 
    Genera un BRIEFING TÉCNICO que el equipo de IA pueda ejecutar. 
    REGLAS ESTRICTAS SEGÚN EL FORMATO Y MEDIO:

    1. Si es SINGLE (POST) + Medio IMAGE: Propón una única imagen potente con un copy persuasivo.
    2. Si es SINGLE (POST) + Medio VIDEO: Propón UNA ÚNICA ESCENA de vídeo de 8 segundos.
       - Describe UN SOLO plano/escena cinematográfico concreto y detallado.
       - NO propongas múltiples escenas ni guiones. Solo 1 escena = 1 vídeo de 8 seg.
       - El briefing debe ser una descripción visual directa y concisa de lo que se ve en esos 8 segundos.
    3. Si es CAROUSEL + Medio IMAGE: Propón una secuencia lógica de 3 a 5 diapositivas estáticas.
    4. Si es CAROUSEL + Medio VIDEO: Propón de 3 a 5 escenas de vídeo (cada una de 8 seg).
       - Cada escena debe ser un plano independiente y autosuficiente de 8 seg.
    5. Si es VIDEO (REEL) + REMOTION + Medio IMAGE: Propón un Reel compuesto por imágenes animadas con Ken Burns y voz en off.
    6. Si es VIDEO (REEL) + REMOTION + Medio VIDEO: Propón un Reel con 3 a 6 clips de 8 seg cada uno que se montarán juntos.
       - Cada clip debe describir UNA escena visual concreta.
    7. Si es VIDEO (REEL) + DIRECT + Medio VIDEO: Propón UNA ÚNICA ESCENA de vídeo de 8 segundos (el modo directo genera un solo clip).
    8. Si es FLYER: Propón una composición estática promocional directa y orientada a venta.

    IMPORTANTE: Asegúrate de que tu idea respete absolutamente el formato, la proporción y el medio elegido.
    IMPORTANTE: Si el medio es VIDEO, NUNCA propongas escenas que duren más o menos de 8 segundos.
    IMPORTANTE: Si es un SINGLE + VIDEO, el briefing debe ser una descripción de UNA SOLA ESCENA.
    
    Devuelve un JSON corto:
    {
      "briefing": "BRIEFING DETALLADO: [Tu propuesta aquí]",
      "concept": "Concepto rápido"
    }
  `;
  try {
    const suggestion = await geminiService.generateText(prompt, process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash', null, { temperature: 1.0 });
    res.json(JSON.parse(suggestion.replace(/```json|```/g, '').trim()));
  } catch (e) {
    res.status(500).json({ error: "No se pudo generar la idea." });
  }
});

/**
 * Endpoints de Historial (NoSQL Store)
 */
app.get('/api/posts', (req, res) => {
  res.json(postService.getAll());
});

app.delete('/api/posts/:id', (req, res) => {
  postService.delete(req.params.id);
  res.json({ success: true });
});

app.get('/api/status/:id', (req, res) => res.json(projects.get(req.params.id) || {}));

/**
 * SSE: Streaming de progreso en tiempo real
 */
app.get('/api/status/:id/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const onProgress = (progress) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  };

  // Escuchar eventos de progreso del orquestador
  orchestrator.progressEmitter.on(req.params.id, onProgress);

  // Cerrar cuando el cliente se desconecte
  req.on('close', () => {
    orchestrator.progressEmitter.removeListener(req.params.id, onProgress);
  });

  // Timeout: cerrar después de 15 min
  setTimeout(() => {
    orchestrator.progressEmitter.removeListener(req.params.id, onProgress);
    res.end();
  }, 900000);
});

/**
 * Creación Manual de Contenido
 */
app.post('/api/create', async (req, res) => {
  const { briefing, contentType, mediaType, aspectRatio, externalReferences, refMode, engineMode, imageModel } = req.body;
  console.log(`\n\x1b[33m[API] Recibida orden de despliegue: ${contentType} (${aspectRatio}) [Media: ${mediaType || 'image'}] [Engine: ${engineMode || 'default'}] [ImageModel: ${imageModel || 'google'}]\x1b[0m`);
  if (externalReferences && externalReferences.length > 0) {
    console.log(`[API] Se adjuntaron ${externalReferences.length} referencias externas [Modo: ${refMode || 'reference'}].`);
  }
  
  const brandContext = knowledgeService.getAllAsText(); 

  const projectId = uuidv4();
  projects.set(projectId, { id: projectId, status: 'processing', data: null });

  // Timeout de workflow: 10 minutos máximo
  const WORKFLOW_TIMEOUT_MS = 600000;
  const timeoutHandle = setTimeout(() => {
    const project = projects.get(projectId);
    if (project && project.status === 'processing') {
      console.error(`[API] ⏰ Workflow ${projectId} excedió el timeout de 10 min.`);
      projects.set(projectId, { id: projectId, status: 'timeout', error: 'El workflow excedió el tiempo máximo de 10 minutos.' });
    }
  }, WORKFLOW_TIMEOUT_MS);

  orchestrator.runFullWorkflow(briefing, brandContext, contentType, mediaType, aspectRatio, externalReferences, refMode, engineMode, imageModel, projectId)
    .then(result => {
      clearTimeout(timeoutHandle);
      const savedPost = postService.save({
        briefing,
        contentType,
        aspectRatio,
        content: result.content,
        visuals: result.visuals,
        video: result.video
      });
      
      projects.set(projectId, { id: projectId, status: 'completed', data: { ...result, contentType, _savedId: savedPost.id }, savedId: savedPost.id });
    })
    .catch(err => {
      clearTimeout(timeoutHandle);
      console.error("Workflow Error:", err);
      projects.set(projectId, { id: projectId, status: 'failed', error: err.message });
    });

  res.json({ projectId });
});

/**
 * Creación de Audio Reel
 */
app.post('/api/create-audio-reel', uploadAudio.single('audioFile'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo de audio.' });
  
  const { aspectRatio, imageModel } = req.body;
  const audioPath = path.resolve(__dirname, req.file.path);
  
  console.log(`\n\x1b[33m[API] Recibida orden AUDIO REEL (${aspectRatio || '9:16'}) [Audio: ${req.file.originalname}] [ImageModel: ${imageModel || 'google'}]\x1b[0m`);

  const projectId = uuidv4();
  projects.set(projectId, { id: projectId, status: 'processing', data: null });

  orchestrator.runAudioReelWorkflow(audioPath, aspectRatio || '9:16', imageModel || 'google')
    .then(result => {
      const savedPost = postService.save({
        briefing: '[Audio Reel] ' + req.file.originalname,
        contentType: 'audio-reel',
        aspectRatio: aspectRatio || '9:16',
        content: result.content,
        visuals: result.visuals,
        video: result.video
      });
      
      projects.set(projectId, { id: projectId, status: 'completed', data: { ...result, contentType: 'audio-reel', _savedId: savedPost.id }, savedId: savedPost.id });
    })
    .catch(err => {
      console.error("Audio Reel Workflow Error:", err);
      projects.set(projectId, { id: projectId, status: 'failed', error: err.message });
    });

  res.json({ projectId });
});

/**
 * Publicación manual desde el Frontend
 */
app.post('/api/publish/:id', async (req, res) => {
  const post = postService.getAll().find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post no encontrado.' });

  const caption = post.content?.instagram?.copy
    ? `${post.content.instagram.copy}\n\n${post.content.instagram.hashtags || ''}`
    : `${post.content?.facebook?.copy || ''}\n\n${post.content?.facebook?.hashtags || ''}`;

  const contentType = post.contentType || 'post';
  const hasVideo = post.video && post.video.url;

  try {
    let result;
    if (contentType === 'price-story' && post.visuals && post.visuals.length >= 1) {
      result = await publishingService.publishViaBridge(post.visuals[0], 'story', 'IMAGE');

    } else if (hasVideo && (contentType === 'video' || contentType === 'audio-reel' || contentType === 'reel')) {
      result = await publishingService.publishViaBridge(post.video.url, 'reel', caption);

    } else if (contentType === 'carousel' && post.visuals && post.visuals.length > 1) {
      result = await publishingService.publishViaBridge(post.visuals, 'carousel', caption);

    } else if (post.visuals && post.visuals.length >= 1) {
      result = await publishingService.publishViaBridge(post.visuals[0], 'image', caption);

    } else {
      return res.status(400).json({ error: 'No hay contenido visual para publicar.' });
    }
    
    console.log(`\x1b[32m[API] Publicación manual ejecutada: ${result.success ? 'OK' : 'SIMULADA'}\x1b[0m`);
    res.json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

/**
 * ============================================
 * ENDPOINTS DE AGRO (FullAgro Integration)
 * ============================================
 */

app.get('/api/agro/prices', async (req, res) => {
  try {
    const prices = await agroDataService.getLatestPrices();
    res.json({ success: true, prices, date: prices.length > 0 ? prices[0].Fecha : null });
  } catch (e) {
    console.error('[API] Error obteniendo precios:', e.message);
    res.status(500).json({ error: 'Error conectando a la base de datos: ' + e.message });
  }
});

app.get('/api/agro/news', async (req, res) => {
  try {
    const noticias = await agroDataService.getLatestNews();
    if (noticias.length === 0) {
      return res.json({ success: true, news: null, message: 'No hay noticias del día.' });
    }
    const selected = await agroDataService.selectMostImportantNews(noticias);
    const newsUrl = agroDataService.getNewsUrl(selected);
    const imageUrl = agroDataService.getNewsImageUrl(selected);
    res.json({ success: true, news: selected, newsUrl, imageUrl });
  } catch (e) {
    console.error('[API] Error obteniendo noticias:', e.message);
    res.status(500).json({ error: 'Error conectando a la base de datos: ' + e.message });
  }
});

app.post('/api/agro/generate-price-story', async (req, res) => {
  try {
    console.log('\x1b[33m[API] Generando historia de precios del día...\x1b[0m');

    const prices = await agroDataService.getLatestPrices();
    if (prices.length === 0) {
      return res.status(404).json({ error: 'No hay precios disponibles en la base de datos.' });
    }

    const imageResult = await agroImageService.generatePriceCardImage(prices);
    if (!imageResult) {
      return res.status(500).json({ error: 'No se pudo generar la imagen de precios.' });
    }

    const fecha = new Date(prices[0].Fecha).toLocaleDateString('es-ES', {
      day: 'numeric', month: 'long', year: 'numeric'
    });

    const priceList = prices.map(p =>
      `${p.NombreProductoCompleto}: ${parseFloat(p.Precio).toFixed(2)} €/kg`
    ).join('\n');

    const pMeta = productContextService.getMetadata();
    const websiteLine = pMeta.website ? `\n\nMás información en ${pMeta.website}` : '';
    const priceHashtags = pMeta.defaultHashtags || '#preciosmedios #mercado';

    const savedPost = postService.save({
      briefing: `Precios medios del día ${fecha}`,
      contentType: 'price-story',
      aspectRatio: '9:16',
      content: {
        text: `Precios medios del día ${fecha}\n\n${priceList}`,
        facebook: {
          copy: `Precios medios del día ${fecha}\n\n${priceList}${websiteLine}`,
          hashtags: priceHashtags
        },
        instagram: {
          copy: `Precios medios del día ${fecha}\n\n${priceList}`,
          hashtags: priceHashtags
        }
      },
      visuals: [imageResult.url],
      video: null,
      agroData: { type: 'price-story', prices, date: prices[0].Fecha }
    });

    console.log(`\x1b[32m[API] Historia de precios generada. Post ID: ${savedPost.id}\x1b[0m`);
    res.json({ success: true, postId: savedPost.id, image: imageResult.url, prices });
  } catch (e) {
    console.error('[API] Error generando historia de precios:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agro/generate-news-post', async (req, res) => {
  try {
    console.log('\x1b[33m[API] Generando post de noticia del día...\x1b[0m');

    const noticias = await agroDataService.getLatestNews();
    if (noticias.length === 0) {
      return res.status(404).json({ error: 'No hay noticias disponibles en la base de datos.' });
    }

    const newsItem = await agroDataService.selectMostImportantNews(noticias);
    const newsUrl = agroDataService.getNewsUrl(newsItem);

    const imageResult = await agroImageService.generateNewsPostImage(newsItem);
    if (!imageResult) {
      return res.status(500).json({ error: 'No se pudo generar la imagen de la noticia.' });
    }

    const copy = await agroImageService.generateNewsCopy(newsItem, newsUrl);

    const savedPost = postService.save({
      briefing: `Noticia: ${newsItem.Titulo}`,
      contentType: 'news-post',
      aspectRatio: '1:1',
      content: copy,
      visuals: [imageResult.url],
      video: null,
      agroData: {
        type: 'news-post',
        newsId: newsItem.Id,
        newsTitle: newsItem.Titulo,
        newsUrl,
        newsImageOriginal: agroDataService.getNewsImageUrl(newsItem)
      }
    });

    console.log(`\x1b[32m[API] Post de noticia generado. Post ID: ${savedPost.id}\x1b[0m`);
    res.json({ success: true, postId: savedPost.id, image: imageResult.url, news: newsItem, newsUrl, copy });
  } catch (e) {
    console.error('[API] Error generando post de noticia:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/agro/auto-daily', async (req, res) => {
  try {
    console.log('\x1b[35m[API] Ejecutando contenido agro diario automático...\x1b[0m');
    const results = { priceStory: null, newsPost: null };
    const autoMeta = productContextService.getMetadata();
    const autoWebsiteLine = autoMeta.website ? `\n\nMás información en ${autoMeta.website}` : '';
    const autoHashtags = autoMeta.defaultHashtags || '#preciosmedios #mercado';

    // 1. Generar historia de precios
    try {
      const prices = await agroDataService.getLatestPrices();
      if (prices.length > 0) {
        const imageResult = await agroImageService.generatePriceCardImage(prices);
        if (imageResult) {
          const fecha = new Date(prices[0].Fecha).toLocaleDateString('es-ES', {
            day: 'numeric', month: 'long', year: 'numeric'
          });
          const priceList = prices.map(p =>
            `${p.NombreProductoCompleto}: ${parseFloat(p.Precio).toFixed(2)} €/kg`
          ).join('\n');

          const savedPost = postService.save({
            briefing: `[Auto] Precios medios del día ${fecha}`,
            contentType: 'price-story',
            aspectRatio: '9:16',
            content: {
              text: `Precios medios del día ${fecha}\n\n${priceList}`,
              facebook: {
                copy: `Precios medios del día ${fecha}\n\n${priceList}${autoWebsiteLine}`,
                hashtags: autoHashtags
              },
              instagram: {
                copy: `Precios medios del día ${fecha}\n\n${priceList}`,
                hashtags: autoHashtags
              }
            },
            visuals: [imageResult.url],
            video: null,
            autoGenerated: true,
            agroData: { type: 'price-story', prices, date: prices[0].Fecha }
          });
          results.priceStory = { postId: savedPost.id, image: imageResult.url };
        }
      }
    } catch (e) {
      console.error('[API] Error en precio diario automático:', e.message);
    }

    // 2. Generar post de noticia
    try {
      const noticias = await agroDataService.getLatestNews();
      if (noticias.length > 0) {
        const newsItem = await agroDataService.selectMostImportantNews(noticias);
        const newsUrl = agroDataService.getNewsUrl(newsItem);
        const imageResult = await agroImageService.generateNewsPostImage(newsItem);
        if (imageResult) {
          const copy = await agroImageService.generateNewsCopy(newsItem, newsUrl);
          const savedPost = postService.save({
            briefing: `[Auto] Noticia: ${newsItem.Titulo}`,
            contentType: 'news-post',
            aspectRatio: '1:1',
            content: copy,
            visuals: [imageResult.url],
            video: null,
            autoGenerated: true,
            agroData: {
              type: 'news-post',
              newsId: newsItem.Id,
              newsTitle: newsItem.Titulo,
              newsUrl,
              newsImageOriginal: agroDataService.getNewsImageUrl(newsItem)
            }
          });
          results.newsPost = { postId: savedPost.id, image: imageResult.url, newsUrl };
        }
      }
    } catch (e) {
      console.error('[API] Error en noticia diaria automática:', e.message);
    }

    console.log(`\x1b[32m[API] Contenido agro diario completado: PriceStory=${results.priceStory ? 'OK' : 'FAIL'}, NewsPost=${results.newsPost ? 'OK' : 'FAIL'}\x1b[0m`);
    res.json({ success: true, results });
  } catch (e) {
    console.error('[API] Error en auto-daily agro:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/**
 * ============================================
 * ENDPOINTS DEL AUTO-PILOT
 * ============================================
 */

app.get('/api/bot/state', (req, res) => {
  res.json(botStateService.getState());
});

app.post('/api/bot/toggle', (req, res) => {
  const state = botStateService.toggleAutoPilot();
  console.log(`\x1b[35m[API] Auto-Pilot ${state.isAutoPilotActive ? '🟢 ACTIVADO' : '🔴 DESACTIVADO'}\x1b[0m`);
  res.json(state);
});

app.post('/api/bot/email', (req, res) => {
  const { email } = req.body;
  botStateService.setAdminEmail(email);
  res.json({ success: true });
});

app.post('/api/bot/formats', (req, res) => {
  const { formats } = req.body;
  if (!Array.isArray(formats)) {
    return res.status(400).json({ error: 'formats debe ser un array' });
  }
  botStateService.setAllowedFormats(formats);
  res.json({ success: true, allowedFormats: formats });
});

app.get('/api/bot/schedule', (req, res) => {
  res.json(botStateService.getSchedule());
});

app.post('/api/bot/force-plan', async (req, res) => {
  try {
    await scheduler.forceMonthlyPlanning();
    res.json({ success: true, schedule: botStateService.getSchedule() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/bot/schedule/:day/:index?', (req, res) => {
  const day = parseInt(req.params.day);
  const index = req.params.index !== undefined ? parseInt(req.params.index) : 0;
  const updates = req.body;
  const schedule = botStateService.getSchedule();
  const dayEntries = schedule.filter(e => e.day === day);

  if (dayEntries.length === 0) {
    const newEntry = { day, status: 'planned', postId: null, ...updates };
    botStateService.addScheduleEntry(newEntry);
    return res.json({ success: true, entry: newEntry });
  }

  botStateService.updateScheduleEntry(day, index, updates);
  res.json({ success: true, entry: { ...dayEntries[index], ...updates } });
});

app.delete('/api/bot/schedule/:day/:index?', (req, res) => {
  const day = parseInt(req.params.day);
  const index = req.params.index !== undefined ? parseInt(req.params.index) : null;
  
  if (index !== null) {
    botStateService.removeScheduleEntryByIndex(day, index);
  } else {
    botStateService.removeScheduleEntry(day);
  }
  res.json({ success: true });
});

app.post('/api/bot/execute/:day/:index?', async (req, res) => {
  const day = parseInt(req.params.day);
  const index = req.params.index !== undefined ? parseInt(req.params.index) : 0;
  const schedule = botStateService.getSchedule();
  const dayEntries = schedule.filter(e => e.day === day);
  const entry = dayEntries[index];

  if (!entry) return res.status(404).json({ error: 'No hay entrada para ese día/índice' });
  if (entry.status !== 'planned') return res.status(400).json({ error: `El estado actual es '${entry.status}', debe ser 'planned'` });

  res.json({ success: true, message: `Generando contenido para el día ${day} (${entry.format})...` });

  // Delegar al scheduler que ya tiene la lógica de enrutamiento por tipo
  if (entry.format === 'price-story' || entry.format === 'news-post') {
    scheduler.executeAgroContent(day, entry).catch(e =>
      console.error(`[Manual] Error contenido agro día ${day}:`, e.message)
    );
  } else {
    scheduler.executeCreativeContent(day, entry).catch(e =>
      console.error(`[Manual] Error contenido creativo día ${day}:`, e.message)
    );
  }
});

app.get('/api/webhooks/approve/:postId', async (req, res) => {
  const { postId } = req.params;
  console.log(`\x1b[32m[Webhook] ✅ Post ${postId} APROBADO por el administrador.\x1b[0m`);

  const post = postService.getAll().find(p => p.id === postId);
  if (!post) return res.send(renderWebhookPage('error', 'Post no encontrado.'));

  // Actualizar estado en el calendario
  const schedule = botStateService.getSchedule();
  const entry = schedule.find(e => e.postId === postId);
  if (entry) {
    botStateService.updateScheduleDay(entry.day, { status: 'approved' });
  }
  botStateService.removePendingApproval(postId);

  // Publicar en Instagram
  const caption = post.content?.instagram?.copy 
    ? `${post.content.instagram.copy}\n\n${post.content.instagram.hashtags || ''}`
    : post.content?.facebook?.copy || '';

  try {
    if (post.visuals && post.visuals.length > 0) {
      // Price-story siempre se publica como historia temporal (story)
      if (post.contentType === 'price-story') {
        await publishingService.publishViaBridge(post.visuals[0], 'story', 'IMAGE');
      } else if (post.visuals.length > 1) {
        await publishingService.publishViaBridge(post.visuals, 'carousel', caption);
      } else {
        await publishingService.publishViaBridge(post.visuals[0], 'image', caption);
      }
      if (entry) botStateService.updateScheduleDay(entry.day, { status: 'published' });
    }
  } catch (e) {
    console.error('[Webhook] Error publicando:', e.message);
  }

  res.send(renderWebhookPage('approved', '¡Contenido aprobado y enviado a publicación!'));
});

app.get('/api/webhooks/reject/:postId', async (req, res) => {
  const { postId } = req.params;
  console.log(`\x1b[31m[Webhook] ❌ Post ${postId} RECHAZADO. Regenerando...\x1b[0m`);

  const post = postService.getAll().find(p => p.id === postId);
  if (!post) return res.send(renderWebhookPage('error', 'Post no encontrado.'));

  const schedule = botStateService.getSchedule();
  const entry = schedule.find(e => e.postId === postId);
  if (entry) {
    botStateService.updateScheduleDay(entry.day, { status: 'planned', postId: null });
  }
  botStateService.removePendingApproval(postId);

  res.send(renderWebhookPage('rejected', 'Contenido rechazado. El enjambre regenerará una nueva versión.'));
});

/**
 * Renderiza una pequeña página de confirmación tras el clic en el email.
 */
function renderWebhookPage(type, message) {
  const colors = { approved: '#00c853', rejected: '#ff1744', error: '#ff9100' };
  const icons = { approved: '✅', rejected: '🔄', error: '⚠️' };
  return `
    <!DOCTYPE html><html><head><meta charset="utf-8">
    <style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0f;font-family:'Segoe UI',sans-serif;color:#fff;}
    .card{text-align:center;padding:60px;border-radius:20px;background:#12121f;border:1px solid ${colors[type]};box-shadow:0 0 40px ${colors[type]}33;}
    h1{font-size:60px;margin:0;}p{font-size:18px;color:#aaa;margin-top:15px;}</style>
    </head><body><div class="card"><h1>${icons[type]}</h1><p>${message}</p></div></body></html>
  `;
}

/**
 * Arranque del servidor
 */
app.listen(PORT, () => {
  const publicUrl = (process.env.SERVER_URL || 'http://localhost:3001').trim();
  console.log(`\n\x1b[32m[Server] ✅ Corriendo en http://localhost:${PORT}\x1b[0m`);
  console.log(`\x1b[32m[Server] 🌐 URL Pública detectada: ${publicUrl}\x1b[0m`);
  console.log(`\x1b[32m[Server] 🔍 Grounding activo.\x1b[0m\n`);
  scheduler.start();
});
