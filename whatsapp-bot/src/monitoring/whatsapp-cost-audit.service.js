import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { collectTwilioSnapshot } from './twilio-monitor.client.js';
import { getDailyWhatsAppMetrics, TEMPLATE_METRIC_LIMITATION } from './whatsapp-daily-metrics.js';
import { loadRateCard, rateCardMetaLimitation } from './whatsapp-rate-card.js';
import {
  applyServiceFreeTier,
  isFullCalendarMonthCoverage,
  monthKeyArgentina,
  resolveMetaPricingRegime,
  twilioPlatformFeePerMessage,
} from './whatsapp-pricing-regime.js';
import { fetchTwilioUsageRecords } from './twilio-usage.client.js';

function round4(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function formatUsageWindow(window) {
  if (!window?.startUtc || !window?.endUtcExclusive) return { startDate: null, endDate: null };
  const start = new Date(window.startUtc);
  const endExclusive = new Date(window.endUtcExclusive);
  const end = new Date(endExclusive.getTime() - 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function estimateDailyCostsFromSql(dailyRows, rateCard, metricsWindow) {
  const twilioPerMsg = twilioPlatformFeePerMessage(rateCard);
  const fullMonth = isFullCalendarMonthCoverage(metricsWindow);
  const phoneScoped = Boolean(config.twilioWhatsappFrom);

  return dailyRows.map((row) => {
    const regime = resolveMetaPricingRegime(row.dayAr);
    const twilioMsgCount = row.inbound + row.whatsappOutbound;
    const twilioEstimated = twilioPerMsg == null ? null : round4(twilioMsgCount * twilioPerMsg);

    const franchise = applyServiceFreeTier({
      regime,
      serviceMessageCount: null,
      fullCalendarMonth: fullMonth,
      phoneNumberScoped: phoneScoped,
    });

    return {
      dayAr: row.dayAr,
      messages: {
        inbound: row.inbound,
        whatsappOutbound: row.whatsappOutbound,
        outboundBot: row.outboundBot,
        outboundAgent: row.outboundAgent,
        outboundSystem: row.outboundSystem,
      },
      costs: {
        twilioEstimatedUsd: twilioEstimated,
        twilioEstimatedQuality: twilioEstimated == null ? 'unavailable' : 'estimated_platform_fee_only',
        metaEstimatedUsd: null,
        metaEstimatedQuality: 'non_determinable',
        metaEstimatedReason: 'META_SERVICE_NOT_INFERABLE_FROM_SQL',
        totalEstimatedUsd: twilioEstimated,
        totalEstimatedQuality: twilioEstimated == null ? 'unavailable' : 'partial_estimated',
        regime,
        metaServiceFreeTier: franchise,
        whatsappOutboundNote:
          'whatsappOutbound incluye bot/agent; no implica service Meta facturable sin ventana 24h.',
      },
    };
  });
}

function mergeDailyCosts(messageDaily, usageDaily, estimates, usageGranular) {
  const byDay = new Map();
  for (const row of messageDaily) {
    byDay.set(row.dayAr, {
      dayAr: row.dayAr,
      messages: row,
      costs: {
        twilioUsd: null,
        metaUsd: null,
        totalUsd: null,
        twilioQuality: 'unavailable',
        metaQuality: 'unavailable',
        totalQuality: 'unavailable',
      },
    });
  }
  for (const est of estimates) {
    const slot = byDay.get(est.dayAr) || { dayAr: est.dayAr, messages: est.messages, costs: {} };
    slot.messages = { ...slot.messages, ...est.messages };
    slot.costs = {
      ...slot.costs,
      twilioEstimatedUsd: est.costs.twilioEstimatedUsd,
      twilioEstimatedQuality: est.costs.twilioEstimatedQuality,
      metaEstimatedUsd: est.costs.metaEstimatedUsd,
      metaEstimatedQuality: est.costs.metaEstimatedQuality,
      metaEstimatedReason: est.costs.metaEstimatedReason,
      totalEstimatedUsd: est.costs.totalEstimatedUsd,
      totalEstimatedQuality: est.costs.totalEstimatedQuality,
      regime: est.costs.regime,
      metaServiceFreeTier: est.costs.metaServiceFreeTier,
    };
    byDay.set(est.dayAr, slot);
  }
  if (usageGranular) {
    for (const row of usageDaily || []) {
      const slot = byDay.get(row.dayAr) || { dayAr: row.dayAr, messages: null, costs: {} };
      slot.costs = {
        ...slot.costs,
        twilioUsd: row.twilioUsd,
        metaUsd: row.metaUsd,
        totalUsd: row.totalUsd,
        twilioQuality: row.twilioQuality,
        metaQuality: row.metaQuality,
        totalQuality: row.totalQuality,
      };
      byDay.set(row.dayAr, slot);
    }
  }
  return [...byDay.values()].sort((a, b) => String(a.dayAr).localeCompare(String(b.dayAr)));
}

function buildReconciliation(metrics, usageSummary, usageFetch) {
  const sqlOutbound = metrics.daily.reduce((sum, row) => sum + row.whatsappOutbound, 0);
  const sqlInbound = metrics.daily.reduce((sum, row) => sum + row.inbound, 0);
  const botSynthetic = metrics.daily.reduce((sum, row) => sum + row.outboundBot, 0);
  const agentWithPossibleSid = metrics.daily.reduce((sum, row) => sum + row.outboundAgent, 0);

  const usageCount = usageSummary?.categories
    ?.filter((row) => row.whatsappScope && row.bucket === 'twilio_whatsapp')
    .reduce((sum, row) => sum + (row.count || 0), 0) ?? null;

  return {
    status: usageSummary ? 'compared' : 'pending_usage',
    usageCompleteness: usageFetch?.completeness || (usageFetch?.truncated ? 'partial_truncated' : null),
    sql: {
      inboundPersisted: sqlInbound,
      whatsappOutboundPersisted: sqlOutbound,
      outboundBotPersisted: botSynthetic,
      outboundAgentPersisted: agentWithPossibleSid,
      note: 'Persistido ≠ facturado. Bot TwiML puede no tener SID Twilio.',
    },
    provider: usageSummary
      ? {
          confirmedTwilioUsd: usageSummary.confirmedTwilioUsd,
          confirmedMetaUsd: usageSummary.confirmedMetaUsd,
          totalControlUsd: usageSummary.confirmedTotalControlUsd,
          prepaidRechargeUsd: usageSummary.prepaidRechargeUsd,
          excludedNonWhatsappUsd: usageSummary.excludedNonWhatsappUsd,
          whatsappMessagingUnits: usageCount,
          dailyGranularityAvailable: usageSummary.dailyGranularityAvailable,
        }
      : null,
    nonReconcilable: {
      templates: TEMPLATE_METRIC_LIMITATION,
      twimlBotWithoutTwilioSid: botSynthetic,
      systemInternalMessages: metrics.daily.reduce((sum, row) => sum + row.outboundSystem, 0),
      metaServiceFromSql: 'non_determinable',
    },
    variance: usageSummary
      ? {
          messageCountDelta: usageCount == null ? null : usageCount - (sqlInbound + sqlOutbound),
          note: 'Diferencia esperada por TwiML, mensajes fuera de SQL o granularidad usage.',
        }
      : null,
    doubleCountingGuard:
      'Usar totalControlUsd como control. No sumar totalControl con desglose Twilio+Meta ni con estimaciones SQL.',
  };
}

function monthlyTotalsByCalendarMonth(dailyMerged) {
  const months = new Map();

  for (const row of dailyMerged) {
    const key = monthKeyArgentina(row.dayAr);
    if (!key) continue;
    const slot = months.get(key) || {
      monthAr: key,
      twilioConfirmedUsd: 0,
      metaConfirmedUsd: 0,
      twilioEstimatedUsd: 0,
      metaEstimatedUsd: 0,
      hasConfirmedTwilio: false,
      hasConfirmedMeta: false,
      hasEstimatedTwilio: false,
      hasEstimatedMeta: false,
    };

    if (Number.isFinite(row.costs?.twilioUsd)) {
      slot.twilioConfirmedUsd += row.costs.twilioUsd;
      slot.hasConfirmedTwilio = true;
    }
    if (Number.isFinite(row.costs?.metaUsd)) {
      slot.metaConfirmedUsd += row.costs.metaUsd;
      slot.hasConfirmedMeta = true;
    }
    if (Number.isFinite(row.costs?.twilioEstimatedUsd)) {
      slot.twilioEstimatedUsd += row.costs.twilioEstimatedUsd;
      slot.hasEstimatedTwilio = true;
    }

    months.set(key, slot);
  }

  return [...months.values()].map((slot) => ({
    monthAr: slot.monthAr,
    twilioUsd: slot.hasConfirmedTwilio ? round4(slot.twilioConfirmedUsd) : null,
    metaUsd: slot.hasConfirmedMeta ? round4(slot.metaConfirmedUsd) : null,
    totalConfirmedUsd: slot.hasConfirmedTwilio || slot.hasConfirmedMeta
      ? round4(slot.twilioConfirmedUsd + slot.metaConfirmedUsd)
      : null,
    twilioEstimatedUsd: slot.hasEstimatedTwilio ? round4(slot.twilioEstimatedUsd) : null,
    metaEstimatedUsd: null,
    totalEstimatedUsd: slot.hasEstimatedTwilio ? round4(slot.twilioEstimatedUsd) : null,
    metaEstimatedQuality: 'non_determinable',
  }));
}

/**
 * @param {{ days?: number, asOf?: Date, fetchUsage?: boolean, metricsOverride?: object }} options
 */
export async function getWhatsAppCostAudit(options = {}) {
  const days = options.days ?? 30;
  const asOf = options.asOf instanceof Date ? options.asOf : new Date();
  const rateCard = loadRateCard();
  const rateCardInfo = rateCardMetaLimitation(rateCard);

  let metrics = options.metricsOverride || null;
  if (!metrics && isConversationDbEnabled()) {
    metrics = await getDailyWhatsAppMetrics({ days, asOf });
  }

  const usageWindow = metrics ? formatUsageWindow(metrics.window) : null;
  let usage = null;
  const shouldFetch = options.fetchUsage !== false && config.monitoringTwilioEnabled;
  if (!shouldFetch) {
    usage = { ok: false, error: 'twilio_usage_disabled', records: [], summary: null, truncated: false };
  } else if (usageWindow?.startDate && usageWindow?.endDate) {
    usage = await fetchTwilioUsageRecords({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      startDate: usageWindow.startDate,
      endDate: usageWindow.endDate,
      request: options.usageRequest,
    });
  } else if (!config.monitoringTwilioEnabled) {
    usage = { ok: false, error: 'twilio_usage_disabled', records: [], summary: null, truncated: false };
  } else {
    usage = { ok: false, error: 'missing_metrics_window', records: [], summary: null, truncated: false };
  }

  let balance = null;
  if (shouldFetch) {
    const snapshot = await collectTwilioSnapshot({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromAddress: config.twilioWhatsappFrom,
      request: options.twilioRequest,
    });
    balance = snapshot.ok
      ? {
          usd: snapshot.balance,
          currency: snapshot.currency,
          quality: 'confirmed_provider',
          note: 'Saldo prepago; recargas no son gasto (ver prepaidRechargeUsd en usage).',
        }
      : { usd: null, quality: 'unavailable', error: snapshot.error };
  }

  const estimates = metrics
    ? estimateDailyCostsFromSql(metrics.daily, rateCard, metrics.window)
    : [];
  const usageGranular = Boolean(usage?.summary?.dailyGranularityAvailable);
  const daily = metrics
    ? mergeDailyCosts(
      metrics.daily,
      usage?.summary?.daily || [],
      estimates,
      usageGranular,
    )
    : [];

  const reconciliation = buildReconciliation(
    metrics || { daily: [] },
    usage?.ok ? usage.summary : null,
    usage,
  );

  const monthlyByCalendar = monthlyTotalsByCalendarMonth(daily);

  const providerUsage = usage?.ok
    ? {
      quality: usage.truncated ? 'partial_truncated' : 'confirmed_provider',
      completeness: usage.completeness,
      truncated: usage.truncated,
      ...usage.summary,
    }
    : {
      quality: usage?.error === 'twilio_usage_disabled' ? 'disabled' : 'unavailable',
      error: usage?.error || 'not_fetched',
    };

  return {
    generatedAt: new Date().toISOString(),
    asOfUtc: asOf.toISOString(),
    days,
    window: metrics?.window || null,
    presentationTimeZone: metrics?.window?.presentationTimeZone || 'Argentina Standard Time',
    templates: TEMPLATE_METRIC_LIMITATION,
    rateCard: rateCardInfo,
    messages: {
      daily: metrics?.daily || [],
      deliveryByDay: metrics?.deliveryByDay || [],
      definitions: metrics?.definitions || null,
    },
    costs: {
      daily,
      monthlyByCalendar,
      providerUsage,
    },
    prepaidBalance: balance,
    reconciliation,
    limitations: [
      TEMPLATE_METRIC_LIMITATION,
      {
        available: false,
        reason: 'SQL_BOT_TWIML_NOT_TWILIO_SID',
        detail: 'Estimación SQL cubre solo fee plataforma Twilio; Meta service no se infiere de whatsappOutbound.',
      },
    ],
  };
}

export default { getWhatsAppCostAudit };