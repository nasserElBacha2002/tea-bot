import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import simulatorService from '../services/simulator.service.js';
import { sendSuccess, sendError, HTTP_STATUS } from '../utils/http-errors.js';
import flowLoader from '../utils/flow-loader.js';

const router = Router();

function devToolsEnabled() {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.DEV_TOOLS_ENABLED === 'true';
}

router.use(requireAuth);
router.use((req, res, next) => {
  if (!devToolsEnabled()) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
  }
  next();
});

/**
 * POST /api/dev/conversations/inbound-message
 * Simula un mensaje entrante sin WhatsApp (misma persistencia que el simulador).
 */
router.post('/inbound-message', async (req, res) => {
  const {
    phone = 'simulator-local-001',
    name = 'Simulación Local',
    message,
    flowId = 'main-menu',
    sessionId,
  } = req.body || {};

  if (!message || !String(message).trim()) {
    return sendError(res, 'message es requerido', HTTP_STATUS.BAD_REQUEST);
  }

  const sid = sessionId || `dev-${phone}-${flowId}`;

  try {
    await flowLoader.load();
    let result = await simulatorService.sendMessage({
      sessionId: sid,
      text: String(message).trim(),
    });

    if (!result?.reply && result?.conversationId == null) {
      result = await simulatorService.startSimulation({
        sessionId: sid,
        flowId,
        useDraftSnapshot: false,
      });
      result = await simulatorService.sendMessage({
        sessionId: sid,
        text: String(message).trim(),
      });
    }

    return sendSuccess(res, {
      sessionId: sid,
      displayName: name,
      phone,
      ...result,
    });
  } catch (error) {
    return sendError(res, error.message, HTTP_STATUS.INTERNAL_SERVER_ERROR);
  }
});

export default router;
