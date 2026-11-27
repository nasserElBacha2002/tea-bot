import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationTakeoverService } from './conversation-takeover.service.js';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import {
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  captureAllStructuredLogs,
  ensureCorrelationId,
  logAttentionTransition,
  outcomeFromError,
  reasonCodeForReentry,
} from './conversation-attention-transition-log.js';

const AGENT_A = '11111111-1111-4111-8111-111111111111';

function actor(agentId, role = 'admin') {
  return { agentId, role, username: 'agent-a' };
}

test('privacidad: no emite reason ni texto libre', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.manualTakeover,
      outcome: OUTCOMES.confirmed,
      conversationId: 'conv',
      correlationId: ensureCorrelationId(),
      reasonCode: REASON_CODES.manualTakeover,
      reason: 'texto libre del operador',
      resolutionNote: 'nota sensible',
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.ok(transition);
  assert.equal(transition.reason, undefined);
  assert.equal(transition.resolutionNote, undefined);
  assert.equal(transition.reasonCode, REASON_CODES.manualTakeover);
});

test('correlationId siempre presente aunque falte en el payload', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.reopen,
      outcome: OUTCOMES.confirmed,
      conversationId: 'conv',
      reasonCode: REASON_CODES.newInboundMessage,
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.ok(transition?.correlationId);
  assert.match(transition.correlationId, /^[0-9a-f-]{36}$/i);
});

test('outcomeFromError distingue rechazo operativo de fallo inesperado', () => {
  assert.deepEqual(outcomeFromError({ code: 'FORBIDDEN' }), {
    outcome: OUTCOMES.rejected,
    errorCode: 'FORBIDDEN',
  });
  assert.deepEqual(outcomeFromError(new Error('boom')), {
    outcome: OUTCOMES.error,
    errorCode: 'UNEXPECTED_FAILURE',
  });
});

test('compatibilidad: return to bot emite conversation_returned_to_bot en confirmación', async () => {
  const events = await captureAllStructuredLogs(async () => {
    let conversation = {
      id: 'conv-return',
      status: 'assigned',
      assignedAgentId: 'agent-1',
      externalUserId: 'twilio:+54111',
    };
    const service = new ConversationBotLifecycleService({
      conversationRepo: {
        async findByIdForUpdate() {
          return { ...conversation };
        },
        async updateConversation(_id, patch) {
          conversation = { ...conversation, ...patch, status: 'bot' };
          return { ...conversation };
        },
      },
      sessionRepo: {
        async findLatestOpenByConversationId() {
          return { id: 'sess', status: 'paused' };
        },
        async endAllOpenForConversation() {
          return 1;
        },
      },
      handoffRepo: {
        async resolveActiveHandoffs() {
          return ['handoff-1'];
        },
      },
      runtimeSession: {
        async resetSession() {},
      },
      runTransaction: (fn) => fn({}),
    });
    await service.returnConversationToBot(conversation, {
      correlationId: 'corr-return-1',
      reasonCode: REASON_CODES.inboxClose,
    });
  });
  assert.ok(events.some((row) => row.event === 'conversation_returned_to_bot'));
  assert.ok(events.some((row) => row.event === 'conversation_attention_transition'));
});

test('takeover: fallo inesperado sin code registra outcome error', async () => {
  const transitions = [];
  const service = new ConversationTakeoverService({
    enabled: () => true,
    assertSchema: async () => {},
    logTransition: (entry) => transitions.push(entry),
    runTransaction: async () => {
      throw new Error('db exploded');
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return { id: 'conv', status: 'waiting_human', statusVersion: 1 };
      },
    },
  });
  await assert.rejects(() => service.takeover({
    conversationId: 'conv',
    actor: actor(AGENT_A),
    clientRequestId: 'req-fail',
  }));
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].outcome, OUTCOMES.error);
  assert.equal(transitions[0].errorCode, 'UNEXPECTED_FAILURE');
  assert.equal(transitions[0].correlationId, ensureCorrelationId('req-fail'));
});

test('reentry reasonCode solo usa catálogo controlado', () => {
  assert.equal(reasonCodeForReentry('legacy_return'), REASON_CODES.reentryLegacyReturn);
  assert.equal(reasonCodeForReentry('comentario libre'), REASON_CODES.reentryInbound);
});