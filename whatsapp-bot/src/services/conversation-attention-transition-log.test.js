import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  captureAttentionTransitionLogs,
  correlationFromInboundEvent,
  ensureCorrelationId,
  logAttentionTransition,
  outcomeFromError,
} from './conversation-attention-transition-log.js';

test('logAttentionTransition emite solo campos permitidos', async () => {
  const events = await captureAttentionTransitionLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.manualTakeover,
      outcome: OUTCOMES.confirmed,
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      handoffId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      correlationId: 'req-1',
      previousStatus: 'waiting_human',
      newStatus: 'assigned',
      reasonCode: REASON_CODES.manualTakeover,
      actorKind: 'operator',
      actorAgentId: '11111111-1111-4111-8111-111111111111',
      durationMs: 12.4,
      statusVersion: 4,
      actorUsername: 'secret-user',
      body: 'message text',
      reason: 'free text',
    });
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'conversation_attention_transition');
  assert.equal(events[0].transitionType, TRANSITION_TYPES.manualTakeover);
  assert.equal(events[0].outcome, OUTCOMES.confirmed);
  assert.equal(events[0].reason, undefined);
  assert.equal(events[0].actorUsername, undefined);
  assert.equal(events[0].body, undefined);
  assert.equal(events[0].reasonCode, REASON_CODES.manualTakeover);
  assert.equal(events[0].durationMs, 12);
});

test('logAttentionTransition genera correlationId si falta', async () => {
  const events = await captureAttentionTransitionLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reasonCode: REASON_CODES.humanHandoff,
    });
  });
  assert.match(events[0].correlationId, /^[0-9a-f-]{36}$/i);
});

test('logAttentionTransition ignora reasonCode fuera de catálogo', async () => {
  const events = await captureAttentionTransitionLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reasonCode: 'motivo libre del operador',
    });
  });
  assert.equal(events[0].reasonCode, undefined);
});

test('logAttentionTransition ignora payload sin transitionType u outcome', async () => {
  const events = await captureAttentionTransitionLogs(async () => {
    logAttentionTransition({ conversationId: 'x' });
    logAttentionTransition({ transitionType: TRANSITION_TYPES.reopen });
  });
  assert.equal(events.length, 0);
});

test('logAttentionTransition no lanza si JSON falla', async () => {
  const original = console.log;
  console.log = () => {
    throw new Error('sink broken');
  };
  try {
    assert.doesNotThrow(() => logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.aborted,
      conversationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      reasonCode: REASON_CODES.humanHandoff,
    }));
  } finally {
    console.log = original;
  }
});

test('correlationFromInboundEvent prioriza correlationId y messageId', () => {
  const twilioId = 'SMdddddddddddddddddddddddddddddddd';
  const clientCorrelation = ensureCorrelationId('corr-inbound-1');
  assert.equal(
    correlationFromInboundEvent({ correlationId: 'corr-inbound-1', messageId: twilioId }),
    clientCorrelation,
  );
  assert.notEqual(clientCorrelation, 'corr-inbound-1');
  assert.equal(correlationFromInboundEvent({ messageId: twilioId }), twilioId);
  assert.equal(correlationFromInboundEvent({}), null);
});

test('ensureCorrelationId usa valor existente o UUID', () => {
  const internal = ensureCorrelationId('req-abc');
  assert.equal(internal, ensureCorrelationId('req-abc'));
  assert.notEqual(internal, 'req-abc');
  assert.match(ensureCorrelationId(), /^[0-9a-f-]{36}$/i);
});

test('outcomeFromError separa rejected y error', () => {
  assert.equal(outcomeFromError({ code: 'NOT_FOUND' }).outcome, OUTCOMES.rejected);
  assert.equal(outcomeFromError(new Error('x')).outcome, OUTCOMES.error);
});