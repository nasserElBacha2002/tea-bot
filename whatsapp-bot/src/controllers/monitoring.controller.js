import monitoringService from '../monitoring/monitoring.service.js';
import { getWhatsAppCostAudit } from '../monitoring/whatsapp-cost-audit.service.js';
import { parseWhatsAppCostAuditQuery } from '../monitoring/whatsapp-cost-audit-query.js';

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
  }));
}