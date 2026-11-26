import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';
import {
  ARGENTINA_PRESENTATION_TZ,
  getDailyWhatsAppMetrics,
  mapMetricsWindowRow,
} from './whatsapp-daily-metrics.js';
import * as metricsRepo from './monitoring-metrics.repository.js';
import * as repository from './monitoring.repository.js';

function disabledPayload(reason) {
  return {
    available: false,
    reason,
    monitoringEnabled: config.monitoringEnabled,
    databaseEnabled: isConversationDbEnabled(),
  };
}

function windowMeta(row) {
  if (!row) return null;
  return mapMetricsWindowRow({
    start_day_ar: row.start_day_ar,
    end_day_ar: row.end_day_ar,
    start_utc: row.start_utc,
    end_utc_exclusive: row.end_utc_exclusive,
  });
}

export async function getDailyMetrics({ days, asOf }) {
  if (!isConversationDbEnabled()) {
    return { ...disabledPayload('database_disabled'), data: null };
  }
  const data = await getDailyWhatsAppMetrics({ days, asOf });
  return {
    available: true,
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    fetchUsage: false,
    ...data,
  };
}

export async function getHandoffsMetrics({ days, asOf }) {
  if (!isConversationDbEnabled()) {
    return { ...disabledPayload('database_disabled') };
  }
  const [current, period, daily, windowRow] = await Promise.all([
    metricsRepo.getHandoffCurrentCounts(),
    metricsRepo.getHandoffPeriodStats(asOf, days),
    metricsRepo.getHandoffDailyCreated(asOf, days),
    metricsRepo.resolveMetricsWindow({ asOf, days }),
  ]);
  return {
    available: true,
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    window: windowMeta(windowRow),
    current,
    period,
    daily,
    definitions: {
      pending: 'human_handoffs.status = pending (instantáneo).',
      avgMinutesToAssign: 'Solo filas con assigned_at en ventana; NULL si no hay datos.',
      avgMinutesToResolve: 'Solo filas con resolved_at en ventana; NULL si no hay datos.',
    },
  };
}

export async function getConversationsMetrics({ days, asOf }) {
  if (!isConversationDbEnabled()) {
    return { ...disabledPayload('database_disabled') };
  }
  const [snapshot, daily, windowRow] = await Promise.all([
    metricsRepo.getConversationStatusSnapshot(),
    metricsRepo.getNewConversationsDaily(asOf, days),
    metricsRepo.resolveMetricsWindow({ asOf, days }),
  ]);
  return {
    available: true,
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    window: windowMeta(windowRow),
    snapshot,
    dailyNew: daily,
  };
}

export async function getSheetSyncMetrics() {
  if (!isConversationDbEnabled()) {
    return { ...disabledPayload('database_disabled') };
  }
  const snapshot = await metricsRepo.getSheetSyncJobSnapshot();
  return {
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    sheetSync: snapshot,
  externalPolling: {
    enabled: false,
    reason: config.monitoringEnabled ? 'GOOGLE_SHEETS_NOT_POLLED' : 'MONITORING_SCHEDULER_DISABLED',
  },
  };
}

export async function getWebhookStats({ webhookHours }) {
  if (!isConversationDbEnabled()) {
    return { ...disabledPayload('database_disabled') };
  }
  const since = new Date(Date.now() - webhookHours * 60 * 60 * 1000);
  const counts = await metricsRepo.getWebhookStatusCounts(since);
  return {
    available: true,
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    sinceUtc: since.toISOString(),
    webhookHours,
    counts,
    definitions: {
      note: 'Conteos de filas provider_webhook_events; no equivalen a mensajes únicos inbound.',
    },
  };
}

export async function getOperationalSummary({ days, asOf }) {
  if (!isConversationDbEnabled()) {
    return { ...disabledPayload('database_disabled') };
  }
  const windowRow = await metricsRepo.resolveMetricsWindow({ asOf, days });
  const [
    messages,
    deliveryFailed,
    conversations,
    handoffs,
    sheetSync,
    latestActivity,
    dbPing,
  ] = await Promise.all([
    metricsRepo.getPeriodMessageTotals(asOf, days),
    metricsRepo.getPeriodDeliveryFailures(asOf, days),
    metricsRepo.getConversationStatusSnapshot(),
    metricsRepo.getHandoffCurrentCounts(),
    metricsRepo.getSheetSyncJobSnapshot(),
    repository.readLatestActivity(),
    pingDatabase(),
  ]);

  const lastActivity = [
    latestActivity.lastInboundAt,
    latestActivity.lastOutboundAt,
    latestActivity.lastProcessedAt,
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .sort((a, b) => b - a)[0];

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    monitoringEnabled: config.monitoringEnabled,
    presentationTimeZone: ARGENTINA_PRESENTATION_TZ,
    storageTimeZone: 'UTC',
    window: windowMeta(windowRow),
    cards: {
      messagesReceived: messages.inbound,
      messagesSent: messages.whatsappOutbound,
      messagesSentAllOutbound: messages.outbound,
      messagesAutomatic: messages.outboundBot,
      messagesManual: messages.outboundAgent,
      deliveryFailedInPeriod: deliveryFailed,
      activeConversations: conversations.active,
      pendingHandoffs: handoffs.pending,
      registeredErrorsInPeriod: deliveryFailed,
      lastBotActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    },
    messages,
    conversations,
    handoffs,
    sheetSync,
    database: dbPing,
    twilioScheduler: {
      enabled: config.monitoringEnabled && config.monitoringTwilioEnabled,
      reconciliationEnabled: config.monitoringEnabled && config.twilioReconciliationEnabled,
    },
    retentionJob: {
      available: true,
      note: 'Ver GET /api/monitoring/jobs para última ejecución de retención.',
    },
  };
}

export default {
  getConversationsMetrics,
  getDailyMetrics,
  getHandoffsMetrics,
  getOperationalSummary,
  getSheetSyncMetrics,
  getWebhookStats,
};