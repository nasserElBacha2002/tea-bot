import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { requireAdmin } from '../middleware/require-admin.middleware.js';
import {
  balance,
  botHealth,
  failedEvents,
  incidents,
  jobs,
  messageActivity,
  overview,
  twilioHealth,
} from '../controllers/monitoring.controller.js';

const router = Router();

router.use(requireAuth, requireAdmin);
router.get('/overview', overview);
router.get('/bot-health', botHealth);
router.get('/twilio-health', twilioHealth);
router.get('/balance', balance);
router.get('/message-activity', messageActivity);
router.get('/failed-events', failedEvents);
router.get('/jobs', jobs);
router.get('/incidents', incidents);

export default router;
