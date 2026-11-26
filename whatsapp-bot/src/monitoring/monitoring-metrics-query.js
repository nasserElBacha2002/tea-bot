import { clampMetricsDays } from './whatsapp-daily-metrics.js';

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseMonitoringMetricsQuery(query = {}) {
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
  if (asOf.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
    errors.push('asOf_future');
  }

  const period = String(query.period || '').trim().toLowerCase();
  let startDayAr = null;
  let endDayAr = null;
  if (query.startDay != null && String(query.startDay).trim() !== '') {
    const value = String(query.startDay).trim();
    if (!ISO_DAY.test(value)) errors.push('startDay_invalid');
    else startDayAr = value;
  }
  if (query.endDay != null && String(query.endDay).trim() !== '') {
    const value = String(query.endDay).trim();
    if (!ISO_DAY.test(value)) errors.push('endDay_invalid');
    else endDayAr = value;
  }

  if (startDayAr && endDayAr && startDayAr > endDayAr) {
    errors.push('day_range_inverted');
  }

  let resolvedDays = days;
  if (period === 'today') {
    resolvedDays = 1;
  } else if (period === '7d') {
    resolvedDays = 7;
  } else if (period === '30d') {
    resolvedDays = 30;
  } else if (period === 'custom' && startDayAr && endDayAr) {
    // Days derived server-side from custom bounds when both provided.
    resolvedDays = null;
  }

  const webhookHours = Math.min(Math.max(Number(query.webhookHours) || 24, 1), 168);

  if (errors.length) {
    return {
      ok: false,
      errors,
      days: resolvedDays ?? days,
      asOf,
      period: period || null,
      startDayAr,
      endDayAr,
      webhookHours,
    };
  }
  return {
    ok: true,
    errors: [],
    days: resolvedDays ?? days,
    asOf,
    period: period || null,
    startDayAr,
    endDayAr,
    webhookHours,
  };
}

export default { parseMonitoringMetricsQuery };