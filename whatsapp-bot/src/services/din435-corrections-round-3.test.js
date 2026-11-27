import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanHandoffService } from './human-handoff.service.js';
import { ConversationReentryService } from './conversation-reentry.service.js';
import { ConversationInboxService } from './conversation-inbox.service.js';
import conversationService from './conversation.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import {
  ERROR_CODES,
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  captureAllStructuredLogs,
  logAttentionTransition,
  logAuxiliaryAttentionEvent,
  ensureCorrelationId,
  outcomeFromError,
} from './conversation-attention-transition-log.js';

const CONV_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HANDOFF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_A = '11111111-1111-4111-8111-111111111111';
const AGENT_B = '22222222-2222-4222-8222-222222222222';

test('ROUND3: sanitización rechaza teléfono, nodeKey PII y errorCode arbitrario', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: CONV_ID,
      correlationId: '5491100000000',
      nodeKey: 'Nombre_Apellido_Ficticio',
      errorCode: 'TOKEN_SECRETO_FICTICIO',
      reasonCode: REASON_CODES.humanHandoff,
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.ok(transition);
  assert.notEqual(transition.correlationId, '5491100000000');
  assert.equal(transition.nodeKey, undefined);
  assert.equal(transition.errorCode, undefined);
});

test('ROUND3: outcomeFromError clasifica técnicos como error', () => {
  assert.deepEqual(outcomeFromError({ code: 'ETIMEOUT' }), {
    outcome: OUTCOMES.error,
    errorCode: 'ETIMEOUT',
  });
  assert.deepEqual(outcomeFromError({ code: 'ECONNRESET' }), {
    outcome: OUTCOMES.error,
    errorCode: 'ECONNRESET',
  });
  assert.deepEqual(outcomeFromError({ code: ERROR_CODES.runtimeResetFailed }), {
    outcome: OUTCOMES.error,
    errorCode: ERROR_CODES.runtimeResetFailed,
  });
  assert.deepEqual(outcomeFromError({ code: 'FORBIDDEN' }), {
    outcome: OUTCOMES.rejected,
    errorCode: 'FORBIDDEN',
  });
});

test('ROUND3: legacy assign repetida persiste y notifica sin confirmed falso', async () => {
  let markCalls = 0;
  let handoffUpdates = 0;
  const prevMark = conversationService.markAssigned;
  const prevPending = humanHandoffRepository.findPendingByConversationId;
  const prevUpdate = humanHandoffRepository.updateHandoff;
  const prevLatest = humanHandoffRepository.findLatestByConversationId;
  conversationService.markAssigned = async () => {
    markCalls += 1;
    return {
      id: CONV_ID,
      status: 'assigned',
      assignedAgentId: AGENT_A,
      statusVersion: 5,
    };
  };
  humanHandoffRepository.findPendingByConversationId = async () => ({
    id: HANDOFF_ID,
    status: 'assigned',
    assignedAgentId: AGENT_A,
  });
  humanHandoffRepository.updateHandoff = async (id, patch) => {
    handoffUpdates += 1;
    return { id, ...patch };
  };
  humanHandoffRepository.findLatestByConversationId = async () => null;

  const events = await captureAllStructuredLogs(async () => {
    const service = new ConversationInboxService();
    service.ensureReady = async () => {};
    await service._assignConversationToAgent(
      CONV_ID,
      AGENT_A,
      { id: CONV_ID, status: 'assigned', assignedAgentId: AGENT_A },
      'corr-legacy-r3',
    );
  });

  conversationService.markAssigned = prevMark;
  humanHandoffRepository.findPendingByConversationId = prevPending;
  humanHandoffRepository.updateHandoff = prevUpdate;
  humanHandoffRepository.findLatestByConversationId = prevLatest;

  assert.equal(markCalls, 1);
  assert.equal(handoffUpdates, 1);
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.equal(transition?.outcome, OUTCOMES.idempotentReplay);
});

test('ROUND3: reentry con commit externo emite confirmed tras advance', async () => {
  const transitions = [];
  let conversation = {
    id: CONV_ID,
    status: 'bot',
    externalUserId: 'twilio:+5491100000001',
    reentryJson: {
      status: 'awaiting_choice',
      resumeNodeKey: 'welcome',
      flowId: 'main-menu',
    },
  };

  const handoffService = new HumanHandoffService({
    handoffRepo: {
      async ensurePendingHandoffAtomic(conversationId) {
        return {
          handoff: { id: HANDOFF_ID, conversationId, status: 'pending' },
          created: true,
        };
      },
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return { ...conversation, status: 'bot' };
      },
      async updateConversation(_id, patch) {
        conversation = { ...conversation, ...patch, status: 'waiting_human' };
        return { ...conversation };
      },
    },
    sessionRepo: {
      async findActiveByConversationId() {
        return null;
      },
    },
    runTransaction: async (fn) => fn({ id: 'inner' }),
    logTransition: (entry) => transitions.push(entry),
  });

  const reentry = new ConversationReentryService({
    handoffService,
    policy: () => 'prompt',
    queriesEnabled: () => false,
    runTransaction: async (fn) => fn({ id: 'outer' }),
    conversationRepo: {
      async findByIdForUpdate() {
        return { ...conversation, reentryJson: conversation.reentryJson };
      },
      async updateConversation(_id, patch) {
        conversation = { ...conversation, ...patch };
        return { ...conversation };
      },
    },
    sessionRepo: {
      async endAllOpenForConversation() {
        return 0;
      },
    },
    messageRepo: {},
    runtimeSession: { async resetSession() {} },
    flowLoader: { async getFlow() { return { id: 'main-menu', nodes: [] }; } },
  });

  const result = await reentry.advance(conversation, 'humano', {
    providerMessageId: 'SMabcdefabcdefabcdefabcdefabcdefab',
  });
  assert.equal(result?.action, 'handoff');
  assert.equal(
    transitions.filter((row) => row.transitionType === TRANSITION_TYPES.botHandoff && row.outcome === OUTCOMES.confirmed).length,
    1,
  );
});

test('ROUND3: reentry con rollback externo no emite confirmed de handoff', async () => {
  const transitions = [];
  let conversation = {
    id: CONV_ID,
    status: 'bot',
    externalUserId: 'twilio:+5491100000001',
    reentryJson: {
      status: 'awaiting_choice',
      resumeNodeKey: 'welcome',
      flowId: 'main-menu',
    },
  };

  const handoffService = new HumanHandoffService({
    handoffRepo: {
      async ensurePendingHandoffAtomic(conversationId) {
        return {
          handoff: { id: HANDOFF_ID, conversationId, status: 'pending' },
          created: true,
        };
      },
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return { ...conversation, status: 'bot' };
      },
      async updateConversation(_id, patch) {
        conversation = { ...conversation, ...patch, status: 'waiting_human' };
        return { ...conversation };
      },
    },
    sessionRepo: {
      async findActiveByConversationId() {
        return null;
      },
    },
    runTransaction: async (fn) => fn({ id: 'inner' }),
    logTransition: (entry) => transitions.push(entry),
  });

  const reentry = new ConversationReentryService({
    handoffService,
    policy: () => 'prompt',
    queriesEnabled: () => false,
    runTransaction: async (fn) => {
      const applied = await fn({ id: 'outer' });
      throw new Error('outer rollback');
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return { ...conversation, reentryJson: conversation.reentryJson };
      },
      async updateConversation(_id, patch) {
        conversation = { ...conversation, ...patch };
        return { ...conversation };
      },
    },
    sessionRepo: {
      async endAllOpenForConversation() {
        return 0;
      },
    },
    messageRepo: {},
    runtimeSession: { async resetSession() {} },
    flowLoader: { async getFlow() { return { id: 'main-menu', nodes: [] }; } },
  });

  await assert.rejects(
    () => reentry.advance(conversation, 'humano', { providerMessageId: 'SM12345678901234567890123456789012' }),
  );
  assert.equal(transitions.filter((row) => row.outcome === OUTCOMES.confirmed).length, 0);
});

test('ROUND3: eventos auxiliares históricos correlacionan sin mensaje crudo', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAuxiliaryAttentionEvent('manual_takeover_runtime_reset_failed', {
      conversationId: CONV_ID,
      correlationId: 'corr-aux-r3',
      errorCode: ERROR_CODES.runtimeResetFailed,
      outcome: OUTCOMES.error,
      error: 'mensaje crudo no debe aparecer',
    });
    logAuxiliaryAttentionEvent('evento_desconocido', { conversationId: CONV_ID });
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].event, 'manual_takeover_runtime_reset_failed');
  assert.equal(events[0].correlationId, ensureCorrelationId('corr-aux-r3'));
  assert.equal(events[0].errorCode, ERROR_CODES.runtimeResetFailed);
  assert.equal(events[0].error, undefined);
});

test('ROUND3: nodeKey válido en snake_case se preserva', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: CONV_ID,
      nodeKey: 'human_handoff',
      reasonCode: REASON_CODES.humanHandoff,
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.equal(transition?.nodeKey, 'human_handoff');
});

test('ROUND3: Twilio correlation válido se preserva', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.aborted,
      conversationId: CONV_ID,
      correlationId: 'SM12345678901234567890123456789012',
      reasonCode: REASON_CODES.humanHandoff,
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.equal(transition?.correlationId, 'SM12345678901234567890123456789012');
});