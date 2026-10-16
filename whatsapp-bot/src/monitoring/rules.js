const DAY_MS = 24 * 60 * 60 * 1000;
const SUCCESS_RANK = {
  queued: 1,
  accepted: 1,
  sending: 1,
  sent: 2,
  delivered: 3,
  read: 4,
};
const FAILURE_STATUSES = new Set(['failed', 'undelivered']);

function round1(value) {
  return Math.round(value * 10) / 10;
}

function result(status, severity, summary, signals) {
  return { status, severity, summary, signals };
}

export function deriveBotHealth({
  processUp,
  databaseOk,
  flowsLoaded,
  lastErrorAt = null,
  lastProcessedAt = null,
  lastSuccessfulFlowAt = null,
  now = new Date(),
  errorWindowMs = 15 * 60 * 1000,
}) {
  if (!processUp) {
    return { status: 'CRITICAL', operationalState: 'BACKEND_DEGRADED' };
  }
  if (!databaseOk) {
    return { status: 'CRITICAL', operationalState: 'DB_ISSUE' };
  }
  if (!flowsLoaded) {
    return { status: 'DEGRADED', operationalState: 'BACKEND_DEGRADED' };
  }
  const errorAt = lastErrorAt ? new Date(lastErrorAt).getTime() : NaN;
  const successAt = lastSuccessfulFlowAt ? new Date(lastSuccessfulFlowAt).getTime() : NaN;
  const errorIsLatest = Number.isFinite(errorAt)
    && (now.getTime() - errorAt) < errorWindowMs
    && (!Number.isFinite(successAt) || errorAt > successAt);
  if (errorIsLatest) {
    return { status: 'DEGRADED', operationalState: 'BACKEND_DEGRADED' };
  }
  if (!lastProcessedAt && !lastSuccessfulFlowAt) {
    return { status: 'HEALTHY', operationalState: 'PROCESS_UP' };
  }
  return { status: 'HEALTHY', operationalState: 'BOT_OPERATIONAL' };
}

export function classifyBalance(balance, thresholds) {
  if (balance == null || balance === '') return { severity: 'UNKNOWN' };
  const value = Number(balance);
  if (!Number.isFinite(value)) return { severity: 'UNKNOWN' };
  const warning = Number(thresholds.warning);
  const critical = Number(thresholds.critical);
  const emergency = Number(thresholds.emergency);
  if (value < emergency) return { severity: 'EMERGENCY' };
  if (value < critical) return { severity: 'CRITICAL' };
  if (value < warning) return { severity: 'WARNING' };
  return { severity: 'HEALTHY' };
}

export function estimateAutonomy(samples) {
  const points = (samples || [])
    .map((sample) => ({
      at: new Date(sample.checkedAt).getTime(),
      balance: Number(sample.balance),
    }))
    .filter((sample) => Number.isFinite(sample.at) && Number.isFinite(sample.balance))
    .sort((a, b) => a.at - b.at);
  if (points.length < 2) {
    return { avgDailySpend: null, estimatedDaysRemaining: null, reason: 'insufficient_samples' };
  }
  const oldest = points[0];
  const newest = points[points.length - 1];
  const spanMs = newest.at - oldest.at;
  if (spanMs < DAY_MS) {
    return { avgDailySpend: null, estimatedDaysRemaining: null, reason: 'span_under_24h' };
  }
  const spent = oldest.balance - newest.balance;
  if (!(spent > 0)) {
    return { avgDailySpend: null, estimatedDaysRemaining: null, reason: 'no_net_spend' };
  }
  const days = spanMs / DAY_MS;
  const avgDailySpend = spent / days;
  return {
    avgDailySpend: round1(avgDailySpend),
    estimatedDaysRemaining: round1(newest.balance / avgDailySpend),
    reason: 'ok',
  };
}

export function detectInboundAnomaly({ actual, baseline, minExpected, enabled }) {
  const actualCount = Number(actual);
  const expected = Number(baseline);
  const minimum = Number(minExpected);
  if (!enabled) {
    return { anomaly: false, reason: 'disabled', actual: actualCount, expected, severity: null };
  }
  if (!Number.isFinite(actualCount) || !Number.isFinite(expected) || !Number.isFinite(minimum)) {
    return { anomaly: false, reason: 'invalid_inputs', actual: null, expected: null, severity: null };
  }
  if (expected < minimum) {
    return {
      anomaly: false,
      reason: 'baseline_below_minimum',
      actual: actualCount,
      expected,
      severity: null,
    };
  }
  if (actualCount === 0) {
    return {
      anomaly: true,
      reason: 'inbound_dropped_against_baseline',
      actual: actualCount,
      expected,
      severity: 'CRITICAL',
    };
  }
  return { anomaly: false, reason: 'traffic_present', actual: actualCount, expected, severity: null };
}

export function reconcileMessageSets({ twilioSids = [], dbSids = [], queryFailed = false } = {}) {
  if (queryFailed) {
    return { status: 'TWILIO_QUERY_FAILED', missingInDb: [], dbOnly: [] };
  }
  const twilio = new Set(twilioSids.filter(Boolean));
  const db = new Set(dbSids.filter(Boolean));
  const missingInDb = [...twilio].filter((sid) => !db.has(sid));
  const dbOnly = [...db].filter((sid) => !twilio.has(sid));
  let status = 'TWILIO_AND_DB_OK';
  if (missingInDb.length > 0) status = 'TWILIO_RECEIVED_NOT_IN_DB';
  else if (dbOnly.length > 0) status = 'DB_ONLY';
  return { status, missingInDb, dbOnly };
}

export function shouldApplyDeliveryStatus(current, next) {
  const incoming = String(next || '').toLowerCase();
  if (!incoming) return false;
  const previous = String(current || '').toLowerCase();
  if (!previous) return true;
  if (previous === 'read') return false;
  if (previous === 'delivered') return incoming === 'read';
  if (FAILURE_STATUSES.has(previous)) return false;
  if (FAILURE_STATUSES.has(incoming)) return true;
  return (SUCCESS_RANK[incoming] || 0) >= (SUCCESS_RANK[previous] || 0);
}

export function isFailureRateHigh({ failed, delivered, read, minimumSample = 5, threshold = 0.2 }) {
  const fail = Number(failed) || 0;
  const ok = (Number(delivered) || 0) + (Number(read) || 0);
  const sample = fail + ok;
  if (sample < minimumSample) return false;
  return fail / sample >= threshold;
}

export function isRetentionStale({
  enabled,
  lastFinishedAt,
  lastStatus,
  intervalHours,
  processStartedAt,
  now = new Date(),
}) {
  if (!enabled) return false;
  if (lastStatus === 'RUNNING') return false;
  const intervalMs = Number(intervalHours) * 60 * 60 * 1000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return false;
  const limit = intervalMs * 1.5;
  if (!lastFinishedAt) {
    const started = new Date(processStartedAt).getTime();
    return Number.isFinite(started) && now.getTime() - started > limit;
  }
  const finished = new Date(lastFinishedAt).getTime();
  return Number.isFinite(finished) && now.getTime() - finished > limit;
}

function accountActive(status) {
  return String(status || '').toLowerCase() === 'active';
}

function senderOnline(status) {
  return String(status || '').toUpperCase() === 'ONLINE';
}

export function classifyIncident(signals) {
  const used = [
    { name: 'processUp', value: signals.processUp },
    { name: 'databaseOk', value: signals.databaseOk },
    { name: 'flowsLoaded', value: signals.flowsLoaded },
    { name: 'accountStatus', value: signals.accountStatus ?? null },
    { name: 'senderStatus', value: signals.senderStatus ?? null },
    { name: 'balance', value: signals.balance ?? null },
    { name: 'inboundActual', value: signals.inboundActual ?? null },
    { name: 'inboundBaseline', value: signals.inboundBaseline ?? null },
    { name: 'inboundAnomaly', value: Boolean(signals.inboundAnomaly) },
    { name: 'outboundRecent', value: signals.outboundRecent ?? null },
    { name: 'reconciliationStatus', value: signals.reconciliationStatus ?? null },
    { name: 'failureRateHigh', value: Boolean(signals.failureRateHigh) },
  ];
  const balance = signals.balance == null ? null : Number(signals.balance);
  const balanceSeverity = signals.balanceSeverity || null;

  if (!signals.processUp) {
    return result('BACKEND_ISSUE', 'CRITICAL', 'Bot process is not running', used);
  }
  if (!signals.databaseOk) {
    return result('DB_ISSUE', 'CRITICAL', 'Database is not reachable', used);
  }
  if (signals.accountStatus && !accountActive(signals.accountStatus)) {
    return result('TWILIO_ACCOUNT_ISSUE', 'CRITICAL', 'Twilio account is not active', used);
  }
  if ((balance != null && balance <= 0) || balanceSeverity === 'EMERGENCY') {
    return result('TWILIO_ACCOUNT_ISSUE', 'CRITICAL', 'Twilio balance is at an emergency level', used);
  }
  if (signals.senderStatus && !senderOnline(signals.senderStatus)) {
    return result('TWILIO_SENDER_ISSUE', 'CRITICAL', 'WhatsApp sender is not ONLINE', used);
  }
  const upstreamPattern = Boolean(signals.inboundAnomaly)
    && accountActive(signals.accountStatus)
    && senderOnline(signals.senderStatus)
    && balance != null
    && balance > 0
    && signals.databaseOk
    && Number(signals.outboundRecent) > 0;
  if (upstreamPattern) {
    return result(
      'PROVIDER_ISSUE',
      'CRITICAL',
      'Possible upstream inbound routing issue',
      used,
    );
  }
  if (signals.reconciliationStatus === 'TWILIO_RECEIVED_NOT_IN_DB') {
    return result(
      'BACKEND_ISSUE',
      'DEGRADED',
      'Twilio received messages that are not in the database',
      used,
    );
  }
  if (signals.failureRateHigh) {
    return result('OUTBOUND_DELIVERY_ISSUE', 'DEGRADED', 'Outbound failure rate is high', used);
  }
  if (signals.inboundAnomaly && Number(signals.outboundRecent) === 0) {
    return result(
      'NO_ACTIVITY',
      'DEGRADED',
      'No recent inbound or outbound against an expected baseline',
      used,
    );
  }
  if (balanceSeverity === 'CRITICAL' || balanceSeverity === 'WARNING') {
    return result('TWILIO_ACCOUNT_ISSUE', 'DEGRADED', 'Twilio balance is below the configured threshold', used);
  }
  if (signals.twilioCheckOk === false) {
    return result('UNKNOWN', 'DEGRADED', 'Twilio health check failed', used);
  }
  if (!signals.flowsLoaded) {
    return result('BACKEND_ISSUE', 'DEGRADED', 'No published flow is loaded', used);
  }
  if (signals.recentError) {
    return result('BACKEND_ISSUE', 'DEGRADED', 'A recent processing error is the latest signal', used);
  }
  if (signals.inboundAnomaly) {
    return result('INBOUND_ANOMALY', 'DEGRADED', 'Inbound is below the expected baseline', used);
  }
  return result('HEALTHY', 'HEALTHY', 'Signals are within expected bounds', used);
}

export function evaluateAlertConditions(input) {
  const alerts = [];
  const push = (type, severity, component, reason) => {
    alerts.push({
      type,
      severity,
      component,
      reason,
      evidence: input.evidence || {},
    });
  };
  if (input.databaseOk === false) {
    push('DB_UNAVAILABLE', 'CRITICAL', 'database', 'Database is not reachable');
  }
  if (input.accountStatus && !accountActive(input.accountStatus)) {
    push('ACCOUNT_NOT_ACTIVE', 'CRITICAL', 'twilio', 'Twilio account is not active');
  }
  if (input.balanceSeverity === 'EMERGENCY') {
    push('BALANCE_EMERGENCY', 'CRITICAL', 'twilio', 'Twilio balance is below the emergency threshold');
  } else if (input.balanceSeverity === 'CRITICAL') {
    push('BALANCE_CRITICAL', 'CRITICAL', 'twilio', 'Twilio balance is below the critical threshold');
  } else if (input.balanceSeverity === 'WARNING') {
    push('BALANCE_WARNING', 'DEGRADED', 'twilio', 'Twilio balance is below the warning threshold');
  }
  if (input.senderStatus && !senderOnline(input.senderStatus)) {
    push('SENDER_OFFLINE', 'CRITICAL', 'whatsapp_sender', 'WhatsApp sender is not ONLINE');
  }
  if (input.inboundAnomaly && Number(input.outboundRecent) > 0) {
    push('INBOUND_ANOMALY', 'CRITICAL', 'inbound', 'Possible upstream inbound routing issue');
  }
  if (input.inboundAnomaly && Number(input.outboundRecent) === 0) {
    push('BOT_NO_ACTIVITY', 'DEGRADED', 'bot', 'No inbound or outbound against an expected baseline');
  }
  if (input.reconciliationStatus === 'TWILIO_RECEIVED_NOT_IN_DB') {
    push('RECONCILIATION_MISMATCH', 'DEGRADED', 'reconciliation', 'Twilio messages are missing from the database');
  }
  if (input.failureRateHigh) {
    push('HIGH_FAILURE_RATE', 'DEGRADED', 'outbound', 'Outbound failure rate is high');
  }
  if (input.retentionStale) {
    push('RETENTION_STALE', 'DEGRADED', 'jobs', 'Conversation retention has not finished inside the expected window');
  }
  return alerts;
}

export function clearedAlertTypes(input) {
  const cleared = [];
  if (input.databaseOk === true) cleared.push('DB_UNAVAILABLE');
  if (input.accountStatus && accountActive(input.accountStatus)) cleared.push('ACCOUNT_NOT_ACTIVE');
  if (input.balanceSeverity === 'HEALTHY') {
    cleared.push('BALANCE_WARNING', 'BALANCE_CRITICAL', 'BALANCE_EMERGENCY');
  }
  if (input.senderStatus && senderOnline(input.senderStatus)) cleared.push('SENDER_OFFLINE');
  if (input.inboundEvaluated && !input.inboundAnomaly) {
    cleared.push('INBOUND_ANOMALY', 'BOT_NO_ACTIVITY');
  }
  if (input.reconciliationStatus === 'TWILIO_AND_DB_OK' || input.reconciliationStatus === 'DB_ONLY') {
    cleared.push('RECONCILIATION_MISMATCH');
  }
  if (input.failureEvaluated && !input.failureRateHigh) cleared.push('HIGH_FAILURE_RATE');
  if (input.retentionEvaluated && !input.retentionStale) cleared.push('RETENTION_STALE');
  return cleared;
}

export function shouldEmitAlert(lastSentAt, now, cooldownMinutes) {
  if (!lastSentAt) return true;
  const previous = new Date(lastSentAt).getTime();
  if (!Number.isFinite(previous)) return true;
  return now.getTime() - previous >= Number(cooldownMinutes) * 60 * 1000;
}
