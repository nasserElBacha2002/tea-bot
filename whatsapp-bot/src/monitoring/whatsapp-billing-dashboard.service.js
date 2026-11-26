import { config } from '../config.js';
import { isConversationDbEnabled } from '../db/index.js';
import { getWhatsAppCostAudit } from './whatsapp-cost-audit.service.js';
import { getDailyWhatsAppMetrics, getDailyWhatsAppMetricsForDayRange } from './whatsapp-daily-metrics.js';
import { dayArToUtcBounds } from './whatsapp-effective-period.js';
import {
  buildBalanceIndicators,
  summarizeEstimatedCosts,
} from './whatsapp-cost-engine.js';
import { resolveSqlCostEstimatesForMetrics } from './whatsapp-sql-cost-estimates.js';
import {
  billingCacheMeta,
  buildUsageCacheKey,
  dedupeBillingFetch,
  getCachedTwilioBalance,
  getCachedTwilioUsage,
  setCachedTwilioBalance,
  setCachedTwilioUsage,
} from './whatsapp-billing-cache.js';
import { listBillingDailyAggregates, upsertBillingDailyAggregate } from './whatsapp-billing.repository.js';
import { mergeSqlWithHistorical } from './whatsapp-billing-historical.js';
import { fetchTwilioUsageRecords } from './twilio-usage.client.js';
import { collectTwilioSnapshot } from './twilio-monitor.client.js';

function isReconciliationComparable(estimatedSummary, providerTotals, effectivePeriod) {
  if (!providerTotals) return false;
  if (!effectivePeriod?.startDayAr || !effectivePeriod?.endDayAr) return false;
  if (providerTotals.scope && providerTotals.scope !== 'whatsapp_subaccount') return false;
  if (providerTotals.currency && providerTotals.currency !== 'USD') return false;
  return providerTotals.periodStart === effectivePeriod.startDayAr
    && providerTotals.periodEnd === effectivePeriod.endDayAr;
}

function mergeDailyRows(sqlDaily, estimates, providerDaily) {
  const providerByDay = new Map((providerDaily || []).map((row) => [row.usageStartDate, row]));
  return (sqlDaily || []).map((msgRow) => {
    const est = estimates.find((e) => e.dayAr === msgRow.dayAr);
    const prov = providerByDay.get(msgRow.dayAr);
    return {
      dayAr: msgRow.dayAr,
      inbound: msgRow.inbound,
      outbound: msgRow.whatsappOutbound,
      outboundBot: msgRow.outboundBot,
      outboundAgent: msgRow.outboundAgent,
      freeService: est?.costs?.metaServiceFreeTier?.freeAppliedInDay ?? null,
      billableService: est?.costs?.metaServiceFreeTier?.billableInDay ?? null,
      twilioEstimatedUsd: est?.costs?.twilioEstimatedUsd ?? null,
      metaEstimatedUsd: est?.costs?.metaEstimatedUsd ?? null,
      totalEstimatedUsd: est?.costs?.totalEstimatedUsd ?? null,
      twilioConfirmedUsd: prov?.twilioUsd ?? null,
      metaConfirmedUsd: prov?.metaUsd ?? null,
      totalConfirmedUsd: prov?.whatsappSubtotalUsd ?? null,
      twilioQuality: prov ? prov.twilioQuality : est?.costs?.twilioEstimatedQuality,
      metaQuality: prov ? prov.metaQuality : est?.costs?.metaEstimatedQuality,
      totalQuality: prov?.subtotalQuality ?? est?.costs?.totalEstimatedQuality,
    };
  });
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function billingDailyToCsv(rows) {
  const header = [
    'day_ar', 'inbound', 'outbound', 'outbound_bot', 'outbound_agent',
    'free_service', 'billable_service',
    'twilio_estimated_usd', 'meta_estimated_usd', 'total_estimated_usd',
    'twilio_confirmed_usd', 'meta_confirmed_usd', 'total_confirmed_usd',
  ];
  const lines = [header.join(',')];
  for (const row of rows || []) {
    lines.push([
      row.dayAr,
      row.inbound,
      row.outbound,
      row.outboundBot,
      row.outboundAgent,
      row.freeService,
      row.billableService,
      row.twilioEstimatedUsd,
      row.metaEstimatedUsd,
      row.totalEstimatedUsd,
      row.twilioConfirmedUsd,
      row.metaConfirmedUsd,
      row.totalConfirmedUsd,
    ].map(csvEscape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function resolveProviderLayer({
  days,
  asOf,
  fetchUsage,
  usageWindow,
  usageRequest,
  twilioRequest,
  usageCacheKey,
}) {
  const externalAllowed = fetchUsage && config.monitoringTwilioEnabled;
  if (!externalAllowed) {
    return {
      usage: getCachedTwilioUsage(usageCacheKey),
      balance: getCachedTwilioBalance(),
      externalFetch: false,
      stale: false,
      usageCacheKey,
    };
  }

  let usagePayload = getCachedTwilioUsage(usageCacheKey);
  let balancePayload = getCachedTwilioBalance();
  const stale = Boolean(usagePayload?.stale || balancePayload?.stale);

  if ((!usagePayload || usagePayload.stale) && usageWindow?.startDate && usageWindow?.endDate) {
    const usage = await dedupeBillingFetch('usage', () => fetchTwilioUsageRecords({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      startDate: usageWindow.startDate,
      endDate: usageWindow.endDate,
      request: usageRequest,
    }), usageCacheKey);
    if (usage.ok) {
      usagePayload = usage;
      setCachedTwilioUsage(usageCacheKey, usage);
    }
  }

  if (!balancePayload || balancePayload.stale) {
    const snapshot = await dedupeBillingFetch('balance', () => collectTwilioSnapshot({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromAddress: config.twilioWhatsappFrom,
      request: twilioRequest,
    }));
    if (snapshot.ok) {
      balancePayload = { usd: snapshot.balance, currency: snapshot.currency, checkedAt: new Date().toISOString() };
      setCachedTwilioBalance(balancePayload);
    }
  }

  return { usage: usagePayload, balance: balancePayload, externalFetch: true, stale, usageCacheKey };
}

/**
 * @param {{ days?: number, asOf?: Date, fetchUsage?: boolean, persistAggregates?: boolean }} options
 */
export async function getWhatsAppBillingDashboard(options = {}) {
  const days = options.days ?? 7;
  const asOf = options.asOf instanceof Date ? options.asOf : new Date();
  const fetchUsage = options.fetchUsage === true;
  const effectiveWindow = options.effectiveWindow
    || (options.windowOverride?.startDayAr && options.windowOverride?.endDayAr
      ? dayArToUtcBounds(options.windowOverride.startDayAr, options.windowOverride.endDayAr)
      : null);

  let metrics = null;
  if (options.metricsOverride) {
    metrics = options.metricsOverride;
  } else if (isConversationDbEnabled() && effectiveWindow?.startDayAr && effectiveWindow?.endDayAr) {
    metrics = await getDailyWhatsAppMetricsForDayRange({
      startDayAr: effectiveWindow.startDayAr,
      endDayAr: effectiveWindow.endDayAr,
      asOf,
    });
  } else if (isConversationDbEnabled()) {
    metrics = await getDailyWhatsAppMetrics({ days, asOf });
  }

  const mergedWindow = effectiveWindow
    ? { ...metrics?.window, ...effectiveWindow }
    : metrics?.window;

  if (mergedWindow) {
    metrics = { ...(metrics || {}), window: mergedWindow };
  }

  let storedRows = [];
  if (metrics?.window?.startDayAr && metrics?.window?.endDayAr && isConversationDbEnabled()) {
    const stored = await listBillingDailyAggregates(metrics.window.startDayAr, metrics.window.endDayAr);
    if (stored.available) storedRows = stored.rows;
    if (storedRows.length > 0) {
      metrics = {
        ...(metrics || {}),
        daily: mergeSqlWithHistorical(metrics?.daily, storedRows),
      };
    }
  }

  const audit = await getWhatsAppCostAudit({
    days,
    asOf,
    fetchUsage: false,
    metricsOverride: metrics,
    usageRequest: options.usageRequest,
    twilioRequest: options.twilioRequest,
  });

  const { estimatesPack, monthServiceKnown, priorMonthProxy } = metrics
    ? await resolveSqlCostEstimatesForMetrics(metrics)
    : { estimatesPack: { daily: [], finalFreeTierUsed: null }, monthServiceKnown: false, priorMonthProxy: { count: null, quality: 'unavailable' } };

  const windowForUsage = metrics?.window || audit.window;
  const usageWindow = windowForUsage?.startDayAr && windowForUsage?.endDayAr
    ? {
        startDate: windowForUsage.startDayAr,
        endDate: windowForUsage.endDayAr,
      }
    : null;

  const usageCacheKey = usageWindow
    ? buildUsageCacheKey({
        accountSid: config.twilioAccountSid,
        startDate: usageWindow.startDate,
        endDate: usageWindow.endDate,
      })
    : null;

  const providerLayer = await resolveProviderLayer({
    days,
    asOf,
    fetchUsage,
    usageWindow,
    usageRequest: options.usageRequest,
    twilioRequest: options.twilioRequest,
    usageCacheKey,
  });

  let providerDaily = [];
  let providerTotals = null;
  let reconciliation = audit.reconciliation;
  if (providerLayer.usage?.summary) {
    providerDaily = providerLayer.usage.summary.daily || [];
    providerTotals = {
      accountTotalUsd: providerLayer.usage.summary.accountTotalUsd,
      whatsappSubtotalUsd: providerLayer.usage.summary.whatsappSubtotalUsd,
      twilioUsd: providerLayer.usage.summary.whatsappTwilioPlatformUsd,
      metaUsd: providerLayer.usage.summary.whatsappMetaPassthroughUsd,
      quality: 'confirmed_provider',
      billingCompleteness: providerLayer.usage.summary.billingCompleteness,
      currency: providerLayer.usage.summary.currency || 'USD',
      periodStart: usageWindow?.startDate || null,
      periodEnd: usageWindow?.endDate || null,
      scope: 'whatsapp_subaccount',
    };
    const auditWithUsage = await getWhatsAppCostAudit({
      days,
      asOf,
      fetchUsage: false,
      metricsOverride: metrics,
      usageRequest: options.usageRequest,
    });
    reconciliation = {
      ...audit.reconciliation,
      ...auditWithUsage.reconciliation,
      providerUsageAvailable: true,
    };
  }

  const metricsDaily = metrics?.daily || [];
  const mergedDaily = mergeDailyRows(metricsDaily, estimatesPack.daily, providerDaily).map((row) => {
    const hist = storedRows.find((stored) => stored.dayAr === row.dayAr);
    if (!hist) return row;
    return {
      ...row,
      twilioConfirmedUsd: row.twilioConfirmedUsd ?? hist.twilioConfirmedUsd,
      metaConfirmedUsd: row.metaConfirmedUsd ?? hist.metaConfirmedUsd,
      totalConfirmedUsd: row.totalConfirmedUsd ?? hist.totalConfirmedUsd,
      twilioEstimatedUsd: row.twilioEstimatedUsd ?? hist.twilioEstimatedUsd,
      metaEstimatedUsd: row.metaEstimatedUsd ?? hist.metaEstimatedUsd,
      totalEstimatedUsd: row.totalEstimatedUsd ?? hist.totalEstimatedUsd,
      twilioQuality: row.twilioConfirmedUsd != null || hist.twilioConfirmedUsd != null
        ? 'confirmed_provider'
        : row.twilioQuality,
      metaQuality: row.metaConfirmedUsd != null || hist.metaConfirmedUsd != null
        ? 'confirmed_provider'
        : row.metaQuality,
      persistedHistorical: Boolean(hist),
    };
  });
  const estimatedSummary = summarizeEstimatedCosts(estimatesPack.daily);
  const balanceIndicators = buildBalanceIndicators(providerLayer.balance?.usd ?? audit.prepaidBalance?.usd ?? null);

  const freeTierMonth = {
    allowance: 1000,
    consumedBeforeWindow: priorMonthProxy.count,
    consumedQuality: monthServiceKnown ? priorMonthProxy.quality : 'non_determinable',
    consumedAfterWindow: estimatesPack.finalFreeTierUsed,
    remaining: estimatesPack.finalFreeTierUsed == null
      ? null
      : Math.max(0, 1000 - estimatesPack.finalFreeTierUsed),
    percentConsumed: estimatesPack.finalFreeTierUsed == null
      ? null
      : Math.round((estimatesPack.finalFreeTierUsed / 1000) * 10000) / 100,
    resetNote: 'Reinicio mensual por número WhatsApp; no se reinicia al cambiar el filtro del dashboard.',
  };

  if (options.persistAggregates && isConversationDbEnabled()) {
    for (const row of mergedDaily) {
      // eslint-disable-next-line no-await-in-loop
      await upsertBillingDailyAggregate({
        ...row,
        whatsappOutbound: row.outbound,
        freeService: row.freeService,
        billableService: row.billableService,
        dataSource: providerDaily.length ? 'mixed' : 'estimated_sql',
        reconciliationStatus: reconciliation?.status || 'pending',
      });
    }
  }

  const providerTwilio = providerTotals?.twilioUsd ?? null;
  const providerMeta = providerTotals?.metaUsd ?? null;
  const providerTotal = providerTotals?.whatsappSubtotalUsd ?? null;
  const effectivePeriod = {
    period: options.period || null,
    startDayAr: metrics?.window?.startDayAr || null,
    endDayAr: metrics?.window?.endDayAr || null,
    days: days ?? null,
  };
  const comparable = isReconciliationComparable(estimatedSummary, providerTotals, effectivePeriod);

  return {
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    externalBillingFetchEnabled: config.monitoringTwilioEnabled,
    period: options.period || null,
    days,
    asOfUtc: asOf.toISOString(),
    window: metrics?.window || audit.window,
    effectivePeriod,
    dataQuality: {
      sql: metrics ? 'available' : 'unavailable',
      estimatedCosts: 'estimated_sql_proxy',
      providerConfirmed: providerTotals ? 'confirmed_provider' : 'not_fetched',
      templates: audit.templates,
      rateCard: audit.rateCard,
    },
    indicators: {
      messagesReceived: estimatedSummary.inbound,
      messagesSent: estimatedSummary.outbound,
      twilioCostUsd: providerTwilio ?? estimatedSummary.twilioEstimatedUsd,
      twilioCostQuality: providerTwilio != null ? 'confirmed_provider' : estimatedSummary.twilioEstimatedUsd != null ? 'estimated_sql_proxy' : 'unavailable',
      metaCostUsd: providerMeta ?? estimatedSummary.metaEstimatedUsd,
      metaCostQuality: providerMeta != null ? 'confirmed_provider' : estimatedSummary.metaEstimatedUsd != null ? 'estimated_sql_proxy' : 'non_determinable',
      knownSubtotalUsd: providerTotal ?? estimatedSummary.knownSubtotalUsd,
      totalCostUsd: providerTotal ?? estimatedSummary.totalEstimatedUsd,
      totalCostCompleteness: providerTotal != null ? 'confirmed_provider' : estimatedSummary.totalCompleteness,
      avgDailyUsd: estimatedSummary.avgDailyUsd,
      avgPerMessageUsd: estimatedSummary.avgPerMessageUsd,
      automaticMessages: estimatedSummary.outboundBot,
      manualMessages: estimatedSummary.outboundAgent,
      costAutomaticUsd: null,
      costManualUsd: null,
      costAutomaticQuality: 'non_determinable_without_template_dimension',
      costManualQuality: 'non_determinable_without_template_dimension',
      freeTier: freeTierMonth,
      balance: balanceIndicators,
      projectedMonthlyUsd: estimatedSummary.avgDailyUsd == null
        ? null
        : Math.round(estimatedSummary.avgDailyUsd * 30 * 10000) / 10000,
    },
    charts: {
      dailyCosts: mergedDaily.map((row) => ({
        dayAr: row.dayAr,
        twilioEstimatedUsd: row.twilioEstimatedUsd,
        metaEstimatedUsd: row.metaEstimatedUsd,
        totalEstimatedUsd: row.totalEstimatedUsd,
        twilioConfirmedUsd: row.twilioConfirmedUsd,
        metaConfirmedUsd: row.metaConfirmedUsd,
        totalConfirmedUsd: row.totalConfirmedUsd,
      })),
      dailyMessages: mergedDaily.map((row) => ({
        dayAr: row.dayAr,
        inbound: row.inbound,
        outbound: row.outbound,
        outboundBot: row.outboundBot,
        outboundAgent: row.outboundAgent,
      })),
    },
    table: {
      daily: mergedDaily,
      csvNote: 'Exportación agregada sin PII; GET /api/monitoring/billing-dashboard.csv',
    },
    reconciliation: {
      status: reconciliation?.status || 'pending',
      estimatedVsProvider: {
        comparable,
        estimatedTotalUsd: estimatedSummary.knownSubtotalUsd ?? estimatedSummary.totalEstimatedUsd,
        providerTotalUsd: providerTotal,
        absoluteDeltaUsd: comparable && providerTotal != null && estimatedSummary.knownSubtotalUsd != null
          ? Math.round((providerTotal - estimatedSummary.knownSubtotalUsd) * 10000) / 10000
          : null,
        quality: comparable ? 'estimated_vs_confirmed' : providerTotal == null ? 'provider_missing' : 'period_or_scope_mismatch',
        note: 'No presentar estimaciones como importes facturados.',
      },
      doubleCountingGuard: audit.reconciliation?.doubleCountingGuard,
    },
    provider: providerTotals
      ? {
          ...providerTotals,
          cache: billingCacheMeta(providerLayer.usageCacheKey),
          stale: providerLayer.stale,
        }
      : { quality: 'not_fetched', cache: billingCacheMeta(providerLayer.usageCacheKey) },
    limitations: audit.limitations,
  };
}

export default {
  billingDailyToCsv,
  getWhatsAppBillingDashboard,
};