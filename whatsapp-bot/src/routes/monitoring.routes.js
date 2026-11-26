import { Router } from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { requireAdmin } from '../middleware/require-admin.middleware.js';
import {
  balance,
  billingDashboard,
  billingDashboardCsv,
  botHealth,
  conversationsMetrics,
  dailyMetrics,
  failedEvents,
  handoffsMetrics,
  incidents,
  jobs,
  messageActivity,
  operationalSummary,
  overview,
  sheetSyncMetrics,
  twilioHealth,
  webhookStats,
  whatsappCostAudit,
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
router.get('/whatsapp-cost-audit', whatsappCostAudit);
router.get('/daily-metrics', dailyMetrics);
router.get('/operational-summary', operationalSummary);
router.get('/handoffs-metrics', handoffsMetrics);
router.get('/conversations-metrics', conversationsMetrics);
router.get('/sheet-sync-jobs', sheetSyncMetrics);
router.get('/webhook-stats', webhookStats);
router.get('/billing-dashboard', billingDashboard);
router.get('/billing-dashboard.csv', billingDashboardCsv);

export default router;
