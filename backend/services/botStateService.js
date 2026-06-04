const fs = require('fs');
const path = require('path');

const STATE_PATH = path.join(__dirname, '../data/botState.json');

/**
 * Servicio de persistencia para el estado del Bot de Auto-Pilot.
 * Garantiza que el estado sobrevive a reinicios del servidor Windows.
 */
class BotStateService {
  constructor() {
    this.initDB();
  }

  initDB() {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(STATE_PATH)) {
      this._write({
        isAutoPilotActive: false,
        adminEmail: '',
        allowedFormats: [
          { format: "single", mediaType: "image" },
          { format: "carousel", mediaType: "image" },
          { format: "carousel", mediaType: "video" },
          { format: "video", mediaType: "image" },
          { format: "video", mediaType: "video" }
        ],
        currentMonth: null,
        schedule: [],
        pendingApproval: []
      });
    }
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    } catch (e) {
      console.error('[BotState] Error leyendo estado:', e.message);
      return { isAutoPilotActive: false, adminEmail: '', currentMonth: null, schedule: [], pendingApproval: [] };
    }
  }

  _write(data) {
    fs.writeFileSync(STATE_PATH, JSON.stringify(data, null, 2));
  }

  getState() {
    return this._read();
  }

  isActive() {
    return this._read().isAutoPilotActive;
  }

  toggleAutoPilot() {
    const state = this._read();
    state.isAutoPilotActive = !state.isAutoPilotActive;
    this._write(state);
    console.log(`[BotState] Auto-Pilot ${state.isAutoPilotActive ? 'ACTIVADO' : 'DESACTIVADO'}`);
    return state;
  }

  setAdminEmail(email) {
    const state = this._read();
    state.adminEmail = email;
    this._write(state);
  }

  getAllowedFormats() {
    const state = this._read();
    return state.allowedFormats || [
      { format: "single", mediaType: "image" },
      { format: "carousel", mediaType: "image" },
      { format: "carousel", mediaType: "video" },
      { format: "video", mediaType: "image" },
      { format: "video", mediaType: "video" }
    ];
  }

  setAllowedFormats(formats) {
    const state = this._read();
    state.allowedFormats = formats;
    this._write(state);
    console.log(`[BotState] Format configuration updated (${formats.length} combinations allowed).`);
  }

  /**
   * Guarda el calendario mensual generado por el Agente Planificador.
   * @param {string} month - Formato "YYYY-MM"
   * @param {Array} schedule - Array de objetos { day, hour, concept, format, aspectRatio, status }
   */
  setMonthlySchedule(month, schedule) {
    const state = this._read();
    state.currentMonth = month;
    state.schedule = schedule;
    this._write(state);
    console.log(`[BotState] Calendario del mes ${month} guardado (${schedule.length} entradas).`);
  }

  getSchedule() {
    return this._read().schedule;
  }

  /**
   * Actualiza el estado de un día específico del calendario (primera entrada).
   * @param {number} day - Día del mes (1-31)
   * @param {object} updates - Campos a actualizar (status, postId, etc.)
   */
  updateScheduleDay(day, updates) {
    const state = this._read();
    const entry = state.schedule.find(e => e.day === day);
    if (entry) {
      Object.assign(entry, updates);
      this._write(state);
    }
  }

  /**
   * Actualiza una entrada específica de un día por su índice.
   * @param {number} day - Día del mes
   * @param {number} index - Índice de la entrada dentro de las del día (0-based)
   * @param {object} updates - Campos a actualizar
   */
  updateScheduleEntry(day, index, updates) {
    const state = this._read();
    const dayEntries = state.schedule.filter(e => e.day === day);
    if (dayEntries[index]) {
      Object.assign(dayEntries[index], updates);
      this._write(state);
    }
  }

  /**
   * Actualiza una entrada buscando por su postId.
   * @param {string} postId 
   * @param {object} updates 
   */
  updateScheduleEntryByPostId(postId, updates) {
    const state = this._read();
    const entry = state.schedule.find(e => e.postId === postId);
    if (entry) {
      Object.assign(entry, updates);
      this._write(state);
    }
  }

  addScheduleEntry(entry) {
    const state = this._read();
    state.schedule.push(entry);
    this._write(state);
    console.log(`[BotState] Nueva entrada añadida para el día ${entry.day}.`);
  }

  removeScheduleEntry(day) {
    const state = this._read();
    state.schedule = state.schedule.filter(e => e.day !== day);
    this._write(state);
    console.log(`[BotState] Todas las entradas del día ${day} eliminadas.`);
  }

  /**
   * Elimina una entrada específica de un día por su índice.
   * @param {number} day - Día del mes
   * @param {number} index - Índice de la entrada dentro de las del día (0-based)
   */
  removeScheduleEntryByIndex(day, index) {
    const state = this._read();
    const dayEntries = state.schedule.filter(e => e.day === day);
    if (dayEntries[index]) {
      const globalIdx = state.schedule.indexOf(dayEntries[index]);
      if (globalIdx !== -1) {
        state.schedule.splice(globalIdx, 1);
        this._write(state);
        console.log(`[BotState] Entrada #${index} del día ${day} eliminada.`);
      }
    }
  }

  addPendingApproval(postData) {
    const state = this._read();
    state.pendingApproval.push(postData);
    this._write(state);
  }

  removePendingApproval(postId) {
    const state = this._read();
    state.pendingApproval = state.pendingApproval.filter(p => p.id !== postId);
    this._write(state);
  }

  getPendingApprovals() {
    return this._read().pendingApproval;
  }
}

module.exports = new BotStateService();
