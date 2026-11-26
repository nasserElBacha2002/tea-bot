import { resolveEffectiveBillingPeriod } from './whatsapp-effective-period.js';

export function resolveBillingPeriod(query = {}, asOfInput = new Date()) {
  const resolved = resolveEffectiveBillingPeriod(query, asOfInput);
  if (!resolved.ok) {
    return {
      ok: false,
      errors: resolved.errors,
      days: resolved.days,
      asOf: resolved.asOf,
      period: resolved.period,
      startDayAr: resolved.startDayAr,
      endDayAr: resolved.endDayAr,
    };
  }
  return {
    ok: true,
    errors: [],
    days: resolved.days,
    asOf: resolved.asOf,
    period: resolved.period,
    startDayAr: resolved.startDayAr,
    endDayAr: resolved.endDayAr,
    window: resolved.window,
    fetchUsage: resolved.fetchUsage,
    persistAggregates: resolved.persistAggregates,
  };
}

export default { resolveBillingPeriod };