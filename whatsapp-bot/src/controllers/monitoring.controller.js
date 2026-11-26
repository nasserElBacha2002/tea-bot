import monitoringService from '../monitoring/monitoring.service.js';
import { getWhatsAppCostAudit } from '../monitoring/whatsapp-cost-audit.service.js';
import { parseWhatsAppCostAuditQuery } from '../monitoring/whatsapp-cost-audit-query.js';
import { parseMonitoringMetricsQuery } from '../monitoring/monitoring-metrics-query.js';
import { resolveBillingPeriod } from '../monitoring/whatsapp-billing-query.js';
import {
  billingDailyToCsv,
  getWhatsAppBillingDashboard,
} from '../monitoring/whatsapp-billing-dashboard.service.js';
import {
  getConversationsMetrics,
  getDailyMetrics,
  getHandoffsMetrics,
  getOperationalSummary,
  getSheetSyncMetrics,
  getWebhookStats,
} from '../monitoring/monitoring-metrics.service.js';

function send(res, body) {
  return res.status(200).json({ ok: true, ...body });
}

function fail(res, error) {
  console.error(`[Monitoring] request failed: ${error.message}`);
  return res.status(500).json({ ok: false, error: 'MONITORING_FAILED' });
}

function badRequest(res, errors) {
  return res.status(400).json({ ok: false, error: 'INVALID_QUERY', details: errors });
}

async function handle(res, loader) {
  try {
    return send(res, await loader());
  } catch (error) {
    return fail(res, error);
  }
}

export function overview(req, res) {
  return handle(res, () => monitoringService.getOverview());
}

export function botHealth(req, res) {
  return handle(res, () => monitoringService.getBotHealth());
}

export function twilioHealth(req, res) {
  return handle(res, () => monitoringService.getTwilioHealth());
}

export function balance(req, res) {
  return handle(res, () => monitoringService.getBalance());
}

export function messageActivity(req, res) {
  return handle(res, () => monitoringService.getMessageActivity());
}

export function failedEvents(req, res) {
  return handle(res, () => monitoringService.getFailedEvents());
}

export function jobs(req, res) {
  return handle(res, () => monitoringService.getJobs());
}

export function incidents(req, res) {
  return handle(res, () => monitoringService.getIncidents().then((items) => ({ incidents: items })));
}

export function whatsappCostAudit(req, res) {
  const parsed = parseWhatsAppCostAuditQuery(req.query || {});
  if (!parsed.ok) {
    return badRequest(res, parsed.errors);
  }
  return handle(res, () => getWhatsAppCostAudit({
    days: parsed.days,
    asOf: parsed.asOf,
    fetchUsage: parsed.fetchUsage,
    effectiveWindow: parsed.window,
  }));
}

function metricsQuery(req) {
  return parseMonitoringMetricsQuery(req.query || {});
}

export function dailyMetrics(req, res) {
  const parsed = metricsQuery(req);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  return handle(res, () => getDailyMetrics({ days: parsed.days, asOf: parsed.asOf }));
}

export function handoffsMetrics(req, res) {
  const parsed = metricsQuery(req);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  return handle(res, () => getHandoffsMetrics({ days: parsed.days, asOf: parsed.asOf }));
}

export function conversationsMetrics(req, res) {
  const parsed = metricsQuery(req);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  return handle(res, () => getConversationsMetrics({ days: parsed.days, asOf: parsed.asOf }));
}

export function sheetSyncMetrics(req, res) {
  return handle(res, () => getSheetSyncMetrics());
}

export function webhookStats(req, res) {
  const parsed = metricsQuery(req);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  return handle(res, () => getWebhookStats({ webhookHours: parsed.webhookHours }));
}

export function operationalSummary(req, res) {
  const parsed = metricsQuery(req);
  if (!parsed.ok) return badRequest(res, parsed.errors);
  return handle(res, () => getOperationalSummary({ days: parsed.days, asOf: parsed.asOf }));
}

export function billingDashboard(req, res) {
  const parsed = resolveBillingPeriod(req.query || {});
  if (!parsed.ok) return badRequest(res, parsed.errors);
  return handle(res, () => getWhatsAppBillingDashboard({
    days: parsed.days,
    asOf: parsed.asOf,
    period: parsed.period,
    fetchUsage: parsed.fetchUsage,
    persistAggregates: parsed.persistAggregates === true,
    effectiveWindow: parsed.window,
  }));
}

export async function billingDashboardCsv(req, res) {
  const parsed = resolveBillingPeriod(req.query || {});
  if (!parsed.ok) return badRequest(res, parsed.errors);
  try {
    const dashboard = await getWhatsAppBillingDashboard({
      days: parsed.days,
      asOf: parsed.asOf,
      period: parsed.period,
      fetchUsage: false,
      effectiveWindow: parsed.window,
    });
    const csv = billingDailyToCsv(dashboard.table?.daily || []);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="monitoring-billing-daily.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    return fail(res, error);
  }
}