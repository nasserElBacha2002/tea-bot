import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { collectTwilioSnapshot } from './twilio-monitor.client.js';
import { getDailyWhatsAppMetrics, TEMPLATE_METRIC_LIMITATION } from './whatsapp-daily-metrics.js';
import { loadRateCard, rateCardMetaLimitation } from './whatsapp-rate-card.js';
import {
  applyServiceFreeTier,
  isFullCalendarMonthCoverage,
  lastDayOfMonthYm,
  monthKeyArgentina,
  resolveMetaPricingRegime,
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

function monthWindowCoverage(metricsWindow, monthAr) {
  if (!metricsWindow?.startDayAr || !metricsWindow?.endDayAr || !monthAr) {
    return { coverage: 'unknown', quality: 'unavailable' };
  }
  const monthStart = `${monthAr}-01`;
  const monthEnd = lastDayOfMonthYm(monthAr);
  const coversStart = metricsWindow.startDayAr <= monthStart;
  const coversEnd = metricsWindow.endDayAr >= monthEnd;
  if (coversStart && coversEnd) return { coverage: 'full_month', quality: 'full_calendar_month' };
  return { coverage: 'partial_month', quality: 'partial_month' };
}

function estimateDailyCostsFromSql(dailyRows, metricsWindow) {
  const fullMonth = isFullCalendarMonthCoverage(metricsWindow);
  const phoneScoped = Boolean(config.twilioWhatsappFrom);

  return dailyRows.map((row) => {
    const regime = resolveMetaPricingRegime(row.dayAr);
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
        twilioEstimatedUsd: null,
        twilioEstimatedQuality: 'unavailable',
        twilioEstimatedReason: 'NO_CONFIRMED_RATE_WITHOUT_USAGE_OR_CONTRACT',
        metaEstimatedUsd: null,
        metaEstimatedQuality: 'non_determinable',
        metaEstimatedReason: 'META_SERVICE_NOT_INFERABLE_FROM_SQL',
        totalEstimatedUsd: null,
        totalEstimatedQuality: 'unavailable',
        regime,
        metaServiceFreeTier: franchise,
        whatsappOutboundNote:
          'whatsappOutbound incluye bot/agent; no implica service Meta facturable sin ventana 24h.',
      },
    };
  });
}

function mergeDailyMessageAndEstimates(messageDaily, estimates) {
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
    slot.costs = { ...slot.costs, ...est.costs };
    byDay.set(est.dayAr, slot);
  }
  return [...byDay.values()].sort((a, b) => String(a.dayAr).localeCompare(String(b.dayAr)));
}

function usageFetchQuality(usage) {
  if (!usage?.ok) return usage?.error === 'twilio_usage_disabled' ? 'disabled' : 'unavailable';
  if (usage.truncated || usage.completeness === 'partial_truncated') return 'partial_truncated';
  return 'confirmed_provider';
}

function buildReconciliation(metrics, usageSummary, usageFetch) {
  const partial = usageFetchQuality(usageFetch) === 'partial_truncated';
  const sqlOutbound = metrics.daily.reduce((sum, row) => sum + row.whatsappOutbound, 0);
  const sqlInbound = metrics.daily.reduce((sum, row) => sum + row.inbound, 0);
  const botSynthetic = metrics.daily.reduce((sum, row) => sum + row.outboundBot, 0);
  const agentWithPossibleSid = metrics.daily.reduce((sum, row) => sum + row.outboundAgent, 0);

  const usageCount = usageSummary?.categories
    ?.filter((row) => row.bucket === 'twilio_whatsapp' && row.dailyGranular && !row.aggregated)
    .reduce((sum, row) => sum + (row.count || 0), 0) ?? null;

  let status = 'pending_usage';
  if (usageSummary) {
    status = partial ? 'partial_truncated' : 'compared';
  }

  return {
    status,
    usageCompleteness: usageFetch?.completeness || null,
    usageQuality: usageFetchQuality(usageFetch),
    sql: {
      inboundPersisted: sqlInbound,
      whatsappOutboundPersisted: sqlOutbound,
      outboundBotPersisted: botSynthetic,
      outboundAgentPersisted: agentWithPossibleSid,
      note: 'Persistido ≠ facturado. Bot TwiML puede no tener SID Twilio.',
    },
    provider: usageSummary
      ? {
          quality: partial ? 'partial_truncated' : 'confirmed_provider',
          confirmedTwilioUsd: usageSummary.confirmedTwilioUsd,
          confirmedMetaUsd: usageSummary.confirmedMetaUsd,
          totalControlUsd: usageSummary.confirmedTotalControlUsd,
          componentTwilioUsd: usageSummary.componentTwilioUsd,
          componentMetaUsd: usageSummary.componentMetaUsd,
          periodAggregateWhatsappUsd: usageSummary.periodAggregateWhatsappUsd,
          prepaidRechargeUsd: usageSummary.prepaidRechargeUsd,
          excludedNonWhatsappUsd: usageSummary.excludedNonWhatsappUsd,
          excludedUnknownWhatsappUsd: usageSummary.excludedUnknownWhatsappUsd,
          whatsappMessagingUnits: usageCount,
          dailyGranularityAvailable: usageSummary.dailyGranularityAvailable,
          rollupPolicy: usageSummary.rollupPolicy,
        }
      : null,
    nonReconcilable: {
      templates: TEMPLATE_METRIC_LIMITATION,
      twimlBotWithoutTwilioSid: botSynthetic,
      systemInternalMessages: metrics.daily.reduce((sum, row) => sum + row.outboundSystem, 0),
      metaServiceFromSql: 'non_determinable',
      dailyCrossTimezone:
        'No conciliar usage.daily (fecha Twilio) con messages.daily (día AR) sin mapeo validado.',
    },
    variance: usageSummary && !partial
      ? {
          messageCountDelta: usageCount == null ? null : usageCount - (sqlInbound + sqlOutbound),
          note: 'Diferencia esperada por TwiML, mensajes fuera de SQL o granularidad usage.',
        }
      : {
          messageCountDelta: null,
          note: partial
            ? 'Conciliación de conteos omitida: usage parcial/truncado.'
            : 'Sin usage para comparar.',
        },
    doubleCountingGuard:
      'Usar totalControlUsd como control. No sumar agregados de período con componentes diarios ni con estimaciones SQL.',
  };
}

function monthlyTotalsByCalendarMonth(dailyMerged, metricsWindow, usageQuality) {
  const months = new Map();

  for (const row of dailyMerged) {
    const key = monthKeyArgentina(row.dayAr);
    if (!key) continue;
    const slot = months.get(key) || {
      monthAr: key,
      twilioConfirmedUsd: 0,
      metaConfirmedUsd: 0,
      hasConfirmedTwilio: false,
      hasConfirmedMeta: false,
      hasEstimatedTwilio: false,
    };

    if (Number.isFinite(row.costs?.twilioUsd)) {
      slot.twilioConfirmedUsd += row.costs.twilioUsd;
      slot.hasConfirmedTwilio = true;
    }
    if (Number.isFinite(row.costs?.metaUsd)) {
      slot.metaConfirmedUsd += row.costs.metaUsd;
      slot.hasConfirmedMeta = true;
    }

    months.set(key, slot);
  }

  return [...months.values()].map((slot) => {
    const coverage = monthWindowCoverage(metricsWindow, slot.monthAr);
    const partialUsage = usageQuality === 'partial_truncated';
    return {
      monthAr: slot.monthAr,
      monthCoverage: coverage.coverage,
      monthCoverageQuality: coverage.quality,
      twilioUsd: slot.hasConfirmedTwilio ? round4(slot.twilioConfirmedUsd) : null,
      metaUsd: slot.hasConfirmedMeta ? round4(slot.metaConfirmedUsd) : null,
      totalConfirmedUsd: slot.hasConfirmedTwilio || slot.hasConfirmedMeta
        ? round4(slot.twilioConfirmedUsd + slot.metaConfirmedUsd)
        : null,
      twilioEstimatedUsd: null,
      metaEstimatedUsd: null,
      totalEstimatedUsd: null,
      metaEstimatedQuality: 'non_determinable',
      totalsQuality: partialUsage
        ? 'partial_truncated'
        : coverage.coverage === 'full_month'
          ? 'partial_data_month_scope'
          : 'partial_month_window',
      note:
        coverage.coverage === 'partial_month'
          ? 'La ventana consultada no cubre el mes civil completo.'
          : null,
    };
  });
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

  const usageQuality = usageFetchQuality(usage);

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

  const estimates = metrics ? estimateDailyCostsFromSql(metrics.daily, metrics.window) : [];
  const daily = metrics ? mergeDailyMessageAndEstimates(metrics.daily, estimates) : [];

  const reconciliation = buildReconciliation(
    metrics || { daily: [] },
    usage?.ok ? usage.summary : null,
    usage,
  );

  const monthlyByCalendar = monthlyTotalsByCalendarMonth(daily, metrics?.window, usageQuality);

  const providerUsage = usage?.ok
    ? {
      quality: usageQuality,
      completeness: usage.completeness,
      truncated: usage.truncated,
      ...usage.summary,
    }
    : {
      quality: usageQuality,
      error: usage?.error || 'not_fetched',
    };

  return {
    generatedAt: new Date().toISOString(),
    asOfUtc: asOf.toISOString(),
    days,
    window: metrics?.window || null,
    presentationTimeZone: metrics?.window?.presentationTimeZone || 'Argentina Standard Time',
    dataQuality: usageQuality,
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
        detail: 'Sin tarifas ilustrativas como costo operativo; confirmado solo desde Usage Records.',
      },
    ],
  };
}

export default { getWhatsAppCostAudit };