import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  logPerf,
  measureAsync,
  measureSync,
  nowMs,
  roundMs,
} from '../utils/perf-timer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta base para las sesiones
const SESSIONS_PATH = path.join(__dirname, '../../data/sessions.json');
const HISTORY_LIMIT = 20;

class SessionService {
  constructor() {
    this.sessions = {};
    this.lastPersistBytes = 0;
  }

  /**
   * Carga las sesiones desde el archivo JSON al iniciar.
   */
  async loadSessions() {
    return measureAsync('session_load', async () => {
      try {
        const content = await fs.readFile(SESSIONS_PATH, 'utf-8');
        this.sessions = JSON.parse(content || '{}');
        this.lastPersistBytes = Buffer.byteLength(content, 'utf-8');
        console.log('📂 Sesiones cargadas correctamente desde el disco.');
      } catch (error) {
        if (error.code === 'ENOENT') {
          const dir = path.dirname(SESSIONS_PATH);
          await fs.mkdir(dir, { recursive: true });
          await this.saveSessions();
        } else {
          console.error('Error al cargar sesiones:', error.message);
        }
      }
      return this.sessions;
    }, { sessionsCount: Object.keys(this.sessions).length });
  }

  /**
   * Guarda las sesiones en el archivo JSON.
   */
  async saveSessions(perfContext = null) {
    const start = nowMs();
    try {
      const payload = JSON.stringify(this.sessions, null, 2);
      this.lastPersistBytes = Buffer.byteLength(payload, 'utf-8');
      await fs.writeFile(SESSIONS_PATH, payload);
      const ms = roundMs(nowMs() - start);
      perfContext?.add?.('sessionWriteMs', ms);
      logPerf('session_save', {
        ms,
        sessionsCount: Object.keys(this.sessions).length,
        bytes: this.lastPersistBytes,
      });
    } catch (error) {
      console.error('Error al guardar sesiones:', error.message);
    }
  }

  /**
   * Obtener sesión por ID de usuario.
   */
  getSession(userId, perfContext = null) {
    return measureSync('session_get', () => {
      const session = this.sessions[userId] || null;
      perfContext?.add?.('sessionHit', Boolean(session));
      return session;
    });
  }

  /**
   * Crear nueva sesión.
   */
  async createSession(userId, flowId, nodeId, extra = {}, perfContext = null) {
    this.sessions[userId] = {
      flowId,
      currentNode: nodeId,
      variables: {},
      history: [],
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    if (!Array.isArray(this.sessions[userId].history)) {
      this.sessions[userId].history = [];
    }
    await this.saveSessions(perfContext);
    return this.sessions[userId];
  }

  /**
   * Actualizar sesión.
   */
  async updateSession(userId, patch, perfContext = null) {
    if (this.sessions[userId]) {
      const current = this.sessions[userId];
      const skipHistoryPush = Boolean(patch.__skipHistoryPush);
      const resetHistory = Boolean(patch.__resetHistory);
      const historyOverride = Array.isArray(patch.__historyOverride) ? patch.__historyOverride : null;
      const previousNode = current.currentNode;
      let history = Array.isArray(current.history) ? [...current.history] : [];

      if (resetHistory) {
        history = [];
      }
      if (historyOverride) {
        history = historyOverride.slice(-HISTORY_LIMIT);
      } else if (!skipHistoryPush && patch.currentNode && patch.currentNode !== previousNode && previousNode) {
        if (history[history.length - 1] !== previousNode) {
          history.push(previousNode);
        }
        if (history.length > HISTORY_LIMIT) {
          history = history.slice(history.length - HISTORY_LIMIT);
        }
      }

      const sanitizedPatch = { ...patch };
      delete sanitizedPatch.__skipHistoryPush;
      delete sanitizedPatch.__resetHistory;
      delete sanitizedPatch.__historyOverride;

      this.sessions[userId] = {
        ...current,
        ...sanitizedPatch,
        history,
        updatedAt: new Date().toISOString(),
      };
      await this.saveSessions(perfContext);
    }
    return this.sessions[userId];
  }

  /**
   * Resetear sesión.
   */
  async resetSession(userId, perfContext = null) {
    delete this.sessions[userId];
    await this.saveSessions(perfContext);
  }
}

const sessionService = new SessionService();
export default sessionService;
