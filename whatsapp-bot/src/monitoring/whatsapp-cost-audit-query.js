import { clampMetricsDays } from './whatsapp-daily-metrics.js';
import { resolveEffectiveBillingPeriod } from './whatsapp-effective-period.js';

export function parseWhatsAppCostAuditQuery(query = {}) {
  const errors = [];
  if (query.days != null && String(query.days).trim() !== '' && !query.period && !query.billingPeriod) {
    const days = clampMetricsDays(query.days);
    if (Number(query.days) !== days) {
      errors.push('days_out_of_range');
    }
  }
  if (query.asOf != null && String(query.asOf).trim() !== '') {
    const parsed = new Date(String(query.asOf));
    if (Number.isNaN(parsed.getTime())) errors.push('asOf_invalid');
  }
  if (errors.length) {
    return {
      ok: false,
      errors,
      days: clampMetricsDays(query.days),
      asOf: new Date(),
      fetchUsage: String(query.fetchUsage ?? 'false').toLowerCase() === 'true',
    };
  }

  const resolved = resolveEffectiveBillingPeriod({
    ...query,
    period: query.period || query.billingPeriod || '30d',
    days: query.days,
    fetchUsage: query.fetchUsage,
  });
  if (!resolved.ok) {
    return {
      ok: false,
      errors: resolved.errors,
      days: resolved.days,
      asOf: resolved.asOf,
      fetchUsage: resolved.fetchUsage,
      period: resolved.period,
      window: resolved.window,
    };
  }
  return {
    ok: true,
    errors: [],
    days: resolved.days,
    asOf: resolved.asOf,
    fetchUsage: resolved.fetchUsage,
    period: resolved.period,
    window: resolved.window,
    startDayAr: resolved.startDayAr,
    endDayAr: resolved.endDayAr,
  };
}