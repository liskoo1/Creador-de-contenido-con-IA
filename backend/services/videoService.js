const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const http = require('http');
const https = require('https');

// ─── Constantes ─────────────────────────────────────────────────────────────
const RENDER_TIMEOUT_MS = 180000; // 3 minutos máximo por render

/**
 * Genera un env limpio para child processes de Remotion.
 * Elimina --watch de NODE_OPTIONS para evitar crash del FSWatcher.
 */
function getCleanEnv() {
  const env = { ...process.env, NODE_OPTIONS: '--no-warnings' };
  // Limpiar NODE_OPTIONS de cualquier --watch que el padre pueda tener
  if (env.NODE_OPTIONS) {
    env.NODE_OPTIONS = env.NODE_OPTIONS.replace(/--watch[^ ]*/g, '').trim();
  }
  return env;
}

/**
 * Servicio para procesar y montar vídeos usando FFmpeg y Remotion.
 */
class VideoService {
  /**
   * Verifica que una URL de media es accesible (HTTP 200).
   * @param {string} url - URL a verificar
   * @returns {Promise<boolean>}
   */
  async _validateMediaUrl(url) {
    // Skip validation for localhost URLs (always accessible during render)
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      return true;
    }

    return new Promise((resolve) => {
      const client = url.startsWith('https') ? https : http;
      const req = client.get(url, { timeout: 10000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  /**
   * Valida todas las URLs de escenas antes del render.
   * @param {Array} scenes - Array de escenas con campo url
   * @returns {Promise<{valid: Array, invalid: Array}>}
   */
  async _validateSceneUrls(scenes) {
    const results = await Promise.allSettled(
      scenes.map(async (scene, i) => {
        const url = scene.url || scene.imageUrl;
        const isValid = await this._validateMediaUrl(url);
        return { index: i, url, isValid };
      })
    );

    const valid = [];
    const invalid = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        (r.value.isValid ? valid : invalid).push(r.value);
      } else {
        invalid.push({ index: -1, url: 'unknown', isValid: false });
      }
    });

    if (invalid.length > 0) {
      console.warn(`[VideoEngine] ⚠️ ${invalid.length} URLs inaccesibles:`, invalid.map(i => i.url));
    }

    return { valid, invalid };
  }

  /**
   * Une varios clips de vídeo en uno solo.
   */
  async concatenateClips(clipPaths) {
    const outputPath = path.join(__dirname, `../../temp/merged_${uuidv4()}.mp4`);
    
    if (!fs.existsSync(path.dirname(outputPath))) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const command = ffmpeg();
      clipPaths.forEach(clip => command.input(clip));

      command
        .on('error', (err) => {
          console.error('[VideoEngine] Error procesando vídeo:', err);
          reject(err);
        })
        .on('end', () => {
          console.log('[VideoEngine] Vídeo fusionado correctamente.');
          resolve(outputPath);
        })
        .mergeToFile(outputPath);
    });
  }

  /**
   * Renderiza un vídeo usando el motor de Remotion (SwarmReel).
   * @param {Array<{url: string, title: string, subtitle: string}>} scenes
   */
  async renderSwarmReel(scenes) {
    const { exec } = require('child_process');

    // Validar URLs antes de renderizar
    console.log(`[VideoEngine] 🔍 Validando ${scenes.length} URLs de escenas...`);
    const { invalid } = await this._validateSceneUrls(scenes);
    const validScenes = scenes.filter((_, i) => !invalid.find(inv => inv.index === i));

    if (validScenes.length === 0) {
      throw new Error('Ninguna URL de escena es accesible. Abortando render.');
    }
    if (validScenes.length < scenes.length) {
      console.warn(`[VideoEngine] Continuando con ${validScenes.length}/${scenes.length} escenas válidas.`);
    }

    return new Promise((resolve, reject) => {
      const enginePath = path.resolve(__dirname, '../../video-engine');
      const timestamp = Date.now();
      const outputFilename = `swarm_reel_${timestamp}.mp4`;
      const outputPath = path.resolve(__dirname, '../output', outputFilename);
      
      // Sanitizar escenas: asegurar que NO hay valores null/undefined que causen crash en FSWatcher
      const sanitizedScenes = validScenes
        .filter(s => s.url && typeof s.url === 'string' && s.url.length > 0)
        .map(s => ({
          url: s.url,
          title: s.title || '',
          subtitle: s.subtitle || '',
        }));

      if (sanitizedScenes.length === 0) {
        throw new Error('Ninguna escena tiene URL válida tras sanitización.');
      }

      const props = { scenes: sanitizedScenes };
      const propsPath = path.join(require('os').tmpdir(), `remotion_swarm_props_${timestamp}.json`);
      fs.writeFileSync(propsPath, JSON.stringify(props));

      console.log(`[VideoEngine] 🎬 Renderizando SwarmReel (${validScenes.length} escenas)...`);
      console.log(`[VideoEngine] Props: ${JSON.stringify(validScenes.map(s => ({ url: s.url?.substring(0, 60), title: s.title })))}`);
      const startTime = Date.now();
      
      // --log=error evita output excesivo; --disable-web-security permite URLs locales
      const cmd = `npx remotion render src/index.ts SwarmReel "${outputPath}" --props="${propsPath}" --log=error`;
      
      const child = exec(cmd, { cwd: enginePath, timeout: RENDER_TIMEOUT_MS, env: getCleanEnv() }, (error, stdout, stderr) => {
        if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (error) {
          console.error(`[VideoEngine] ❌ Error tras ${elapsed}s:`, error.message);
          if (stderr) console.error(`[VideoEngine] STDERR:\n${stderr.slice(-500)}`);
          reject(error);
          return;
        }
        
        console.log(`[VideoEngine] ✅ SwarmReel completado en ${elapsed}s: ${outputFilename}`);
        if (stdout) console.log(`[VideoEngine] STDOUT (últimas 300 chars):\n${stdout.slice(-300)}`);
        resolve({ url: `/output/${outputFilename}` });
      });
    });
  }

  /**
   * Renderiza un Audio Reel usando Remotion con audio + imágenes sincronizadas + subtítulos.
   */
  async renderAudioReel(scenes, audioPath, totalDuration) {
    const { exec } = require('child_process');

    // Validar URLs de escenas
    console.log(`[VideoEngine] 🔍 Validando ${scenes.length} URLs de escenas (Audio Reel)...`);
    const { invalid } = await this._validateSceneUrls(scenes);
    if (invalid.length > 0) {
      console.warn(`[VideoEngine] ${invalid.length} URLs inválidas en Audio Reel. Continuando con las válidas.`);
    }

    return new Promise((resolve, reject) => {
      const enginePath = path.resolve(__dirname, '../../video-engine');
      const timestamp = Date.now();
      const outputFilename = `audio_reel_${timestamp}.mp4`;
      const outputPath = path.resolve(__dirname, '../output', outputFilename);
      const FPS = 30;
      const PORT = process.env.PORT || 3001;

      const audioBasename = path.basename(audioPath);
      const audioFullUrl = `http://localhost:${PORT}/audio/${audioBasename}`;

      const remotionScenes = scenes.map(scene => ({
        url: scene.imageUrl.startsWith('http') 
          ? scene.imageUrl 
          : `http://localhost:${PORT}${scene.imageUrl.startsWith('/') ? '' : '/'}${scene.imageUrl}`,
        startFrame: Math.round(scene.startTime * FPS),
        durationFrames: Math.round((scene.endTime - scene.startTime) * FPS),
        subtitles: (scene.subtitles || []).map(sub => ({
          text: sub.text,
          startMs: Math.round(sub.start * 1000),
          endMs: Math.round(sub.end * 1000),
        })),
      }));

      const captions = [];
      for (const scene of scenes) {
        for (const sub of (scene.subtitles || [])) {
          captions.push({
            text: ` ${sub.text}`,
            startMs: Math.round(sub.start * 1000),
            endMs: Math.round(sub.end * 1000),
            timestampMs: Math.round(sub.start * 1000),
            confidence: 1.0,
          });
        }
      }

      const props = {
        scenes: remotionScenes,
        audioUrl: audioFullUrl,
        captions: captions,
      };

      const propsPath = path.join(require('os').tmpdir(), `remotion_audio_props_${timestamp}.json`);
      fs.writeFileSync(propsPath, JSON.stringify(props));

      console.log(`[VideoEngine] 🎬 Renderizando Audio Reel (${scenes.length} escenas, ${totalDuration}s)...`);
      const startTime = Date.now();

      const cmd = `npx remotion render src/index.ts AudioReel "${outputPath}" --props="${propsPath}" --log=error`;

      const child = exec(cmd, { cwd: enginePath, timeout: RENDER_TIMEOUT_MS, env: getCleanEnv() }, (error, stdout, stderr) => {
        if (fs.existsSync(propsPath)) fs.unlinkSync(propsPath);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        if (error) {
          console.error(`[VideoEngine] ❌ Audio Reel error tras ${elapsed}s:`, error.message);
          if (stderr) console.error(`[VideoEngine] STDERR:\n${stderr.slice(-500)}`);
          reject(error);
          return;
        }

        console.log(`[VideoEngine] ✅ Audio Reel completado en ${elapsed}s: ${outputFilename}`);
        resolve({ url: `/output/${outputFilename}` });
      });
    });
  }
}

module.exports = new VideoService();
