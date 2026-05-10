# Audio Reel — Diseño del Sistema

Sistema que permite al usuario subir un audio de narración/voiceover y la IA genera automáticamente imágenes sincronizadas por escena, montándolas con Remotion junto con subtítulos animados.

## Decisiones de Diseño

- **Tipo de audio**: Narración/voiceover (una persona hablando sobre un tema)
- **Output visual**: Imágenes de fondo + audio + subtítulos sincronizados (estilo captions de Reel)
- **Segmentación**: Por cambio de tema/escena (la IA detecta cuándo el narrador pasa a otro tema)
- **Integración UI**: Nuevo tipo de contenido `audio-reel` (junto a single, video, carousel, flyer)
- **Duración máxima**: 2-3 minutos
- **Enfoque técnico**: Todo Gemini (transcripción multimodal + generación de imágenes)
- **Modelos**: `gemini-3-flash-preview` (texto/análisis), `gemini-3.1-flash-image-preview` (imágenes)

## Flujo de Datos

```
Usuario sube audio (.mp3/.wav/.m4a, máx 3 min)
        │
        ▼
┌───────────────────────────────────┐
│  gemini-3-flash-preview           │
│  (Multimodal - Audio directo)     │
│  → Transcripción + Timestamps     │
│  → Segmentación por escenas       │
│  → Prompt visual por escena (EN)  │
│  → Subtítulos con tiempos         │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│  Photo-Prompt-Optimizer (x N)     │
│  Optimiza cada imagePrompt        │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│  gemini-3.1-flash-image-preview   │
│  (Nano Banana 2) x N escenas      │
└──────────────┬────────────────────┘
               ▼
┌───────────────────────────────────┐
│  Remotion - AudioReel             │
│  Audio + Imágenes + Subtítulos    │
└──────────────┬────────────────────┘
               ▼
         Video MP4 final
```

## Componentes Técnicos

### 1. `geminiService.js` — Nuevo método `transcribeAndSegmentAudio()`

**Responsabilidad**: Recibe el path de un archivo de audio, lo envía a `gemini-3-flash-preview` como contenido multimodal (audio en base64), y devuelve un JSON estructurado con escenas.

**Input**: `audioFilePath` (string) — ruta absoluta al archivo de audio

**Prompt al modelo**: Le pedimos que:
1. Transcriba el audio completo
2. Identifique cambios de tema/escena en la narración
3. Para cada escena, genere un prompt visual en inglés optimizado para generación de imagen fotorrealista
4. Segmente los subtítulos en grupos de 3-5 palabras con timestamps

**Output** (JSON):
```json
{
  "totalDuration": 45.2,
  "scenes": [
    {
      "startTime": 0.0,
      "endTime": 12.5,
      "transcript": "Los tomates necesitan al menos 6 horas de sol directo al día para crecer sanos",
      "imagePrompt": "Tomato plants in a sunny field with bright golden sunlight, close-up of ripe red tomatoes on the vine, warm natural lighting",
      "subtitles": [
        {"text": "Los tomates necesitan", "start": 0.0, "end": 2.1},
        {"text": "al menos 6 horas", "start": 2.1, "end": 3.8},
        {"text": "de sol directo al día", "start": 3.8, "end": 5.3},
        {"text": "para crecer sanos", "start": 5.3, "end": 7.8}
      ]
    }
  ]
}
```

**Implementación**: Usa el SDK `@google/genai` existente. Lee el audio con `fs.readFileSync()`, lo convierte a base64, y lo envía como `inlineData` con el mimeType correcto (`audio/mpeg`, `audio/wav`, etc.). El mimeType se detecta por la extensión del archivo.

### 2. `AgentOrchestrator.js` — Nuevo método `runAudioReelWorkflow()`

**Responsabilidad**: Orquesta el flujo completo de audio-reel.

**Input**: `audioPath` (string), `aspectRatio` (string), `imageModel` (string, default 'google')

**Flujo**:
1. Llama a `geminiService.transcribeAndSegmentAudio(audioPath)` → obtiene JSON de escenas
2. Para cada escena (`scenes`):
   a. Pasa `scene.imagePrompt` por `this.agents.photoOptimizer.execute()` (reutiliza `_optimizeScenePrompt` existente)
   b. Genera imagen con `this.executeVisualWithReview()` usando el prompt optimizado
   c. Almacena la URL de la imagen generada en la escena
3. Construye el array de escenas con: `{url, startTime, endTime, subtitles}`
4. Llama a `videoService.renderAudioReel(scenesConImagenes, audioPath, aspectRatio)`
5. Devuelve `projectState` con `{content: transcripción, visuals: [urls], video: {url}}`

**Logging**: Usa el mismo patrón de consola que el workflow actual (`[Swarm]`, `[Remotion]`, etc.)

### 3. `videoService.js` — Nuevo método `renderAudioReel()`

**Responsabilidad**: Invoca el render de Remotion con la composición AudioReel.

**Input**:
- `scenes`: Array de `{url, startFrame, durationFrames, subtitles: [{text, startFrame, endFrame}]}`
- `audioUrl`: URL pública del audio (servido desde `http://localhost:3001/audio/...`)
- `audioDurationSec`: Duración total del audio en segundos

**Proceso**:
1. Convierte los timestamps de segundos a frames (`timestamp * 30` a 30fps)
2. Escribe el JSON de props en un archivo temporal (como ya hace `renderSwarmReel`)
3. Ejecuta `npx remotion render src/index.ts AudioReel "<outputPath>" --props="<propsPath>"`
4. Limpia el archivo de props temporal

**Output**: `{url: "/output/audio_reel_<timestamp>.mp4"}`

### 4. `video-engine/src/AudioReel.tsx` — Nueva composición Remotion

**Props**:
```typescript
type AudioReelProps = {
  scenes: Array<{
    url: string;           // URL de la imagen
    startFrame: number;
    durationFrames: number;
    subtitles: Array<{
      text: string;
      startFrame: number;
      endFrame: number;
    }>;
  }>;
  audioUrl: string;
};
```

**Estructura visual**:
- `<Audio src={audioUrl} />` — suena durante todo el vídeo
- Por cada escena: `<Sequence from={startFrame} durationInFrames={durationFrames}>`
  - Imagen de fondo con efecto Ken Burns (reutiliza `SceneBackground` del SwarmReel)
  - Gradiente oscuro en la parte inferior para legibilidad de subtítulos
  - Subtítulos animados: aparecen con fade-in + scale suave, posición centrada en el tercio inferior
- Transiciones `fade` entre escenas usando `TransitionSeries`

**Estilo de subtítulos**:
- Fondo: `rgba(0,0,0,0.6)` con border-radius
- Texto: blanco, fuente sans-serif bold, ~48px
- Animación: fade-in + leve scale de 0.95 a 1.0 al entrar, fade-out al salir

### 5. `video-engine/src/Root.tsx` — Registro

Se añade una nueva `<Composition>` con:
- `id="AudioReel"`
- `component={AudioReel}`
- `fps={30}`
- `width={1080}`, `height={1920}` (9:16 por defecto, ajustable via `calculateMetadata`)
- `calculateMetadata` que calcula `durationInFrames` basándose en la duración total del audio

### 6. `server.js` — Ruta y Upload de Audio

**Nuevo middleware multer para audio**:
- Destino: `data/audio/`
- Filename: `audio_<timestamp>.<ext>`
- Formatos aceptados: `.mp3`, `.wav`, `.m4a`, `.ogg`

**Nuevo endpoint o modificación de `/api/create`**:
- Cuando `contentType === 'audio-reel'`, usa el multer de audio para recibir el archivo
- Valida que el archivo existe y que es un formato de audio válido
- Enruta a `orchestrator.runAudioReelWorkflow(audioPath, aspectRatio, imageModel)`
- Sirve archivos de audio estáticamente: `app.use('/audio', express.static('data/audio'))`

### 7. `frontend/js/app.js` — UI

**Nuevo tipo de contenido `audio-reel`**:
- Se añade un botón/opción en el selector de tipo de contenido
- Al seleccionar `audio-reel`:
  - Se **oculta**: campo de briefing de texto, selector de media type, selector de engine mode
  - Se **muestra**: zona de subida de audio (drag & drop o click para seleccionar)
  - Se **mantiene**: selector de aspect ratio, selector de modelo de imagen
- Validación: no permite hacer deploy sin un archivo de audio subido
- El deploy envía el audio como `FormData` (campo `audioFile`) junto con `contentType`, `aspectRatio`, `imageModel`

## Archivos Afectados

| Archivo | Acción | Cambios |
|---|---|---|
| `backend/services/geminiService.js` | MODIFICAR | `+transcribeAndSegmentAudio()` |
| `backend/core/AgentOrchestrator.js` | MODIFICAR | `+runAudioReelWorkflow()` |
| `backend/server.js` | MODIFICAR | Multer audio + ruta audio-reel + static `/audio` |
| `backend/services/videoService.js` | MODIFICAR | `+renderAudioReel()` |
| `video-engine/src/AudioReel.tsx` | NUEVO | Composición Remotion completa |
| `video-engine/src/Root.tsx` | MODIFICAR | Registrar AudioReel |
| `frontend/js/app.js` | MODIFICAR | UI audio-reel + upload + deploy |

## Verificación

### Pruebas manuales
1. Subir un audio de ~30 segundos de narración → verificar que se genera el JSON de escenas correcto
2. Verificar que se generan N imágenes (una por escena)
3. Verificar que el vídeo final tiene audio + imágenes sincronizadas + subtítulos
4. Verificar que los subtítulos aparecen en el momento correcto del audio
5. Probar con distintos aspect ratios (9:16, 1:1, 16:9)

### Validación técnica
- Comprobar que Remotion puede acceder al audio via URL
- Comprobar que la duración del vídeo coincide con la duración del audio
- Comprobar que no hay desfase entre subtítulos y audio
