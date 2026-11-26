import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { collectTwilioSnapshot } from './twilio-monitor.client.js';
import { getDailyWhatsAppMetrics, getDailyWhatsAppMetricsForDayRange, TEMPLATE_METRIC_LIMITATION } from './whatsapp-daily-metrics.js';
import { listBillingDailyAggregates } from './whatsapp-billing.repository.js';
import { mergeSqlWithHistorical } from './whatsapp-billing-historical.js';
import { loadRateCard, rateCardMetaLimitation } from './whatsapp-rate-card.js';
import {
  lastDayOfMonthYm,
  monthKeyArgentina,
} from './whatsapp-pricing-regime.js';
import { fetchTwilioUsageRecords, isVerifiedDailyAccounting } from './twilio-usage.client.js';
import {
  auditDailyEstimatesFromPack,
  resolveSqlCostEstimatesForMetrics,
} from './whatsapp-sql-cost-estimates.js';

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

async function estimateDailyCostsFromSql(metrics) {
  if (!metrics?.daily?.length) return [];
  const { estimatesPack } = await resolveSqlCostEstimatesForMetrics(metrics);
  return auditDailyEstimatesFromPack(metrics, estimatesPack);
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
  if (usage.truncated || usage.fetchCompleteness === 'partial_truncated') return 'partial_truncated';
  return 'confirmed_provider';
}

export function assessOutboundMessageCountComparison(metrics, usageSummary) {
  const outboundRows = usageSummary?.categories?.filter(
    (row) => row.bucket === 'twilio_whatsapp'
      && row.dailyGranular
      && !row.aggregated
      && String(row.category || '').toLowerCase().includes('outbound'),
  ) ?? [];

  if (outboundRows.length === 0) {
    return { comparable: false, reason: 'no_daily_outbound_usage_rows' };
  }

  let providerOutboundCount = 0;
  const usageDays = [];
  for (const row of outboundRows) {
    if (row.count == null) return { comparable: false, reason: 'missing_outbound_count' };
    providerOutboundCount += row.count;
    if (row.startDate) usageDays.push(row.startDate);
  }

  const uniqueUsageDays = [...new Set(usageDays)];
  const sqlByDay = new Map((metrics?.daily || []).map((row) => [row.dayAr, row]));

  for (const usageDay of uniqueUsageDays) {
    if (!sqlByDay.has(usageDay)) {
      return { comparable: false, reason: 'temporal_mismatch_usage_day_without_sql_row' };
    }
  }

  let sqlOutboundCount = 0;
  for (const usageDay of uniqueUsageDays) {
    sqlOutboundCount += sqlByDay.get(usageDay)?.whatsappOutbound ?? 0;
  }

  for (const row of metrics?.daily || []) {
    if (row.whatsappOutbound > 0 && !uniqueUsageDays.includes(row.dayAr)) {
      return { comparable: false, reason: 'temporal_mismatch_sql_day_without_usage' };
    }
  }

  return {
    comparable: true,
    providerOutboundCount,
    sqlOutboundCount,
    messageCountDelta: providerOutboundCount - sqlOutboundCount,
  };
}

export function resolveReconciliationStatus(usageFetch, usageSummary, countComparison) {
  if (!usageSummary) return 'pending_usage';
  if (usageFetchQuality(usageFetch) === 'partial_truncated') return 'partial_truncated';
  if (!isVerifiedDailyAccounting(usageSummary.billingCompleteness)) {
    return 'partial_billing';
  }
  if (!countComparison?.comparable) return 'inconclusive';
  return 'compared';
}

export function providerTotalsByUsageMonth(usageSummary) {
  if (!usageSummary?.daily?.length) return [];
  const verifiedAccounting = isVerifiedDailyAccounting(usageSummary.billingCompleteness);
  const months = new Map();
  for (const row of usageSummary.daily) {
    const key = String(row.usageStartDate || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const slot = months.get(key) || {
      usageMonth: key,
      twilioUsd: 0,
      metaUsd: 0,
      whatsappSubtotalUsd: 0,
      hasTwilio: false,
      hasMeta: false,
      dayCount: 0,
      hasUnavailableSubtotal: false,
    };
    slot.dayCount += 1;
    if (Number.isFinite(row.twilioUsd)) {
      slot.twilioUsd += row.twilioUsd;
      slot.hasTwilio = true;
    }
    if (Number.isFinite(row.metaUsd)) {
      slot.metaUsd += row.metaUsd;
      slot.hasMeta = true;
    }
    if (row.subtotalQuality === 'unavailable') {
      slot.hasUnavailableSubtotal = true;
    } else {
      slot.whatsappSubtotalUsd += row.whatsappSubtotalUsd ?? 0;
    }
    months.set(key, slot);
  }
  return [...months.values()]
    .sort((a, b) => a.usageMonth.localeCompare(b.usageMonth))
    .map((slot) => {
      const accountingCoverage = verifiedAccounting && !slot.hasUnavailableSubtotal
        ? 'verified'
        : 'partial_or_unknown';
      const temporalCoverage = slot.dayCount > 0 ? 'partial_days_only' : 'unknown';
      return {
        usageMonth: slot.usageMonth,
        twilioUsd: slot.hasTwilio ? round4(slot.twilioUsd) : null,
        metaUsd: slot.hasMeta ? round4(slot.metaUsd) : null,
        whatsappSubtotalUsd: slot.hasUnavailableSubtotal ? null : round4(slot.whatsappSubtotalUsd),
        accountingCoverage,
        temporalCoverage,
        scopeNote: 'Mes calendario de usageStartDate (Twilio); no día civil Argentina.',
      };
    });
}

function buildReconciliation(metrics, usageSummary, usageFetch) {
  const fetchPartial = usageFetchQuality(usageFetch) === 'partial_truncated';
  const sqlOutbound = metrics.daily.reduce((sum, row) => sum + row.whatsappOutbound, 0);
  const sqlInbound = metrics.daily.reduce((sum, row) => sum + row.inbound, 0);
  const botSynthetic = metrics.daily.reduce((sum, row) => sum + row.outboundBot, 0);
  const agentWithPossibleSid = metrics.daily.reduce((sum, row) => sum + row.outboundAgent, 0);

  const countComparison = usageSummary
    ? assessOutboundMessageCountComparison(metrics, usageSummary)
    : { comparable: false, reason: 'no_usage_summary' };

  const status = resolveReconciliationStatus(usageFetch, usageSummary, countComparison);
  const countComparisonAllowed = status === 'compared';
  const usageOutboundCount = countComparison.comparable
    ? countComparison.providerOutboundCount
    : null;

  return {
    status,
    fetchCompleteness: usageFetch?.fetchCompleteness || null,
    billingCompleteness: usageSummary?.billingCompleteness || null,
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
          quality: fetchPartial ? 'partial_truncated' : 'confirmed_provider',
          accountTotalUsd: usageSummary.accountTotalUsd,
          whatsappSubtotalUsd: usageSummary.whatsappSubtotalUsd,
          whatsappTwilioPlatformUsd: usageSummary.whatsappTwilioPlatformUsd,
          whatsappMetaPassthroughUsd: usageSummary.whatsappMetaPassthroughUsd,
          componentTwilioUsd: usageSummary.componentTwilioUsd,
          componentMetaUsd: usageSummary.componentMetaUsd,
          periodAggregateWhatsappUsd: usageSummary.periodAggregateWhatsappUsd,
          adjustmentWhatsappUsd: usageSummary.adjustmentWhatsappUsd,
          prepaidRechargeUsd: usageSummary.prepaidRechargeUsd,
          excludedNonWhatsappUsd: usageSummary.excludedNonWhatsappUsd,
          excludedUnknownWhatsappUsd: usageSummary.excludedUnknownWhatsappUsd,
          whatsappOutboundMessagingUnits: usageOutboundCount,
          dailyGranularityAvailable: usageSummary.dailyGranularityAvailable,
          billingCompleteness: usageSummary.billingCompleteness,
          rollupPolicy: usageSummary.rollupPolicy,
          accountVsWhatsappNote:
            'accountTotalUsd (totalprice) es total de cuenta en el registro; whatsappSubtotalUsd suma solo componentes WhatsApp confirmados.',
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
    countComparison: countComparisonAllowed
      ? {
          comparable: true,
          providerOutboundCount: countComparison.providerOutboundCount,
          sqlWhatsappOutboundCount: countComparison.sqlOutboundCount,
          messageCountDelta: countComparison.messageCountDelta,
          note: 'Comparación solo outbound Twilio (usage) vs whatsappOutbound (SQL) con mismo usageStartDate=dayAr.',
        }
      : {
          comparable: false,
          messageCountDelta: null,
          reason: countComparison.reason || 'not_evaluated',
          note:
            status === 'partial_truncated'
              ? 'Conciliación omitida: paginación truncada.'
              : status === 'partial_billing'
                ? 'Conciliación omitida: cobertura contable no verificada.'
                : status === 'inconclusive'
                  ? `Conciliación omitida: ${countComparison.reason || 'conteos no equivalentes'}.`
                  : 'Sin usage para comparar.',
        },
    doubleCountingGuard:
      'accountTotalUsd no sustituye whatsappSubtotalUsd. No sumar periodAggregateWhatsappUsd con componentes diarios.',
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
          ? 'La ventana consultada no cubre el mes civil completo (métricas SQL día AR).'
          : 'Solo métricas SQL por día Argentina; costos confirmados del proveedor están en providerDaily/providerTotals.',
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
    if (options.effectiveWindow?.startDayAr && options.effectiveWindow?.endDayAr) {
      metrics = await getDailyWhatsAppMetricsForDayRange({
        startDayAr: options.effectiveWindow.startDayAr,
        endDayAr: options.effectiveWindow.endDayAr,
        asOf,
      });
      metrics = {
        ...metrics,
        window: { ...metrics.window, ...options.effectiveWindow },
      };
    } else {
      metrics = await getDailyWhatsAppMetrics({ days, asOf });
    }
    if (metrics?.window?.startDayAr && metrics?.window?.endDayAr) {
      const stored = await listBillingDailyAggregates(metrics.window.startDayAr, metrics.window.endDayAr);
      if (stored.available && stored.rows.length > 0) {
        metrics = {
          ...metrics,
          daily: mergeSqlWithHistorical(metrics.daily, stored.rows),
        };
      }
    }
  }

  const usageWindow = metrics ? formatUsageWindow(metrics.window) : null;
  let usage = null;
  const shouldFetch = options.fetchUsage === true && config.monitoringTwilioEnabled;
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

  const estimates = metrics ? await estimateDailyCostsFromSql(metrics) : [];
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
      fetchCompleteness: usage.fetchCompleteness,
      truncated: usage.truncated,
      billingCompleteness: usage.summary?.billingCompleteness ?? null,
      ...usage.summary,
    }
  : {
    quality: usageQuality,
    error: usage?.error || 'not_fetched',
  };

  const providerTotals = usage?.ok && usage.summary
    ? {
        accountTotalUsd: usage.summary.accountTotalUsd,
        whatsappSubtotalUsd: usage.summary.whatsappSubtotalUsd,
        whatsappTwilioPlatformUsd: usage.summary.whatsappTwilioPlatformUsd,
        whatsappMetaPassthroughUsd: usage.summary.whatsappMetaPassthroughUsd,
        periodAggregateWhatsappUsd: usage.summary.periodAggregateWhatsappUsd,
        adjustmentWhatsappUsd: usage.summary.adjustmentWhatsappUsd,
        billingCompleteness: usage.summary.billingCompleteness,
        billingComplete:
          isVerifiedDailyAccounting(usage.summary.billingCompleteness)
          && usageQuality !== 'partial_truncated',
        paginationComplete: usage.fetchCompleteness === 'complete_within_page_limit',
      }
    : null;

  const providerMonthlyByUsageMonth = usage?.ok && usage.summary
    ? providerTotalsByUsageMonth(usage.summary)
    : [];

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
      providerDaily: usage?.ok ? usage.summary?.daily ?? [] : [],
      providerPeriod: usage?.ok ? usage.summary?.byUsagePeriod ?? [] : [],
      providerTotals,
      providerMonthlyByUsageMonth,
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