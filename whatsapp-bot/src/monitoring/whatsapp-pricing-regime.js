/** Meta pricing change effective 2026-10-01 (Twilio Help Center 53100480177819). */
export const META_PRICING_V2_EFFECTIVE = '2026-10-01';

export function parseDateOnly(value) {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const text = String(value || '').slice(0, 10);
  const [y, m, d] = text.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export function resolveMetaPricingRegime(asOf) {
  const day = parseDateOnly(asOf);
  const cutoff = parseDateOnly(META_PRICING_V2_EFFECTIVE);
  if (!day || !cutoff) return 'unknown';
  return day >= cutoff ? 'meta-2026-10' : 'meta-legacy';
}

export function monthKeyArgentina(dayAr) {
  const text = String(dayAr || '').slice(0, 7);
  return /^\d{4}-\d{2}$/.test(text) ? text : null;
}

export function lastDayOfMonthYm(monthYm) {
  const [y, m] = String(monthYm).split('-').map(Number);
  if (!y || !m) return null;
  const last = new Date(Date.UTC(y, m, 0));
  const d = last.getUTCDate();
  return `${monthYm}-${String(d).padStart(2, '0')}`;
}

/** Cobertura de mes civil AR completo en la ventana de métricas. */
export function isFullCalendarMonthCoverage(window) {
  if (!window?.startDayAr || !window?.endDayAr) return false;
  const month = monthKeyArgentina(window.startDayAr);
  if (!month || month !== monthKeyArgentina(window.endDayAr)) return false;
  return window.startDayAr === `${month}-01`
    && window.endDayAr === lastDayOfMonthYm(month);
}

/**
 * Franquicia 1.000 service messages gratis por número/mes (desde 2026-10-01).
 * No aplicar con ventana parcial o sin número de negocio identificado.
 */
export function applyServiceFreeTier({
  regime,
  serviceMessageCount,
  freeTierUsedInMonth = 0,
  freeAllowance = 1000,
  fullCalendarMonth = false,
  phoneNumberScoped = false,
}) {
  if (!fullCalendarMonth || !phoneNumberScoped) {
    return {
      quality: 'non_determinable',
      metaBillable: null,
      metaFreeApplied: null,
      freeTierRemaining: null,
      regimeNote: 'Franquicia requiere mes civil completo y número WhatsApp de negocio.',
    };
  }

  const count = Math.max(0, Number(serviceMessageCount) || 0);
  if (regime !== 'meta-2026-10') {
    return {
      quality: 'regime_legacy',
      metaBillable: 0,
      metaFreeApplied: count,
      freeTierRemaining: null,
      regimeNote: 'En régimen legacy Meta no cobra service en ventana 24h.',
    };
  }
  const used = Math.max(0, Number(freeTierUsedInMonth) || 0);
  const remaining = Math.max(0, freeAllowance - used);
  const metaFreeApplied = Math.min(count, remaining);
  const metaBillable = count - metaFreeApplied;
  return {
    quality: 'computed',
    metaBillable,
    metaFreeApplied,
    freeTierRemaining: remaining - metaFreeApplied,
    regimeNote: 'Franquicia mensual por número; no arrastra mes anterior.',
  };
}

export function metaFeeForServiceMessage({ regime, rateCard, inCustomerWindow = true }) {
  if (!inCustomerWindow) {
    return { metaFeeUsd: null, quality: 'not_applicable', reason: 'SERVICE_OUTSIDE_WINDOW' };
  }
  if (regime === 'meta-legacy') {
    return {
      metaFeeUsd: rateCard?.metaRegimes?.['legacyBefore2026-10-01']?.rules?.serviceInCustomerWindow
        ?.metaFeePerMessageUsd ?? 0,
      quality: 'regime_legacy',
    };
  }
  const rate = rateCard?.metaRegimes?.['from2026-10-01']?.rules?.serviceInCustomerWindow?.metaFeePerMessageUsd;
  return rate == null
    ? { metaFeeUsd: null, quality: 'missing_rate', reason: 'NO_RATE_CARD' }
    : { metaFeeUsd: rate, quality: 'fixture_illustrative', reason: 'NOT_OPERATIONAL_RATE' };
}

export function metaFeeForUtilityTemplate({ regime, rateCard, inCustomerWindow }) {
  if (regime === 'meta-legacy' && inCustomerWindow) {
    return {
      metaFeeUsd: rateCard?.metaRegimes?.['legacyBefore2026-10-01']?.rules?.utilityInCustomerWindow
        ?.metaFeePerMessageUsd ?? 0,
      quality: 'regime_legacy',
    };
  }
  const key = inCustomerWindow ? 'utilityInCustomerWindow' : 'utilityOutsideWindow';
  const rate = rateCard?.metaRegimes?.['from2026-10-01']?.rules?.[key]?.metaFeePerMessageUsd;
  return rate == null
    ? { metaFeeUsd: null, quality: 'missing_rate', reason: 'NO_RATE_CARD' }
    : { metaFeeUsd: rate, quality: 'fixture_illustrative', reason: 'NOT_OPERATIONAL_RATE' };
}

export function twilioPlatformFeePerMessage(rateCard) {
  const fee = rateCard?.twilioPlatformFee?.perMessageUsd;
  return Number.isFinite(Number(fee)) ? Number(fee) : null;
}