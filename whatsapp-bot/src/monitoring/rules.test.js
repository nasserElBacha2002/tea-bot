import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyBalance,
  classifyIncident,
  clearedAlertTypes,
  deriveBotHealth,
  detectInboundAnomaly,
  estimateAutonomy,
  evaluateAlertConditions,
  isFailureRateHigh,
  reconcileMessageSets,
  shouldApplyDeliveryStatus,
  shouldEmitAlert,
} from './rules.js';
import { sanitizeWebhookPayload } from './sanitize.js';
import { collectTwilioSnapshot, listRecentTwilioMessageSids } from './twilio-monitor.client.js';

const NOW = new Date('2026-10-16T12:00:00.000Z');

test('bot health: DB sana y actividad reciente es operativo', () => {
  const health = deriveBotHealth({
    processUp: true,
    databaseOk: true,
    flowsLoaded: true,
    lastProcessedAt: '2026-10-16T11:58:00.000Z',
    lastSuccessfulFlowAt: '2026-10-16T11:58:00.000Z',
    now: NOW,
  });
  assert.equal(health.status, 'HEALTHY');
  assert.equal(health.operationalState, 'BOT_OPERATIONAL');
});

test('bot health: DB caída', () => {
  const health = deriveBotHealth({
    processUp: true,
    databaseOk: false,
    flowsLoaded: true,
    now: NOW,
  });
  assert.equal(health.operationalState, 'DB_ISSUE');
  assert.equal(health.status, 'CRITICAL');
});

test('bot health: proceso vivo sin actividad todavía', () => {
  const health = deriveBotHealth({
    processUp: true,
    databaseOk: true,
    flowsLoaded: true,
    now: NOW,
  });
  assert.equal(health.operationalState, 'PROCESS_UP');
});

test('bot health: error reciente sin flujo exitoso posterior', () => {
  const health = deriveBotHealth({
    processUp: true,
    databaseOk: true,
    flowsLoaded: true,
    lastErrorAt: '2026-10-16T11:55:00.000Z',
    lastSuccessfulFlowAt: '2026-10-16T11:00:00.000Z',
    now: NOW,
  });
  assert.equal(health.operationalState, 'BACKEND_DEGRADED');
});

test('balance: healthy, warning, critical, emergency', () => {
  const thresholds = { warning: 20, critical: 10, emergency: 5 };
  assert.equal(classifyBalance(49.89, thresholds).severity, 'HEALTHY');
  assert.equal(classifyBalance(20, thresholds).severity, 'HEALTHY');
  assert.equal(classifyBalance(12.5, thresholds).severity, 'WARNING');
  assert.equal(classifyBalance(7, thresholds).severity, 'CRITICAL');
  assert.equal(classifyBalance(4, thresholds).severity, 'EMERGENCY');
  assert.equal(classifyBalance(null, thresholds).severity, 'UNKNOWN');
});

test('autonomía solo con muestras que cubren más de 24h y gasto neto', () => {
  const enough = estimateAutonomy([
    { checkedAt: '2026-10-14T12:00:00.000Z', balance: 20 },
    { checkedAt: '2026-10-16T12:00:00.000Z', balance: 12 },
  ]);
  assert.equal(enough.avgDailySpend, 4);
  assert.equal(enough.estimatedDaysRemaining, 3);
  const shortSpan = estimateAutonomy([
    { checkedAt: '2026-10-16T10:00:00.000Z', balance: 20 },
    { checkedAt: '2026-10-16T12:00:00.000Z', balance: 19 },
  ]);
  assert.equal(shortSpan.avgDailySpend, null);
  assert.equal(shortSpan.estimatedDaysRemaining, null);
});

test('anomalía inbound: cero contra baseline alto, no contra baseline bajo, tráfico normal sano', () => {
  const dropped = detectInboundAnomaly({ actual: 0, baseline: 18, minExpected: 5, enabled: true });
  assert.equal(dropped.anomaly, true);
  const quiet = detectInboundAnomaly({ actual: 0, baseline: 0, minExpected: 5, enabled: true });
  assert.equal(quiet.anomaly, false);
  assert.equal(quiet.reason, 'baseline_below_minimum');
  const normal = detectInboundAnomaly({ actual: 12, baseline: 14, minExpected: 5, enabled: true });
  assert.equal(normal.anomaly, false);
});

test('reconciliación: coincide, falta en DB, API caída', () => {
  const ok = reconcileMessageSets({ twilioSids: ['SM1'], dbSids: ['SM1'] });
  assert.equal(ok.status, 'TWILIO_AND_DB_OK');
  const missing = reconcileMessageSets({ twilioSids: ['SM1', 'SM2'], dbSids: ['SM1'] });
  assert.equal(missing.status, 'TWILIO_RECEIVED_NOT_IN_DB');
  assert.deepEqual(missing.missingInDb, ['SM2']);
  const failed = reconcileMessageSets({ queryFailed: true });
  assert.equal(failed.status, 'TWILIO_QUERY_FAILED');
});

test('clasificador: provider issue, DB, cuenta Twilio y healthy', () => {
  const provider = classifyIncident({
    processUp: true,
    databaseOk: true,
    flowsLoaded: true,
    accountStatus: 'active',
    senderStatus: 'ONLINE',
    balance: 49.89,
    balanceSeverity: 'HEALTHY',
    inboundAnomaly: true,
    inboundActual: 0,
    inboundBaseline: 18,
    outboundRecent: 17,
    reconciliationStatus: 'TWILIO_AND_DB_OK',
  });
  assert.equal(provider.status, 'PROVIDER_ISSUE');
  assert.equal(provider.summary, 'Possible upstream inbound routing issue');

  const db = classifyIncident({
    processUp: true,
    databaseOk: false,
    flowsLoaded: true,
    accountStatus: 'active',
    senderStatus: 'ONLINE',
    balance: 40,
  });
  assert.equal(db.status, 'DB_ISSUE');

  const account = classifyIncident({
    processUp: true,
    databaseOk: true,
    flowsLoaded: true,
    accountStatus: 'suspended',
    senderStatus: 'OFFLINE',
    balance: 0,
  });
  assert.equal(account.status, 'TWILIO_ACCOUNT_ISSUE');

  const healthy = classifyIncident({
    processUp: true,
    databaseOk: true,
    flowsLoaded: true,
    accountStatus: 'active',
    senderStatus: 'ONLINE',
    balance: 40,
    balanceSeverity: 'HEALTHY',
    inboundAnomaly: false,
    outboundRecent: 3,
    twilioCheckOk: true,
  });
  assert.equal(healthy.status, 'HEALTHY');
});

test('delivery status no pisa un estado final', () => {
  assert.equal(shouldApplyDeliveryStatus(null, 'queued'), true);
  assert.equal(shouldApplyDeliveryStatus('sent', 'delivered'), true);
  assert.equal(shouldApplyDeliveryStatus('delivered', 'sent'), false);
  assert.equal(shouldApplyDeliveryStatus('delivered', 'failed'), false);
  assert.equal(shouldApplyDeliveryStatus('read', 'delivered'), false);
  assert.equal(shouldApplyDeliveryStatus('sent', 'failed'), true);
  assert.equal(shouldApplyDeliveryStatus('delivered', 'read'), true);
});

test('alertas y cooldown', () => {
  const alerts = evaluateAlertConditions({
    databaseOk: true,
    accountStatus: 'active',
    senderStatus: 'ONLINE',
    balanceSeverity: 'CRITICAL',
    inboundAnomaly: true,
    outboundRecent: 4,
    reconciliationStatus: 'TWILIO_AND_DB_OK',
    failureRateHigh: false,
    retentionStale: false,
  });
  assert.equal(alerts.some((alert) => alert.type === 'BALANCE_CRITICAL'), true);
  assert.equal(alerts.some((alert) => alert.type === 'INBOUND_ANOMALY'), true);
  const cleared = clearedAlertTypes({
    databaseOk: true,
    accountStatus: 'active',
    senderStatus: 'ONLINE',
    balanceSeverity: 'HEALTHY',
    inboundEvaluated: true,
    inboundAnomaly: false,
    reconciliationStatus: 'TWILIO_AND_DB_OK',
    failureEvaluated: true,
    failureRateHigh: false,
    retentionEvaluated: true,
    retentionStale: false,
  });
  assert.equal(cleared.includes('INBOUND_ANOMALY'), true);
  assert.equal(shouldEmitAlert(null, NOW, 60), true);
  assert.equal(shouldEmitAlert('2026-10-16T11:30:00.000Z', NOW, 60), false);
  assert.equal(isFailureRateHigh({ failed: 3, delivered: 2, read: 0 }), true);
  assert.equal(isFailureRateHigh({ failed: 1, delivered: 1, read: 0 }), false);
});

test('sanitize no conserva campos sensibles', () => {
  const payload = sanitizeWebhookPayload({
    MessageSid: 'SM1',
    Body: 'hola',
    AuthToken: 'secret-token',
    password: 'nope',
  });
  assert.equal(payload.MessageSid, 'SM1');
  assert.equal(payload.Body, 'hola');
  assert.equal(payload.AuthToken, undefined);
  assert.equal(payload.password, undefined);
});

test('Twilio health: active/online, suspended, offline y error de API', async () => {
  const active = await collectTwilioSnapshot({
    accountSid: 'AC123',
    authToken: 'token-should-not-leak',
    fromAddress: 'whatsapp:+5491111111111',
    request: async ({ url }) => {
      assert.equal(JSON.stringify(url).includes('token-should-not-leak'), false);
      if (url.endsWith('/Balance.json')) return { status: 200, data: { balance: '49.89', currency: 'USD' } };
      if (url.includes('Channels/Senders')) {
        return {
          status: 200,
          data: {
            senders: [{
              sid: 'XE1',
              status: 'ONLINE',
              quality_rating: 'HIGH',
              sender_id: 'whatsapp:+5491111111111',
              offline_reasons: null,
            }],
          },
        };
      }
      return { status: 200, data: { status: 'active' } };
    },
  });
  assert.equal(active.accountStatus, 'active');
  assert.equal(active.senderStatus, 'ONLINE');
  assert.equal(active.qualityRating, 'HIGH');
  assert.equal(active.balance, 49.89);
  assert.equal(JSON.stringify(active).includes('token-should-not-leak'), false);

  const suspended = await collectTwilioSnapshot({
    accountSid: 'AC123',
    authToken: 'token',
    request: async ({ url }) => {
      if (url.endsWith('/Balance.json')) return { status: 200, data: { balance: '0', currency: 'USD' } };
      if (url.includes('Senders')) return { status: 200, data: { senders: [{ status: 'OFFLINE', sender_id: 'whatsapp:+1' }] } };
      return { status: 200, data: { status: 'suspended' } };
    },
  });
  assert.equal(suspended.accountStatus, 'suspended');
  assert.equal(suspended.senderStatus, 'OFFLINE');

  const failed = await collectTwilioSnapshot({
    accountSid: 'AC123',
    authToken: 'token',
    request: async () => ({ status: 503, data: {} }),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, 'account_query_failed');
});

test('listado Twilio falla sin inventar sids', async () => {
  const failed = await listRecentTwilioMessageSids({
    accountSid: 'AC123',
    authToken: 'token',
    lookbackMinutes: 60,
    request: async () => {
      throw new Error('network down');
    },
  });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.sids, []);
});
