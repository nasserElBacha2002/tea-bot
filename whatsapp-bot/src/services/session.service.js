import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ruta base para las sesiones
const SESSIONS_PATH = path.join(__dirname, '../../data/sessions.json');

class SessionService {
  constructor() {
    this.sessions = {};
  }

  /**
   * Carga las sesiones desde el archivo JSON al iniciar.
   */
  async loadSessions() {
    try {
      const content = await fs.readFile(SESSIONS_PATH, 'utf-8');
      this.sessions = JSON.parse(content || '{}');
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
  }

  /**
   * Guarda las sesiones en el archivo JSON.
   */
  async saveSessions() {
    try {
      await fs.writeFile(SESSIONS_PATH, JSON.stringify(this.sessions, null, 2));
    } catch (error) {
      console.error('Error al guardar sesiones:', error.message);
    }
  }

  /**
   * Obtener sesión por ID de usuario.
   */
  getSession(userId) {
    return this.sessions[userId] || null;
  }

  /**
   * Crear nueva sesión.
   */
  async createSession(userId, flowId, nodeId, extra = {}) {
    this.sessions[userId] = {
      flowId,
      currentNode: nodeId,
      variables: {},
      updatedAt: new Date().toISOString(),
      ...extra,
    };
    await this.saveSessions();
    return this.sessions[userId];
  }

  /**
   * Actualizar sesión.
   */
  async updateSession(userId, patch) {
    if (this.sessions[userId]) {
      this.sessions[userId] = {
        ...this.sessions[userId],
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await this.saveSessions();
    }
    return this.sessions[userId];
  }

  /**
   * Resetear sesión.
   */
  async resetSession(userId) {
    delete this.sessions[userId];
    await this.saveSessions();
  }
}

const sessionService = new SessionService();
export default sessionService;
