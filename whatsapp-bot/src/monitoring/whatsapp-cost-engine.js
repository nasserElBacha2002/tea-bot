import { config } from '../config.js';
import { loadRateCard } from './whatsapp-rate-card.js';
import {
  applyServiceFreeTier,
  isFullCalendarMonthCoverage,
  metaFeeForServiceMessage,
  resolveMetaPricingRegime,
  twilioPlatformFeePerMessage,
} from './whatsapp-pricing-regime.js';
import { fromMicroUsd, mulCount, roundUsd4, toMicroUsd } from './whatsapp-money.js';

export const SERVICE_PROXY_QUALITY = 'inferred_service_from_whatsapp_outbound';

/**
 * Estima costos locales por día a partir de conteos SQL (no sustituye facturación Twilio).
 */
export function estimateDayCostFromSqlRow(row, {
  rateCard = loadRateCard(),
  freeTierUsedBeforeDay = null,
  monthServiceKnown = false,
  fullCalendarMonth = false,
} = {}) {
  const regime = resolveMetaPricingRegime(row.dayAr);
  const platformRate = twilioPlatformFeePerMessage(rateCard);
  const inbound = Number(row.inbound) || 0;
  const waOutbound = Number(row.whatsappOutbound) || 0;
  const platformMicro = toMicroUsd(platformRate);

  const twilioMicro = platformMicro == null
    ? null
    : addMicroParts(mulCount(platformMicro, inbound), mulCount(platformMicro, waOutbound));

  const metaServiceCount = waOutbound;
  let metaMicro = null;
  let metaQuality = 'non_determinable';
  let metaReason = 'META_SERVICE_PROXY_WITHOUT_TEMPLATE_DIMENSION';
  let freeTier = null;

  if (regime === 'meta-legacy') {
    const fee = metaFeeForServiceMessage({ regime, rateCard, inCustomerWindow: true });
    metaMicro = mulCount(toMicroUsd(fee.metaFeeUsd ?? 0), metaServiceCount);
    metaQuality = 'estimated_legacy_zero';
    metaReason = 'META_LEGACY_NO_CHARGE_SERVICE_WINDOW';
  } else if (freeTierUsedBeforeDay == null && !monthServiceKnown) {
    metaQuality = 'non_determinable';
    metaReason = 'FREE_TIER_PRIOR_MONTH_CONSUMPTION_UNKNOWN';
  } else {
    const usedBefore = freeTierUsedBeforeDay ?? 0;
    let remainingBudget = Math.max(0, 1000 - usedBefore);
    let billable = 0;
    let freeApplied = 0;
    for (let i = 0; i < metaServiceCount; i += 1) {
      if (remainingBudget > 0) {
        remainingBudget -= 1;
        freeApplied += 1;
      } else {
        billable += 1;
      }
    }
    const serviceFee = metaFeeForServiceMessage({ regime, rateCard, inCustomerWindow: true });
    metaMicro = mulCount(toMicroUsd(serviceFee.metaFeeUsd), billable);
    metaQuality = serviceFee.quality === 'fixture_illustrative'
      ? 'estimated_fixture_rate'
      : 'estimated_computed';
    metaReason = SERVICE_PROXY_QUALITY;
    freeTier = {
      serviceMessagesInDay: metaServiceCount,
      freeAppliedInDay: freeApplied,
      billableInDay: billable,
      freeTierUsedBeforeDay: usedBefore,
      freeTierRemainingAfterDay: remainingBudget,
      quality: monthServiceKnown || fullCalendarMonth ? 'computed' : 'partial_month_mtd',
    };
  }

  const twilioUsd = fromMicroUsd(twilioMicro);
  const metaUsd = fromMicroUsd(metaMicro);
  const totalMicro = twilioMicro == null && metaMicro == null
    ? null
    : (twilioMicro ?? 0) + (metaMicro ?? 0);

  return {
    dayAr: row.dayAr,
    messages: {
      inbound,
      whatsappOutbound: waOutbound,
      outboundBot: row.outboundBot,
      outboundAgent: row.outboundAgent,
    },
    costs: {
      twilioEstimatedUsd: roundUsd4(twilioUsd),
      twilioEstimatedQuality: twilioUsd == null ? 'unavailable' : 'estimated_sql_proxy',
      metaEstimatedUsd: roundUsd4(metaUsd),
      metaEstimatedQuality: metaQuality,
      metaEstimatedReason: metaReason,
      totalEstimatedUsd: roundUsd4(fromMicroUsd(totalMicro)),
      totalEstimatedQuality: totalMicro == null ? 'unavailable' : 'estimated_sql_proxy',
      regime,
      metaServiceFreeTier: freeTier || applyServiceFreeTier({
        regime,
        serviceMessageCount: metaServiceCount,
        freeTierUsedInMonth: freeTierUsedBeforeDay ?? 0,
        fullCalendarMonth,
        phoneNumberScoped: Boolean(config.twilioWhatsappFrom),
      }),
      automaticOutboundNote: 'outboundBot tratado como automático en desglose UI.',
      manualOutboundNote: 'outboundAgent puede incluir SID Twilio; misma proxy service Meta.',
    },
  };
}

function addMicroParts(a, b) {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Empaqueta estimaciones SQL con franquicia acumulada (compartido audit + dashboard).
 */
export function buildSqlCostEstimatePack(metrics, priorMonthProxy = { count: null, quality: 'unavailable' }) {
  if (!metrics?.daily?.length) {
    return {
      estimatesPack: { daily: [], finalFreeTierUsed: null, byMonth: {} },
      monthServiceKnown: false,
      priorMonthProxy,
    };
  }
  const firstMonth = String(metrics.window?.startDayAr || '').slice(0, 7);
  const windowStartsMonth = metrics.window?.startDayAr?.endsWith('-01');
  const priorKnown = priorMonthProxy.quality === 'sql_service_proxy'
    || (windowStartsMonth && priorMonthProxy.count === 0);
  const priorCount = priorKnown ? (priorMonthProxy.count ?? 0) : null;
  const estimatesPack = estimateWindowCostsFromSql(metrics.daily, metrics.window, {
    serviceMessagesBeforeWindow: priorCount ?? 0,
    monthServiceKnown: priorKnown,
    priorMonthProxyQuality: priorMonthProxy.quality,
    fullCalendarMonth: isFullCalendarMonthCoverage(metrics.window),
    firstMonthKey: firstMonth,
  });
  return {
    estimatesPack,
    monthServiceKnown: priorKnown,
    priorMonthProxy,
  };
}

export function mapCostEstimateToAuditDaily(estimated, sourceRow) {
  return {
    dayAr: estimated.dayAr,
    messages: {
      inbound: estimated.messages.inbound,
      whatsappOutbound: estimated.messages.whatsappOutbound,
      outboundBot: estimated.messages.outboundBot,
      outboundAgent: estimated.messages.outboundAgent,
      outboundSystem: sourceRow?.outboundSystem ?? 0,
    },
    costs: {
      ...estimated.costs,
      twilioUsd: estimated.costs.twilioEstimatedUsd,
      metaUsd: estimated.costs.metaEstimatedUsd,
      totalUsd: estimated.costs.totalEstimatedUsd,
      twilioQuality: estimated.costs.twilioEstimatedQuality,
      metaQuality: estimated.costs.metaEstimatedQuality,
      totalQuality: estimated.costs.totalEstimatedQuality,
    },
  };
}

export function estimateWindowCostsFromSql(dailyRows, metricsWindow, options = {}) {
  const sorted = [...(dailyRows || [])].sort((a, b) => String(a.dayAr).localeCompare(String(b.dayAr)));
  const firstMonthKey = options.firstMonthKey || String(sorted[0]?.dayAr || '').slice(0, 7);
  let activeMonth = null;
  let freeTierUsed = 0;
  let monthServiceKnown = false;
  const fullMonth = options.fullCalendarMonth === true;
  const results = [];
  const byMonth = {};

  for (const row of sorted) {
    const month = String(row.dayAr || '').slice(0, 7);
    if (activeMonth !== month) {
      if (activeMonth === null && month === firstMonthKey) {
        monthServiceKnown = options.monthServiceKnown === true;
        freeTierUsed = monthServiceKnown ? (options.serviceMessagesBeforeWindow ?? 0) : 0;
      } else {
        monthServiceKnown = true;
        freeTierUsed = 0;
      }
      activeMonth = month;
      byMonth[month] = { freeTierUsedStart: freeTierUsed, monthServiceKnown };
    }

    const estimate = estimateDayCostFromSqlRow(row, {
      freeTierUsedBeforeDay: monthServiceKnown ? freeTierUsed : null,
      monthServiceKnown,
      fullCalendarMonth: fullMonth,
    });
    if (estimate.costs.metaServiceFreeTier?.freeAppliedInDay != null) {
      freeTierUsed += estimate.costs.metaServiceFreeTier.freeAppliedInDay;
    } else if (monthServiceKnown) {
      freeTierUsed += Number(row.whatsappOutbound) || 0;
    }
    results.push(estimate);
    byMonth[month] = {
      ...byMonth[month],
      freeTierUsedEnd: freeTierUsed,
    };
  }

  const lastMonth = sorted.length ? String(sorted[sorted.length - 1].dayAr).slice(0, 7) : null;
  const lastMonthKnown = lastMonth ? byMonth[lastMonth]?.monthServiceKnown : false;

  return {
    daily: results,
    monthKey: sorted[0] ? String(sorted[0].dayAr).slice(0, 7) : null,
    finalFreeTierUsed: lastMonthKnown ? freeTierUsed : null,
    byMonth,
    priorMonthProxyQuality: options.priorMonthProxyQuality || null,
  };
}

export function summarizeEstimatedCosts(dailyEstimates) {
  let twilioMicro = 0;
  let metaMicro = 0;
  let hasTwilio = false;
  let hasMeta = false;
  let unknownMetaDays = 0;
  let unknownTwilioDays = 0;
  let inbound = 0;
  let outbound = 0;
  let outboundBot = 0;
  let outboundAgent = 0;
  let freeApplied = 0;
  let billableService = 0;
  let messagesInCostAverage = 0;

  for (const row of dailyEstimates || []) {
    inbound += row.messages?.inbound ?? 0;
    outbound += row.messages?.whatsappOutbound ?? 0;
    outboundBot += row.messages?.outboundBot ?? 0;
    outboundAgent += row.messages?.outboundAgent ?? 0;

  const twilioUsd = row.costs?.twilioEstimatedUsd;
    const metaUsd = row.costs?.metaEstimatedUsd;
    const metaQuality = row.costs?.metaEstimatedQuality;
    const twilioQuality = row.costs?.twilioEstimatedQuality;

    let rowMsgDenominator = 0;
    if (Number.isFinite(twilioUsd)) {
      twilioMicro += toMicroUsd(twilioUsd) ?? 0;
      hasTwilio = true;
      rowMsgDenominator += (row.messages?.inbound ?? 0) + (row.messages?.whatsappOutbound ?? 0);
    } else if (twilioQuality === 'unavailable') {
      unknownTwilioDays += 1;
    }

    if (Number.isFinite(metaUsd)) {
      metaMicro += toMicroUsd(metaUsd) ?? 0;
      hasMeta = true;
      if (!Number.isFinite(twilioUsd)) {
        rowMsgDenominator += row.messages?.whatsappOutbound ?? 0;
      }
    } else if (metaQuality === 'non_determinable' || metaQuality === 'unavailable') {
      unknownMetaDays += 1;
    }
    messagesInCostAverage += rowMsgDenominator;

    const tier = row.costs?.metaServiceFreeTier;
    if (tier?.freeAppliedInDay != null) {
      freeApplied += tier.freeAppliedInDay;
      billableService += tier.billableInDay ?? 0;
    }
  }

  const dayCount = dailyEstimates?.length ?? 0;
  const knownSubtotalMicro = (hasTwilio ? twilioMicro : 0) + (hasMeta ? metaMicro : 0);
  const knownSubtotal = knownSubtotalMicro > 0 || hasTwilio || hasMeta
    ? fromMicroUsd(knownSubtotalMicro)
    : null;
  const totalComplete = (unknownMetaDays === 0 && unknownTwilioDays === 0)
    && (hasTwilio || hasMeta);

  let avgPerMessageUsd = null;
  if (knownSubtotal != null && messagesInCostAverage > 0) {
    avgPerMessageUsd = roundUsd4(knownSubtotal / messagesInCostAverage);
  }

  return {
    inbound,
    outbound,
    outboundBot,
    outboundAgent,
    freeServiceMessages: freeApplied,
    billableServiceMessages: billableService,
    twilioEstimatedUsd: hasTwilio ? roundUsd4(fromMicroUsd(twilioMicro)) : null,
    metaEstimatedUsd: hasMeta ? roundUsd4(fromMicroUsd(metaMicro)) : null,
    knownSubtotalUsd: knownSubtotal == null ? null : roundUsd4(knownSubtotal),
    totalEstimatedUsd: totalComplete && knownSubtotal != null ? roundUsd4(knownSubtotal) : null,
    totalCompleteness: totalComplete ? 'complete' : 'partial',
    unknownMetaDays,
    unknownTwilioDays,
    avgDailyUsd: knownSubtotal == null || dayCount === 0 ? null : roundUsd4(knownSubtotal / dayCount),
    avgPerMessageUsd,
    quality: 'estimated_sql_proxy',
    disclaimer: 'Estimación local desde conteos SQL; no es cargo registrado por Twilio/Meta.',
  };
}

export function buildBalanceIndicators(balanceUsd, cfg = config) {
  const threshold = cfg.twilioBalanceCriticalUsd ?? 10;
  const warning = cfg.twilioBalanceWarningUsd ?? 20;
  const referenceInitial = 20;
  const rechargeAmount = 10;
  if (balanceUsd == null) {
    return {
      available: false,
      quality: 'unavailable',
      referenceInitialUsd: referenceInitial,
      rechargeThresholdUsd: threshold,
      rechargeAmountUsd: rechargeAmount,
    };
  }
  const numeric = Number(balanceUsd);
  let severity = 'healthy';
  if (numeric <= (cfg.twilioBalanceEmergencyUsd ?? 5)) severity = 'emergency';
  else if (numeric <= threshold) severity = 'critical';
  else if (numeric <= warning) severity = 'warning';
  const estimatedRechargeAt = numeric <= threshold
    ? 'threshold_breached'
    : null;
  return {
    available: true,
    quality: 'confirmed_provider',
    balanceUsd: roundUsd4(numeric),
    severity,
    referenceInitialUsd: referenceInitial,
    rechargeThresholdUsd: threshold,
    rechargeAmountUsd: rechargeAmount,
    estimatedNextRechargeAt: estimatedRechargeAt,
    alertsPrepared: {
      belowThreshold: numeric <= threshold,
      critical: numeric <= threshold,
      franchise80: null,
      franchiseExhausted: null,
      reconciliationGap: null,
      staleBilling: null,
    },
  };
}

export default {
  estimateDayCostFromSqlRow,
  estimateWindowCostsFromSql,
  buildSqlCostEstimatePack,
  mapCostEstimateToAuditDaily,
  summarizeEstimatedCosts,
  buildBalanceIndicators,
};