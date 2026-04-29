import flowEngine from './flow-engine.service.js';
import sessionService from './session.service.js';

class SimulatorService {
  /**
   * Prefijo para usuarios de simulación en el sessionService.
   */
  getSimulationId(sessionId) {
    return `simulator:${sessionId}`;
  }

  /**
   * Inicia una simulación y devuelve el mensaje de bienvenida.
   */
  async startSimulation({ sessionId, flowId, flowSnapshot, useDraftSnapshot = false }) {
    const userId = this.getSimulationId(sessionId);
    
    // Limpiamos sesión previa si existiera
    await sessionService.resetSession(userId);

    // Por defecto simulamos published activo.
    // Solo usamos snapshot draft cuando useDraftSnapshot=true.
    const useSnapshot = Boolean(useDraftSnapshot && flowSnapshot);
    const result = await flowEngine.resolveIncomingMessage({
      userId,
      text: '', // Mensaje vacío para disparar el entryNode
      flowMode: useSnapshot ? 'draft' : 'published',
      flowId,
      flowSnapshot: useSnapshot ? flowSnapshot : undefined,
    });

    return {
      sessionId,
      ...result
    };
  }

  /**
   * Envía un mensaje a una sesión de simulación activa.
   */
  async sendMessage({ sessionId, text }) {
    const userId = this.getSimulationId(sessionId);
    
    const result = await flowEngine.resolveIncomingMessage({
      userId,
      text
    });

    return {
      sessionId,
      ...result
    };
  }

  /**
   * Resetea la sesión de simulación.
   */
  async resetSimulation(sessionId) {
    const userId = this.getSimulationId(sessionId);
    await sessionService.resetSession(userId);
    return true;
  }
}

const simulatorService = new SimulatorService();
export default simulatorService;
