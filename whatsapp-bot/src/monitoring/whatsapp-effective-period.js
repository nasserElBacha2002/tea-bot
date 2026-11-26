import { clampMetricsDays, ARGENTINA_PRESENTATION_TZ } from './whatsapp-daily-metrics.js';
import { lastDayOfMonthYm, monthKeyArgentina, parseDateOnly } from './whatsapp-pricing-regime.js';

const AR_IANA = 'America/Argentina/Buenos_Aires';
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_PERIODS = new Set([
  'today',
  'yesterday',
  '7d',
  '30d',
  'current_month',
  'previous_month',
  'custom',
]);

export function formatDayArInArgentina(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_IANA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function addDaysDayAr(dayAr, delta) {
  const base = parseDateOnly(dayAr);
  if (!base) return null;
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

export function daysInclusive(startDayAr, endDayAr) {
  const start = parseDateOnly(startDayAr);
  const end = parseDateOnly(endDayAr);
  if (!start || !end) return null;
  return Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
}

/** AR civil midnight → UTC (Argentina Standard Time = UTC-3). */
export function dayArToUtcBounds(startDayAr, endDayAr) {
  if (!ISO_DAY.test(String(startDayAr)) || !ISO_DAY.test(String(endDayAr))) {
    return null;
  }
  const startUtc = new Date(`${startDayAr}T03:00:00.000Z`);
  const endExclusiveDay = addDaysDayAr(endDayAr, 1);
  const endUtcExclusive = new Date(`${endExclusiveDay}T03:00:00.000Z`);
  return {
    startDayAr,
    endDayAr,
    startUtc,
    endUtcExclusive,
    presentationTimeZone: ARGENTINA_PRESENTATION_TZ,
    storageTimeZone: 'UTC',
  };
}

/**
 * Período efectivo único para billing SQL, estimación, históricos y exportación.
 */
export function resolveEffectiveBillingPeriod(query = {}, asOfInput = new Date()) {
  const errors = [];
  let asOf = asOfInput instanceof Date ? asOfInput : new Date();
  if (query.asOf != null && String(query.asOf).trim() !== '') {
    const parsed = new Date(String(query.asOf));
    if (Number.isNaN(parsed.getTime())) errors.push('asOf_invalid');
    else asOf = parsed;
  }
  if (asOf.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) errors.push('asOf_future');

  const period = String(query.period || query.billingPeriod || '7d').trim().toLowerCase();
  if (period && !KNOWN_PERIODS.has(period) && query.days == null) {
    errors.push('period_unknown');
  }

  const anchorDayAr = formatDayArInArgentina(asOf);
  let startDayAr = null;
  let endDayAr = null;
  let days = null;

  if (period === 'today') {
    startDayAr = anchorDayAr;
    endDayAr = anchorDayAr;
  } else if (period === 'yesterday') {
    endDayAr = addDaysDayAr(anchorDayAr, -1);
    startDayAr = endDayAr;
  } else if (period === '7d') {
    days = 7;
    endDayAr = anchorDayAr;
    startDayAr = addDaysDayAr(endDayAr, -(days - 1));
  } else if (period === '30d') {
    days = 30;
    endDayAr = anchorDayAr;
    startDayAr = addDaysDayAr(endDayAr, -(days - 1));
  } else if (period === 'current_month') {
    const month = monthKeyArgentina(anchorDayAr);
    if (!month) errors.push('anchor_invalid');
    else {
      startDayAr = `${month}-01`;
      endDayAr = anchorDayAr;
    }
  } else if (period === 'previous_month') {
    const anchorDate = parseDateOnly(anchorDayAr);
    const prev = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() - 1, 1));
    const month = monthKeyArgentina(prev.toISOString().slice(0, 10));
    if (!month) errors.push('previous_month_invalid');
    else {
      startDayAr = `${month}-01`;
      endDayAr = lastDayOfMonthYm(month);
    }
  } else if (period === 'custom') {
    if (query.startDay) {
      const value = String(query.startDay).trim();
      if (!ISO_DAY.test(value)) errors.push('startDay_invalid');
      else startDayAr = value;
    } else {
      errors.push('startDay_required');
    }
    if (query.endDay) {
      const value = String(query.endDay).trim();
      if (!ISO_DAY.test(value)) errors.push('endDay_invalid');
      else endDayAr = value;
    } else {
      errors.push('endDay_required');
    }
    if (startDayAr && endDayAr && startDayAr > endDayAr) errors.push('day_range_inverted');
  } else if (query.days != null) {
    days = clampMetricsDays(query.days);
    if (Number(query.days) !== days) errors.push('days_out_of_range');
    endDayAr = anchorDayAr;
    startDayAr = addDaysDayAr(endDayAr, -(days - 1));
  } else {
    days = 7;
    endDayAr = anchorDayAr;
    startDayAr = addDaysDayAr(endDayAr, -(days - 1));
  }

  if (!errors.length && startDayAr && endDayAr) {
    const span = daysInclusive(startDayAr, endDayAr);
    if (span == null || span < 1) errors.push('day_range_invalid');
    else if (span > 90) errors.push('day_range_exceeds_max');
    else days = span;
  }

  if (errors.length) {
    return {
      ok: false,
      errors,
      period,
      asOf,
      days: days ?? clampMetricsDays(query.days),
      startDayAr,
      endDayAr,
    };
  }

  const window = dayArToUtcBounds(startDayAr, endDayAr);

  return {
    ok: true,
    errors: [],
    period,
    asOf,
    days,
    startDayAr,
    endDayAr,
    window,
    fetchUsage: String(query.fetchUsage ?? 'false').toLowerCase() === 'true',
    persistAggregates: String(query.persistAggregates ?? 'false').toLowerCase() === 'true',
  };
}

export default {
  resolveEffectiveBillingPeriod,
  formatDayArInArgentina,
  dayArToUtcBounds,
  daysInclusive,
  addDaysDayAr,
};