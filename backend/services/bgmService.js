const fs = require('fs');
const path = require('path');

const BGM_DIR = path.join(__dirname, '../data/bgm');
const MANIFEST_PATH = path.join(BGM_DIR, 'manifest.json');

const MOODS = ['epic', 'calm', 'urgent', 'playful', 'dark', 'inspiring', 'farm', 'news'];

const DEFAULT_MANIFEST = {
  epic: ['epic-drive.mp3'],
  calm: ['calm-fields.mp3'],
  urgent: ['urgent-pulse.mp3'],
  playful: ['playful-upbeat.mp3'],
  dark: ['dark-ambient.mp3'],
  inspiring: ['inspiring-rise.mp3'],
  farm: ['calm-fields.mp3'],
  news: ['inspiring-rise.mp3'],
  default: ['calm-fields.mp3']
};

/**
 * Selección de BGM local por mood para Reels Remotion.
 * Coloca MP3 en backend/data/bgm/ y mapea en manifest.json.
 * Opcional: FREESOUND_API_KEY para descargar un preview si falta el archivo.
 */
class BgmService {
  constructor() {
    this._ensureDir();
  }

  _ensureDir() {
    if (!fs.existsSync(BGM_DIR)) fs.mkdirSync(BGM_DIR, { recursive: true });
    if (!fs.existsSync(MANIFEST_PATH)) {
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(DEFAULT_MANIFEST, null, 2));
    }
  }

  _loadManifest() {
    try {
      return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    } catch {
      return DEFAULT_MANIFEST;
    }
  }

  normalizeMood(raw) {
    if (!raw) return 'calm';
    const m = String(raw).toLowerCase().trim();
    if (MOODS.includes(m)) return m;
    if (/epic|cinematic|heroic|grand/.test(m)) return 'epic';
    if (/calm|relax|soft|peace|ambient|gentle/.test(m)) return 'calm';
    if (/urgent|tense|fast|alert|drama/.test(m)) return 'urgent';
    if (/play|fun|happy|upbeat|cheerful/.test(m)) return 'playful';
    if (/dark|mystery|noir|serious/.test(m)) return 'dark';
    if (/inspir|hope|motiv|uplift/.test(m)) return 'inspiring';
    if (/farm|agro|rural|nature|field|agricult/.test(m)) return 'farm';
    if (/news|report|editorial|inform/.test(m)) return 'news';
    return 'calm';
  }

  /**
   * Elige un track local para el mood. Devuelve ruta absoluta o null.
   */
  resolveLocalTrack(moodInput) {
    this._ensureDir();
    const mood = this.normalizeMood(moodInput);
    const manifest = this._loadManifest();
    const candidates = [
      ...(manifest[mood] || []),
      ...(manifest.default || []),
      ...Object.values(manifest).flat()
    ];

    for (const file of candidates) {
      const abs = path.isAbsolute(file) ? file : path.join(BGM_DIR, file);
      if (fs.existsSync(abs) && fs.statSync(abs).size > 1000) {
        return { mood, absolutePath: abs, fileName: path.basename(abs) };
      }
    }
    return { mood, absolutePath: null, fileName: null };
  }

  /**
   * URL servida por Express para Remotion (file:// a veces falla en Windows).
   */
  toPublicUrl(absolutePath, serverUrl) {
    if (!absolutePath) return null;
    const base = (serverUrl || process.env.SERVER_URL || 'http://localhost:3001').trim().replace(/\/+$/, '');
    const fileName = path.basename(absolutePath);
    return `${base}/bgm/${encodeURIComponent(fileName)}`;
  }

  /**
   * Intenta Freesound si hay API key y no hay archivo local.
   * Descarga un preview corto al mood correspondiente.
   */
  async ensureTrack(moodInput) {
    let resolved = this.resolveLocalTrack(moodInput);
    if (resolved.absolutePath) return resolved;

    const apiKey = (process.env.FREESOUND_API_KEY || '').trim();
    if (!apiKey) {
      console.warn(`[BGM] Sin track local para mood="${resolved.mood}" y sin FREESOUND_API_KEY. Reel sin música.`);
      return resolved;
    }

    try {
      const mood = resolved.mood;
      const query = encodeURIComponent(this._freesoundQuery(mood));
      const searchUrl = `https://freesound.org/apiv2/search/text/?query=${query}&filter=duration:[30 TO 180]&fields=id,name,previews,license&page_size=5&token=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();
      const hit = (searchData.results || []).find(r => r.previews?.['preview-hq-mp3'] || r.previews?.['preview-lq-mp3']);
      if (!hit) {
        console.warn(`[BGM] Freesound no devolvió previews para "${mood}".`);
        return resolved;
      }

      const previewUrl = hit.previews['preview-hq-mp3'] || hit.previews['preview-lq-mp3'];
      const fileName = `${mood}-freesound-${hit.id}.mp3`;
      const dest = path.join(BGM_DIR, fileName);
      const audioRes = await fetch(previewUrl);
      if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status}`);
      const buf = Buffer.from(await audioRes.arrayBuffer());
      fs.writeFileSync(dest, buf);

      // Registrar en manifest
      const manifest = this._loadManifest();
      manifest[mood] = [fileName, ...(manifest[mood] || []).filter(f => f !== fileName)];
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));

      console.log(`\x1b[32m[BGM] ✅ Descargado de Freesound: ${fileName} (${hit.license || 'license n/a'})\x1b[0m`);
      return { mood, absolutePath: dest, fileName, source: 'freesound', attribution: hit.name };
    } catch (e) {
      console.warn(`[BGM] Freesound falló: ${e.message}`);
      return resolved;
    }
  }

  _freesoundQuery(mood) {
    const map = {
      epic: 'cinematic epic orchestra instrumental',
      calm: 'calm ambient soft instrumental',
      urgent: 'tense suspense pulse instrumental',
      playful: 'upbeat fun light instrumental',
      dark: 'dark ambient drone instrumental',
      inspiring: 'inspiring hopeful uplift instrumental',
      farm: 'acoustic folk nature calm instrumental',
      news: 'corporate news soft bed instrumental'
    };
    return map[mood] || 'instrumental background music';
  }

  /**
   * Infieres mood dominante de un array de escenas o del plan Remotion.
   */
  pickMoodFromScenes(scenes = [], planMood = null) {
    if (planMood) return this.normalizeMood(planMood);
    const counts = {};
    for (const s of scenes) {
      const m = this.normalizeMood(s.mood);
      counts[m] = (counts[m] || 0) + 1;
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : 'calm';
  }

  /**
   * Volumen BGM recomendado. Duck fuerte si hay diálogo nativo Veo.
   */
  resolveVolume({ hasNativeDialog = false } = {}) {
    if (hasNativeDialog) {
      return Number(process.env.BGM_VOLUME_DUCKED || 0.06);
    }
    return Number(process.env.BGM_VOLUME || 0.25);
  }
}

module.exports = new BgmService();
