import { clampMetricsDays } from './whatsapp-daily-metrics.js';

export function parseWhatsAppCostAuditQuery(query = {}) {
  const errors = [];
  const days = clampMetricsDays(query.days);
  if (query.days != null && String(query.days).trim() !== '' && Number(query.days) !== days) {
    errors.push('days_out_of_range');
  }

  let asOf = new Date();
  if (query.asOf != null && String(query.asOf).trim() !== '') {
    const parsed = new Date(String(query.asOf));
    if (Number.isNaN(parsed.getTime())) {
      errors.push('asOf_invalid');
    } else {
      asOf = parsed;
    }
  }

  const fetchUsage = String(query.fetchUsage ?? 'true').toLowerCase() !== 'false';

  if (errors.length) {
    return { ok: false, errors, days, asOf, fetchUsage };
  }
  return { ok: true, errors: [], days, asOf, fetchUsage };
}