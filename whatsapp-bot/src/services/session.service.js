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

  _sessionGeneration(session) {
    return session?.updatedAt || '';
  }

  _assertSessionUnchanged(userId, generation) {
    const current = this.sessions[userId];
    if (!current) return false;
    return this._sessionGeneration(current) === generation;
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

  listSessions() {
    return Object.entries(this.sessions).map(([userId, session]) => ({ userId, session }));
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

  /**
   * Vincula la sesión en memoria a una conversación SQL (generación explícita).
   */
  async bindConversationId(userId, conversationId, perfContext = null) {
    if (!userId || !conversationId) return this.getSession(userId);
    const current = this.sessions[userId];
    if (!current) return null;
    const observedGen = this._sessionGeneration(current);
    const bound = String(conversationId).toLowerCase();
    if (String(current.conversationId || '').toLowerCase() === bound) return current;
    if (!this._assertSessionUnchanged(userId, observedGen)) return this.getSession(userId);
    const previousBound = String(current.conversationId || '').toLowerCase();
    if (previousBound && previousBound !== bound) {
      return this.updateSession(userId, {
        conversationId: bound,
        variables: {},
        __resetHistory: true,
      }, perfContext);
    }
    if (!this._assertSessionUnchanged(userId, observedGen)) return this.getSession(userId);
    return this.updateSession(userId, { conversationId: bound }, perfContext);
  }

  /**
   * Limpia runtime solo si la sesión sigue asociada a la conversación eliminada.
   * Evita borrar estado de una conversación nueva del mismo contacto.
   */
  async resetSessionForDeletedConversation(
    userId,
    deletedConversationId,
    { resolveActiveConversation, perfContext = null } = {},
  ) {
    if (!userId || !deletedConversationId) {
      return { action: 'invalid_args' };
    }
    const deletedId = String(deletedConversationId).toLowerCase();
    const session = this.sessions[userId];
    if (!session) return { action: 'no_session' };
    const initialGen = this._sessionGeneration(session);

    const sessionConversationId = session.conversationId
      ? String(session.conversationId).toLowerCase()
      : null;

    if (sessionConversationId && sessionConversationId !== deletedId) {
      return { action: 'skipped_bound_to_other_conversation' };
    }

    if (!sessionConversationId && typeof resolveActiveConversation === 'function') {
      const active = await resolveActiveConversation();
      const activeId = active?.id ? String(active.id).toLowerCase() : null;
      if (activeId && activeId !== deletedId) {
        if (!this._assertSessionUnchanged(userId, initialGen)) {
          return { action: 'skipped_concurrent_mutation' };
        }
        const bound = await this.bindConversationId(userId, activeId, perfContext);
        if (!bound) return { action: 'skipped_concurrent_mutation' };
        return { action: 'skipped_new_conversation' };
      }
    }

    const latest = this.sessions[userId];
    if (!latest) return { action: 'no_session' };
    if (!sessionConversationId && this._sessionGeneration(latest) !== initialGen) {
      const rebound = latest.conversationId ? String(latest.conversationId).toLowerCase() : null;
      if (rebound && rebound !== deletedId) {
        return { action: 'skipped_bound_to_other_conversation' };
      }
      if (!rebound) {
        return { action: 'skipped_concurrent_mutation' };
      }
    }
    const gateGen = this._sessionGeneration(latest);
    if (!this._assertSessionUnchanged(userId, gateGen)) {
      return { action: 'skipped_concurrent_mutation' };
    }
    const latestConversationId = latest.conversationId
      ? String(latest.conversationId).toLowerCase()
      : null;
    if (latestConversationId && latestConversationId !== deletedId) {
      return { action: 'skipped_bound_to_other_conversation' };
    }
    if (latestConversationId === null && sessionConversationId === null) {
      // Sin vínculo y SQL sin conversación activa distinta: puede resetear si la generación sigue igual.
    } else if (latestConversationId !== deletedId) {
      return { action: 'skipped_concurrent_mutation' };
    }
    if (!this._assertSessionUnchanged(userId, gateGen)) {
      return { action: 'skipped_concurrent_mutation' };
    }
    delete this.sessions[userId];
    await this.saveSessions(perfContext);
    return { action: 'reset' };
  }
}

const sessionService = new SessionService();
export default sessionService;
