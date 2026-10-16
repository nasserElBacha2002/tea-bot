import monitoringService from '../monitoring/monitoring.service.js';

function send(res, body) {
  return res.status(200).json({ ok: true, ...body });
}

function fail(res, error) {
  console.error(`[Monitoring] request failed: ${error.message}`);
  return res.status(500).json({ ok: false, error: 'MONITORING_FAILED' });
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
