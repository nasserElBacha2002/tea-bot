import { config } from '../config.js';
import { isConversationDbEnabled, pingDatabase } from '../db/index.js';
import flowLoader from '../utils/flow-loader.js';
import { getActivitySnapshot, mergeActivityTimestamps, noteActivity } from './activity-store.js';
import {
  getMonitorJobView,
  getRetentionJobView,
  hydrateJobMemory,
  noteMonitorJob,
} from './job-status.store.js';
import * as repository from './monitoring.repository.js';
import {
  classifyBalance,
  classifyIncident,
  clearedAlertTypes,
  deriveBotHealth,
  detectInboundAnomaly,
  estimateAutonomy,
  evaluateAlertConditions,
  isFailureRateHigh,
  isRetentionStale,
  reconcileMessageSets,
  shouldApplyDeliveryStatus,
  shouldEmitAlert,
} from './rules.js';
import { collectTwilioSnapshot, listRecentTwilioMessageSids } from './twilio-monitor.client.js';

const ACTIVITY_CACHE_MS = 30 * 1000;
const MINUTE_MS = 60 * 1000;

function emptyTwilio() {
  return {
    ok: false,
    status: 'UNKNOWN',
    accountStatus: null,
    balance: null,
    currency: null,
    senderStatus: null,
    qualityRating: null,
    offlineReasons: null,
    senderSid: null,
    webhookUrl: null,
    checkedAt: null,
    latencyMs: null,
    error: config.monitoringTwilioEnabled ? 'not_checked' : 'disabled',
  };
}

export class MonitoringService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.twilio = emptyTwilio();
    this.balanceView = {
      balance: null,
      severity: 'UNKNOWN',
      avgDailySpend: null,
      estimatedDaysRemaining: null,
    };
    this.activity = null;
    this.activityCachedAt = 0;
    this.reconciliation = { status: 'TWILIO_QUERY_FAILED', missingInDb: [], dbOnly: [], checkedAt: null };
    this.lastTwilioRunAt = 0;
    this.lastReconciliationRunAt = 0;
    this.lastAlertAt = new Map();
    this.lastDiagnosis = null;
  }

  start() {
    if (this.timer) return;
    if (!config.monitoringEnabled) {
      console.log('[Monitoring] disabled');
      return;
    }
    const twilioMinutes = config.monitoringTwilioIntervalMinutes;
    console.log(`[Monitoring] enabled twilio=${config.monitoringTwilioEnabled} intervalMin=${twilioMinutes}`);
    void hydrateJobMemory();
    void this.runScheduledTick();
    this.timer = setInterval(() => {
      void this.runScheduledTick();
    }, MINUTE_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runScheduledTick() {
    if (this.running || !config.monitoringEnabled) return;
    this.running = true;
    try {
      const now = Date.now();
      if (config.monitoringTwilioEnabled && now - this.lastTwilioRunAt >= config.monitoringTwilioIntervalMinutes * MINUTE_MS) {
        await this.refreshTwilio();
        this.lastTwilioRunAt = Date.now();
      }
      if (
        config.monitoringTwilioEnabled
        && config.twilioReconciliationEnabled
        && now - this.lastReconciliationRunAt >= config.monitoringReconciliationIntervalMinutes * MINUTE_MS
      ) {
        await this.refreshReconciliation();
        this.lastReconciliationRunAt = Date.now();
      }
      const overview = await this.getOverview();
      await this.applyAlerts(overview);
    } catch (error) {
      console.error(`[Monitoring] tick failed: ${error.message}`);
    } finally {
      this.running = false;
    }
  }

  async refreshTwilio() {
    const startedAt = new Date().toISOString();
    noteMonitorJob('twilio_health', { lastStartedAt: startedAt, lastStatus: 'RUNNING' });
    const snapshot = await collectTwilioSnapshot({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      fromAddress: config.twilioWhatsappFrom,
      timeoutMs: Number(process.env.TWILIO_REQUEST_TIMEOUT_MS || 15000),
    });
    const severity = classifyBalance(snapshot.balance, {
      warning: config.twilioBalanceWarningUsd,
      critical: config.twilioBalanceCriticalUsd,
      emergency: config.twilioBalanceEmergencyUsd,
    });
    this.twilio = {
      ...snapshot,
      status: snapshot.ok ? 'HEALTHY' : 'UNKNOWN',
    };
    if (snapshot.accountStatus && String(snapshot.accountStatus).toLowerCase() !== 'active') {
      this.twilio.status = 'CRITICAL';
    } else if (snapshot.senderStatus && String(snapshot.senderStatus).toUpperCase() !== 'ONLINE') {
      this.twilio.status = 'CRITICAL';
    } else if (severity.severity === 'EMERGENCY' || severity.severity === 'CRITICAL') {
      this.twilio.status = 'CRITICAL';
    } else if (severity.severity === 'WARNING') {
      this.twilio.status = 'DEGRADED';
    }
    this.balanceView = {
      balance: snapshot.balance,
      currency: snapshot.currency,
      severity: severity.severity,
      avgDailySpend: null,
      estimatedDaysRemaining: null,
    };
    if (snapshot.ok && snapshot.balance != null && isConversationDbEnabled()) {
      try {
        await repository.insertBalanceSample(snapshot.balance, snapshot.currency, snapshot.checkedAt);
        const samples = await repository.listBalanceSamples(new Date(Date.now() - 14 * 24 * 60 * 60 * 1000));
        const autonomy = estimateAutonomy(samples);
        this.balanceView.avgDailySpend = autonomy.avgDailySpend;
        this.balanceView.estimatedDaysRemaining = autonomy.estimatedDaysRemaining;
      } catch (error) {
        console.error(`[Monitoring] balance sample failed: ${error.message}`);
      }
    }
    noteMonitorJob('twilio_health', {
      lastFinishedAt: new Date().toISOString(),
      lastStatus: snapshot.ok ? 'SUCCESS' : 'FAILED',
      lastError: snapshot.ok ? null : snapshot.error,
      lastDurationMs: snapshot.latencyMs,
    });
  }

  async refreshReconciliation() {
    const startedAt = new Date().toISOString();
    noteMonitorJob('twilio_reconciliation', { lastStartedAt: startedAt, lastStatus: 'RUNNING' });
    const lookback = config.twilioReconciliationLookbackMinutes;
    const listed = await listRecentTwilioMessageSids({
      accountSid: config.twilioAccountSid,
      authToken: config.twilioAuthToken,
      lookbackMinutes: lookback,
      timeoutMs: Number(process.env.TWILIO_REQUEST_TIMEOUT_MS || 15000),
    });
    let compared = reconcileMessageSets({ queryFailed: true });
    if (listed.ok && isConversationDbEnabled()) {
      try {
        const since = new Date(Date.now() - lookback * MINUTE_MS);
        const dbSids = await repository.listPersistedTwilioSids(since);
        compared = reconcileMessageSets({ twilioSids: listed.sids, dbSids });
      } catch (error) {
        compared = reconcileMessageSets({ queryFailed: true });
        console.error(`[Monitoring] reconciliation query failed: ${error.message}`);
      }
    } else if (!listed.ok) {
      compared = reconcileMessageSets({ queryFailed: true });
    }
    this.reconciliation = {
      ...compared,
      missingCount: compared.missingInDb.length,
      dbOnlyCount: compared.dbOnly.length,
      truncated: Boolean(listed.truncated),
      checkedAt: new Date().toISOString(),
    };
    noteMonitorJob('twilio_reconciliation', {
      lastFinishedAt: this.reconciliation.checkedAt,
      lastStatus: compared.status,
      lastError: listed.ok ? null : listed.error,
    });
  }

  async getBotHealth() {
    noteActivity('lastHealthCheckAt');
    const activity = getActivitySnapshot();
    let database = { ok: false, latencyMs: null };
    if (isConversationDbEnabled()) {
      const started = Date.now();
      try {
        const ping = await pingDatabase();
        database = { ok: Boolean(ping.ok), latencyMs: Date.now() - started };
      } catch {
        database = { ok: false, latencyMs: Date.now() - started };
      }
    }
    let persisted = { ok: false };
    if (!isConversationDbEnabled()) {
      persisted = {
        ok: true,
        lastInboundAt: null,
        lastOutboundAt: null,
        lastProcessedAt: null,
      };
    } else if (database.ok) {
      try {
        persisted = await repository.readLatestActivity();
      } catch (error) {
        console.error(`[Monitoring] activity fallback failed: ${error.message}`);
        persisted = { ok: false };
      }
    }
    const merged = mergeActivityTimestamps(activity, persisted);
    const flowsLoaded = (flowLoader.cache?.size || 0) > 0;
    const derived = deriveBotHealth({
      processUp: true,
      databaseOk: database.ok,
      flowsLoaded,
      lastErrorAt: merged.lastErrorAt,
      lastProcessedAt: merged.lastProcessedAt,
      lastSuccessfulFlowAt: merged.lastSuccessfulFlowAt,
    });
    return {
      status: derived.status,
      operationalState: derived.operationalState,
      process: { up: true, startedAt: activity.processStartedAt },
      database,
      flowsLoaded,
      activity: {
        lastInboundAt: merged.lastInboundAt,
        lastOutboundAt: merged.lastOutboundAt,
        lastProcessedAt: merged.lastProcessedAt,
        lastSuccessfulFlowAt: merged.lastSuccessfulFlowAt,
        lastErrorAt: merged.lastErrorAt,
        activityPersistenceOk: merged.activityPersistenceOk,
      },
    };
  }

  async getTwilioHealth() {
    if (!config.monitoringEnabled || !config.monitoringTwilioEnabled) {
      return { ...emptyTwilio(), error: 'disabled' };
    }
    if (!this.twilio.checkedAt) await this.refreshTwilio();
    return publicTwilio(this.twilio);
  }

  async getBalance() {
    if (!this.balanceView || this.balanceView.balance == null) {
      if (config.monitoringEnabled && config.monitoringTwilioEnabled && !this.twilio.checkedAt) {
        await this.refreshTwilio();
      }
    }
    return { ...this.balanceView };
  }

  async getMessageActivity() {
    const now = Date.now();
    if (this.activity && now - this.activityCachedAt < ACTIVITY_CACHE_MS) return this.activity;
    if (!isConversationDbEnabled()) {
      this.activity = { available: false, reason: 'database_disabled' };
      this.activityCachedAt = now;
      return this.activity;
    }
    const at = new Date();
    const since = {
      m15: new Date(at.getTime() - 15 * MINUTE_MS),
      m60: new Date(at.getTime() - 60 * MINUTE_MS),
      h24: new Date(at.getTime() - 24 * 60 * MINUTE_MS),
    };
    try {
      const messages = await repository.countMessagesSince(since);
      let delivery = {
        last15m: { failed: 0, delivered: 0, read: 0 },
        last60m: { failed: 0, delivered: 0, read: 0 },
        last24h: { failed: 0, delivered: 0, read: 0 },
      };
      let processed = { last15m: 0, last60m: 0, last24h: 0 };
      let topErrors = [];
      try {
        delivery = await repository.deliveryWindowCounts(since);
        processed = await repository.countProcessedWebhooksSince(since);
        topErrors = await repository.topDeliveryErrorCodes(since.m60, 5);
      } catch {
        processed = {
          last15m: messages.last15m.inbound + messages.last15m.outbound,
          last60m: messages.last60m.inbound + messages.last60m.outbound,
          last24h: messages.last24h.inbound + messages.last24h.outbound,
        };
      }
      const windowMs = config.inboundAnomalyWindowMinutes * MINUTE_MS;
      const actual = await repository.countInboundBetween(new Date(at.getTime() - windowMs), at);
      const baseline = await repository.countInboundBetween(
        new Date(at.getTime() - windowMs - 24 * 60 * MINUTE_MS),
        new Date(at.getTime() - 24 * 60 * MINUTE_MS),
      );
      const anomaly = detectInboundAnomaly({
        actual,
        baseline,
        minExpected: config.inboundAnomalyMinExpected,
        enabled: config.monitoringEnabled && config.inboundAnomalyEnabled,
      });
      const rates = ratesFor(delivery.last60m);
      this.activity = {
        available: true,
        last15m: { ...messages.last15m, failed: delivery.last15m.failed, processed: processed.last15m },
        last60m: {
          ...messages.last60m,
          failed: delivery.last60m.failed,
          delivered: delivery.last60m.delivered,
          read: delivery.last60m.read,
          processed: processed.last60m,
        },
        last24h: { ...messages.last24h, failed: delivery.last24h.failed, processed: processed.last24h },
        anomaly,
        delivery: {
          ...rates,
          topErrorCodes: topErrors,
          failureRateHigh: isFailureRateHigh(delivery.last60m),
        },
      };
      this.activityCachedAt = now;
      return this.activity;
    } catch (error) {
      console.error(`[Monitoring] activity query failed: ${error.message}`);
      this.activity = { available: false, reason: 'query_failed' };
      this.activityCachedAt = now;
      return this.activity;
    }
  }

  async getFailedEvents() {
    if (!isConversationDbEnabled()) return { available: false, events: [] };
    try {
      const events = await repository.listFailedWebhookEvents(50);
      return {
        available: true,
        pending: events.length,
        lastError: events[0]?.errorMessage || null,
        events,
      };
    } catch (error) {
      console.error(`[Monitoring] failed events query failed: ${error.message}`);
      return { available: false, events: [] };
    }
  }

  async getJobs() {
    await hydrateJobMemory();
    const activity = getActivitySnapshot();
    const retention = getRetentionJobView();
    return {
      conversationRetention: retention,
      retentionStale: isRetentionStale({
        enabled: retention.enabled,
        lastFinishedAt: retention.lastFinishedAt,
        lastStatus: retention.lastStatus,
        intervalHours: retention.intervalHours,
        processStartedAt: activity.processStartedAt,
      }),
      ...getMonitorJobView(),
    };
  }

  async getIncidents() {
    if (!isConversationDbEnabled()) return [];
    try {
      return await repository.listRecentIncidents(20);
    } catch (error) {
      console.error(`[Monitoring] incidents query failed: ${error.message}`);
      return [];
    }
  }

  async getOverview() {
    const [bot, activity, jobs, incidents] = await Promise.all([
      this.getBotHealth(),
      this.getMessageActivity(),
      this.getJobs(),
      this.getIncidents(),
    ]);
    const recentError = bot.operationalState === 'BACKEND_DEGRADED' && bot.database.ok && bot.flowsLoaded;
    const diagnosis = classifyIncident({
      processUp: true,
      databaseOk: bot.database.ok,
      flowsLoaded: bot.flowsLoaded,
      recentError,
      accountStatus: this.twilio.accountStatus,
      senderStatus: this.twilio.senderStatus,
      balance: this.balanceView.balance,
      balanceSeverity: this.balanceView.severity,
      twilioCheckOk: config.monitoringTwilioEnabled ? this.twilio.ok : null,
      inboundActual: activity?.anomaly?.actual ?? null,
      inboundBaseline: activity?.anomaly?.expected ?? null,
      inboundAnomaly: Boolean(activity?.anomaly?.anomaly),
      outboundRecent: activity?.last60m?.outbound ?? null,
      reconciliationStatus: this.reconciliation.checkedAt ? this.reconciliation.status : null,
      failureRateHigh: Boolean(activity?.delivery?.failureRateHigh),
    });
    this.lastDiagnosis = diagnosis;
    return {
      generatedAt: new Date().toISOString(),
      monitoringEnabled: config.monitoringEnabled,
      diagnosis,
      bot,
      twilio: publicTwilio(this.twilio),
      balance: this.balanceView,
      activity,
      reconciliation: {
        status: this.reconciliation.status,
        missingCount: this.reconciliation.missingCount || 0,
        dbOnlyCount: this.reconciliation.dbOnlyCount || 0,
        truncated: Boolean(this.reconciliation.truncated),
        checkedAt: this.reconciliation.checkedAt,
      },
      jobs,
      incidents,
    };
  }

  async applyAlerts(overview) {
    if (!isConversationDbEnabled()) return;
    const input = {
      databaseOk: overview.bot.database.ok,
      accountStatus: overview.twilio.accountStatus,
      senderStatus: overview.twilio.senderStatus,
      balanceSeverity: overview.balance.severity,
      inboundAnomaly: Boolean(overview.activity?.anomaly?.anomaly),
      inboundEvaluated: Boolean(overview.activity?.available && config.inboundAnomalyEnabled),
      outboundRecent: overview.activity?.last60m?.outbound ?? 0,
      reconciliationStatus: overview.reconciliation.checkedAt ? overview.reconciliation.status : null,
      failureRateHigh: Boolean(overview.activity?.delivery?.failureRateHigh),
      failureEvaluated: Boolean(overview.activity?.available),
      retentionStale: Boolean(overview.jobs.retentionStale),
      retentionEvaluated: true,
      evidence: {
        accountStatus: overview.twilio.accountStatus,
        senderStatus: overview.twilio.senderStatus,
        balance: overview.balance.balance,
        inbound: overview.activity?.anomaly?.actual ?? null,
        expected: overview.activity?.anomaly?.expected ?? null,
        outbound60m: overview.activity?.last60m?.outbound ?? null,
        reconciliation: overview.reconciliation.status,
      },
    };
    const alerts = config.monitoringAlertsEnabled ? evaluateAlertConditions(input) : [];
    const now = new Date();
    for (const alert of alerts) {
      if (!shouldEmitAlert(this.lastAlertAt.get(alert.type), now, config.monitoringAlertCooldownMinutes)) {
        continue;
      }
      this.lastAlertAt.set(alert.type, now.toISOString());
      console.log(JSON.stringify({
        event: 'monitoring_alert',
        timestamp: now.toISOString(),
        severity: alert.severity,
        component: alert.component,
        reason: alert.reason,
        evidence: alert.evidence,
      }));
      try {
        await repository.openIncident({
          type: alert.type,
          severity: alert.severity,
          summary: alert.reason,
          details: alert.evidence,
        });
      } catch (error) {
        console.error(`[Monitoring] incident open failed: ${error.message}`);
      }
    }
    for (const type of clearedAlertTypes(input)) {
      try {
        await repository.resolveOpenIncidents(type);
      } catch (error) {
        console.error(`[Monitoring] incident resolve failed: ${error.message}`);
      }
    }
  }

  async recordDeliveryStatus(body) {
    if (!config.monitoringEnabled || !isConversationDbEnabled()) return { applied: false };
    const providerMessageId = body?.MessageSid || body?.SmsSid || null;
    const status = body?.MessageStatus || body?.SmsStatus || null;
    if (!providerMessageId || !status) return { applied: false };
    const previous = await repository.getDeliveryStatus('twilio', providerMessageId);
    if (!shouldApplyDeliveryStatus(previous, status)) return { applied: false, previous };
    const errorCode = body?.ErrorCode ? String(body.ErrorCode).slice(0, 64) : null;
    const errorMessage = body?.ErrorMessage ? String(body.ErrorMessage).slice(0, 400) : null;
    await repository.upsertDeliveryStatus({
      provider: 'twilio',
      providerMessageId,
      status: String(status).toLowerCase(),
      errorCode,
      errorMessage,
      statusAt: new Date(),
    });
    if (String(status).toLowerCase() === 'failed' || String(status).toLowerCase() === 'undelivered') {
      noteActivity('lastErrorAt', errorCode || status);
    }
    return { applied: true, previous };
  }
}

function ratesFor(window) {
  const failed = window.failed || 0;
  const delivered = window.delivered || 0;
  const read = window.read || 0;
  const sample = failed + delivered + read;
  if (sample === 0) {
    return { sample: 0, deliveryRate: null, failureRate: null, readRate: null };
  }
  const ratio = (value) => Math.round((value / sample) * 1000) / 10;
  return {
    sample,
    deliveryRate: ratio(delivered + read),
    failureRate: ratio(failed),
    readRate: ratio(read),
  };
}

function publicTwilio(snapshot) {
  return {
    status: snapshot.status || 'UNKNOWN',
    accountStatus: snapshot.accountStatus ?? null,
    balance: snapshot.balance ?? null,
    currency: snapshot.currency ?? null,
    senderStatus: snapshot.senderStatus ?? null,
    qualityRating: snapshot.qualityRating ?? null,
    offlineReasons: snapshot.offlineReasons ?? null,
    senderSid: snapshot.senderSid ?? null,
    webhookUrl: snapshot.webhookUrl ?? null,
    checkedAt: snapshot.checkedAt ?? null,
    latencyMs: snapshot.latencyMs ?? null,
    error: snapshot.error ?? null,
  };
}

const monitoringService = new MonitoringService();
export default monitoringService;
