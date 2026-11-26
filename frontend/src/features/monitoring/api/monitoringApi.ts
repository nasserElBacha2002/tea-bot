import axios from 'axios';
import { resolveApiOrigin } from '../../../utils/apiOrigin';

const client = axios.create({
  baseURL: `${resolveApiOrigin()}/api/monitoring`,
  withCredentials: true,
});

export interface MonitoringDiagnosis {
  status: string;
  severity: string;
  summary: string;
  signals: Array<{ name: string; value: unknown }>;
}

export interface MonitoringOverview {
  ok: boolean;
  generatedAt: string;
  monitoringEnabled: boolean;
  diagnosis: MonitoringDiagnosis;
  bot: {
    status: string;
    operationalState: string;
    process: { up: boolean; startedAt: string };
    database: { ok: boolean; latencyMs: number | null };
    flowsLoaded: boolean;
    activity: {
      lastInboundAt: string | null;
      lastOutboundAt: string | null;
      lastProcessedAt: string | null;
      lastSuccessfulFlowAt: string | null;
      lastErrorAt: string | null;
      activityPersistenceOk?: boolean;
    };
  };
  twilio: {
    status: string;
    accountStatus: string | null;
    balance: number | null;
    currency: string | null;
    senderStatus: string | null;
    qualityRating: string | null;
    offlineReasons: unknown;
    senderSid: string | null;
    webhookUrl: string | null;
    checkedAt: string | null;
    latencyMs: number | null;
    error: string | null;
  };
  balance: {
    balance: number | null;
    severity: string;
    avgDailySpend: number | null;
    estimatedDaysRemaining: number | null;
  };
  activity: {
    available?: boolean;
    reason?: string;
    last15m?: { inbound: number; outbound: number; failed: number; processed: number };
    last60m?: {
      inbound: number;
      outbound: number;
      failed: number;
      delivered?: number;
      read?: number;
      processed: number;
    };
    last24h?: { inbound: number; outbound: number; failed: number; processed: number };
    delivery?: {
      sample: number;
      deliveryRate: number | null;
      failureRate: number | null;
      readRate: number | null;
      topErrorCodes: Array<{ code: string; count: number }>;
    };
    anomaly?: { anomaly: boolean; reason: string; actual: number | null; expected: number | null };
  } | null;
  reconciliation: {
    status: string;
    missingCount: number;
    dbOnlyCount: number;
    truncated: boolean;
    checkedAt: string | null;
  };
  jobs: {
    conversationRetention: {
      enabled: boolean;
      retentionDays: number;
      intervalHours: number;
      batchSize: number;
      lastRun: string | null;
      lastDeleted: number | null;
      lastStatus: string | null;
      lastDurationMs: number | null;
      lastRuntimeCleanupFailed: number | null;
      lastErrorAt: string | null;
    };
    retentionStale: boolean;
  };
  incidents: Array<{
    id: string;
    type: string;
    severity: string;
    status: string;
    startedAt: string;
    resolvedAt: string | null;
    summary: string;
  }>;
}

export async function fetchMonitoringOverview(signal?: AbortSignal): Promise<MonitoringOverview> {
  const { data } = await client.get<MonitoringOverview>('/overview', { signal });
  return data;
}

export interface MonitoringPeriodQuery {
  days?: number;
  period?: 'today' | '7d' | '30d' | 'custom';
  startDay?: string;
  endDay?: string;
}

export interface OperationalSummaryResponse {
  ok: boolean;
  generatedAt: string;
  monitoringEnabled: boolean;
  available?: boolean;
  reason?: string;
  cards: {
    messagesReceived: number;
    messagesSent: number;
    messagesAutomatic: number;
    messagesManual: number;
    deliveryFailedInPeriod: number | null;
    activeConversations: number;
    pendingHandoffs: number | null;
    lastBotActivityAt: string | null;
  };
}

export interface DailyMetricsResponse {
  ok: boolean;
  available?: boolean;
  generatedAt: string;
  daily: Array<{
    dayAr: string;
    inbound: number;
    outbound: number;
    outboundBot: number;
    outboundAgent: number;
    whatsappOutbound: number;
  }>;
  window: { startDayAr: string; endDayAr: string; presentationTimeZone: string } | null;
}

export interface HandoffsMetricsResponse {
  ok: boolean;
  available?: boolean;
  current: {
    pending: number | null;
    assigned: number | null;
    resolved: number | null;
    oldestPendingAgeMinutes: number | null;
  };
  period: {
    createdInPeriod: number;
    avgMinutesToAssign: number | null;
    avgMinutesToResolve: number | null;
  };
}

export interface ConversationsMetricsResponse {
  ok: boolean;
  dailyNew: Array<{ dayAr: string; newConversations: number }>;
  snapshot: { active: number; closed: number; botManaged: number; waitingHuman: number };
}

export interface SheetSyncMetricsResponse {
  ok: boolean;
  sheetSync: {
    available: boolean;
    pending?: number | null;
    failed?: number | null;
    completed?: number | null;
    lastSuccessAt?: string | null;
    oldestPendingAgeMinutes?: number | null;
    reason?: string;
  };
}

function periodParams(query: MonitoringPeriodQuery) {
  return {
    params: {
      ...(query.period ? { period: query.period } : {}),
      ...(query.days != null ? { days: query.days } : {}),
      ...(query.startDay ? { startDay: query.startDay } : {}),
      ...(query.endDay ? { endDay: query.endDay } : {}),
    },
  };
}

export async function fetchOperationalSummary(
  query: MonitoringPeriodQuery,
  signal?: AbortSignal,
): Promise<OperationalSummaryResponse> {
  const { data } = await client.get<OperationalSummaryResponse>('/operational-summary', {
    ...periodParams(query),
    signal,
  });
  return data;
}

export async function fetchDailyMetrics(
  query: MonitoringPeriodQuery,
  signal?: AbortSignal,
): Promise<DailyMetricsResponse> {
  const { data } = await client.get<DailyMetricsResponse>('/daily-metrics', {
    ...periodParams(query),
    signal,
  });
  return data;
}

export async function fetchHandoffsMetrics(
  query: MonitoringPeriodQuery,
  signal?: AbortSignal,
): Promise<HandoffsMetricsResponse> {
  const { data } = await client.get<HandoffsMetricsResponse>('/handoffs-metrics', {
    ...periodParams(query),
    signal,
  });
  return data;
}

export async function fetchConversationsMetrics(
  query: MonitoringPeriodQuery,
  signal?: AbortSignal,
): Promise<ConversationsMetricsResponse> {
  const { data } = await client.get<ConversationsMetricsResponse>('/conversations-metrics', {
    ...periodParams(query),
    signal,
  });
  return data;
}

export async function fetchSheetSyncMetrics(signal?: AbortSignal): Promise<SheetSyncMetricsResponse> {
  const { data } = await client.get<SheetSyncMetricsResponse>('/sheet-sync-jobs', { signal });
  return data;
}

export type BillingPeriod =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'current_month'
  | 'previous_month'
  | 'custom';

export interface BillingDashboardResponse {
  ok?: boolean;
  generatedAt: string;
  monitoringEnabled: boolean;
  externalBillingFetchEnabled: boolean;
  effectivePeriod?: {
    period?: string | null;
    startDayAr?: string | null;
    endDayAr?: string | null;
    days?: number | null;
  };
  indicators: {
    messagesReceived: number;
    messagesSent: number;
    twilioCostUsd: number | null;
    twilioCostQuality?: string;
    metaCostUsd: number | null;
    metaCostQuality?: string;
    knownSubtotalUsd?: number | null;
    totalCostUsd: number | null;
    totalCostCompleteness?: string;
    avgDailyUsd: number | null;
    avgPerMessageUsd: number | null;
    projectedMonthlyUsd: number | null;
    freeTier: {
      allowance: number;
      consumedBeforeWindow: number | null;
      consumedAfterWindow: number | null;
      remaining: number | null;
      percentConsumed: number | null;
    };
    balance: {
      available: boolean;
      balanceUsd?: number | null;
      severity?: string;
      rechargeThresholdUsd?: number;
    };
  };
  dataQuality: {
    estimatedCosts: string;
    providerConfirmed: string;
  };
  charts: {
    dailyCosts: Array<{
      dayAr: string;
      twilioEstimatedUsd: number | null;
      metaEstimatedUsd: number | null;
      totalEstimatedUsd: number | null;
      twilioConfirmedUsd?: number | null;
      metaConfirmedUsd?: number | null;
      totalConfirmedUsd?: number | null;
    }>;
    dailyMessages: Array<{
      dayAr: string;
      inbound: number;
      outbound: number;
      outboundBot: number;
      outboundAgent: number;
    }>;
  };
  table: {
    daily: Array<{
      dayAr: string;
      inbound: number;
      outbound: number;
      outboundBot: number;
      outboundAgent: number;
      freeService: number | null;
      billableService: number | null;
      twilioEstimatedUsd: number | null;
      metaEstimatedUsd: number | null;
      totalEstimatedUsd: number | null;
      twilioConfirmedUsd?: number | null;
      metaConfirmedUsd?: number | null;
      totalConfirmedUsd?: number | null;
    }>;
  };
  provider: {
    quality: string;
    cache?: { usageCachedAt?: string | null; balanceCachedAt?: string | null };
  };
}

export async function fetchBillingDashboard(
  period: BillingPeriod,
  signal?: AbortSignal,
  custom?: { startDay?: string; endDay?: string },
): Promise<BillingDashboardResponse> {
  const params: Record<string, string> = { period, persistAggregates: 'false', fetchUsage: 'false' };
  if (period === 'custom' && custom?.startDay && custom?.endDay) {
    params.startDay = custom.startDay;
    params.endDay = custom.endDay;
  }
  if (period === 'custom' && (!custom?.startDay || !custom?.endDay)) {
    throw new Error('custom_period_incomplete');
  }
  const { data } = await client.get<BillingDashboardResponse>('/billing-dashboard', {
    params,
    signal,
  });
  return data;
}

export async function downloadBillingDashboardCsv(
  period: BillingPeriod,
  custom?: { startDay?: string; endDay?: string },
): Promise<void> {
  const params: Record<string, string> = { period, persistAggregates: 'false', fetchUsage: 'false' };
  if (period === 'custom' && custom?.startDay && custom?.endDay) {
    params.startDay = custom.startDay;
    params.endDay = custom.endDay;
  }
  if (period === 'custom' && (!custom?.startDay || !custom?.endDay)) {
    throw new Error('custom_period_incomplete');
  }
  const response = await client.get<Blob>('/billing-dashboard.csv', {
    params,
    responseType: 'blob',
  });
  const blob = response.data;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'monitoring-billing-daily.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}
