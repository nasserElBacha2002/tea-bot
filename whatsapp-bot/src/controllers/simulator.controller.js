import simulatorService from '../services/simulator.service.js';
import { sendSuccess, sendError, HTTP_STATUS } from '../utils/http-errors.js';

/**
 * Iniciar una sesión de simulación.
 */
export const startSimulation = async (req, res) => {
  const { flowId, flow: flowSnapshot, useDraftSnapshot } = req.body;
  const sessionId = req.body.sessionId || `session-${Date.now()}`;

  try {
    const result = await simulatorService.startSimulation({
      sessionId,
      flowId,
      flowSnapshot,
      useDraftSnapshot: Boolean(useDraftSnapshot),
    });
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, error.message);
  }
};

/**
 * Enviar mensaje a una simulación activa.
 */
export const sendMessage = async (req, res) => {
  const { sessionId, text } = req.body;

  if (!sessionId) return sendError(res, 'sessionId es requerido', HTTP_STATUS.BAD_REQUEST);
  if (text === undefined) return sendError(res, 'text es requerido', HTTP_STATUS.BAD_REQUEST);

  try {
    const result = await simulatorService.sendMessage({ sessionId, text });
    return sendSuccess(res, result);
  } catch (error) {
    return sendError(res, error.message);
  }
};

/**
 * Resetear una sesión de simulación.
 */
export const resetSimulation = async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) return sendError(res, 'sessionId es requerido', HTTP_STATUS.BAD_REQUEST);

  try {
    await simulatorService.resetSimulation(sessionId);
    return sendSuccess(res, { message: 'Simulación reiniciada correctamente' });
  } catch (error) {
    return sendError(res, error.message);
  }
};
