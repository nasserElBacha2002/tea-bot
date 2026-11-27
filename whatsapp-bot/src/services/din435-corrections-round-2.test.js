import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanHandoffService } from './human-handoff.service.js';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { ConversationInboxService } from './conversation-inbox.service.js';
import conversationService from './conversation.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import {
  ERROR_CODES,
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  captureAllStructuredLogs,
  ensureCorrelationId,
  logAttentionTransition,
  logLegacyAttentionEvent,
  outcomeFromError,
} from './conversation-attention-transition-log.js';

const CONV_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HANDOFF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT_ID = '11111111-1111-4111-8111-111111111111';

test('handoff con transacción externa no emite confirmed hasta emitCommittedHandoffTransition', async () => {
  const transitions = [];
  let conversation = {
    id: CONV_ID,
    status: 'bot',
    currentNodeKey: 'welcome',
    statusVersion: 1,
  };
  const handoffRepo = {
    async ensurePendingHandoffAtomic(conversationId) {
      return {
        handoff: { id: HANDOFF_ID, conversationId, status: 'pending' },
        created: true,
      };
    },
  };
  const conversationRepo = {
    async findByIdForUpdate() {
      return { ...conversation };
    },
    async updateConversation(_id, patch) {
      conversation = { ...conversation, ...patch, statusVersion: 2 };
      return { ...conversation };
    },
  };
  const sessionRepo = {
    async findActiveByConversationId() {
      return null;
    },
  };
  const service = new HumanHandoffService({
    handoffRepo,
    conversationRepo,
    sessionRepo,
    runTransaction: async (fn) => fn({ id: 'outer-tx' }),
    logTransition: (entry) => transitions.push(entry),
  });

  const result = await service.requestHumanHandoff(conversation, {
    engineResult: { terminalReason: 'human_handoff', currentNodeId: 'human_handoff' },
    event: { messageId: 'SMcccccccccccccccccccccccccccccccc' },
    transaction: { id: 'external' },
    deferNotify: true,
  });

  assert.equal(transitions.filter((row) => row.outcome === OUTCOMES.confirmed).length, 0);
  assert.ok(result.handoffTelemetry);
  service.emitCommittedHandoffTransition(result.handoffTelemetry);
  assert.equal(transitions.filter((row) => row.outcome === OUTCOMES.confirmed).length, 1);
  assert.equal(transitions[0].correlationId, 'SMcccccccccccccccccccccccccccccccc');
});

test('rollback externo: sin emitCommittedHandoffTransition no hay confirmed', async () => {
  const transitions = [];
  const service = new HumanHandoffService({
    handoffRepo: {
      async ensurePendingHandoffAtomic() {
        return { handoff: { id: HANDOFF_ID }, created: true };
      },
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return { id: CONV_ID, status: 'bot' };
      },
      async updateConversation(_id, patch) {
        return { id: CONV_ID, ...patch, status: 'waiting_human' };
      },
    },
    sessionRepo: { async findActiveByConversationId() { return null; } },
    runTransaction: async (fn) => fn({}),
    logTransition: (entry) => transitions.push(entry),
  });

  const result = await service.requestHumanHandoff(
    { id: CONV_ID, status: 'bot' },
    {
      engineResult: { terminalReason: 'human_handoff' },
      transaction: { id: 'rolled-back' },
      deferNotify: true,
    },
  );
  assert.ok(result.handoffTelemetry);
  assert.equal(transitions.filter((row) => row.outcome === OUTCOMES.confirmed).length, 0);
});

test('sanitización: correlationId, nodeKey y errorCode rechazan texto libre', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: CONV_ID,
      correlationId: 'texto libre con espacios',
      nodeKey: 'welcome<script>',
      errorCode: 'motivo-personal',
      reasonCode: REASON_CODES.humanHandoff,
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.ok(transition?.correlationId);
  assert.notEqual(transition.correlationId, 'texto libre con espacios');
  assert.equal(transition.nodeKey, undefined);
  assert.equal(transition.errorCode, undefined);
});

test('return_to_bot propaga correlationId en error de reset y expone resolvedHandoffIds', async () => {
  const transitions = [];
  const resolvedIds = [HANDOFF_ID];
  const service = new ConversationBotLifecycleService({
    conversationRepo: {
      async findByIdForUpdate() {
        return { id: CONV_ID, status: 'assigned', currentNodeKey: 'human_handoff' };
      },
      async updateConversation(_id, patch) {
        return {
          id: CONV_ID,
          status: 'bot',
          statusVersion: 2,
          externalUserId: 'twilio:+1',
          currentNodeKey: 'human_handoff',
          ...patch,
        };
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
        return resolvedIds;
      },
    },
    runtimeSession: {
      async resetSession() {
        throw new Error('reset failed');
      },
    },
    runTransaction: (fn) => fn({}),
    logTransition: (entry) => transitions.push(entry),
  });

  await service.returnConversationToBot(
    { id: CONV_ID, status: 'assigned', externalUserId: 'twilio:+1', currentNodeKey: 'human_handoff' },
    { correlationId: 'corr-return-round2', reasonCode: REASON_CODES.inboxClose },
  );

  const main = transitions.find((row) => row.transitionType === TRANSITION_TYPES.returnToBot && row.outcome === OUTCOMES.confirmed);
  const resetError = transitions.find((row) => row.errorCode === ERROR_CODES.runtimeResetFailed);
  assert.ok(main);
  assert.deepEqual(main.resolvedHandoffIds, [HANDOFF_ID]);
  const logCorr = ensureCorrelationId('corr-return-round2');
  assert.equal(main.correlationId, logCorr);
  assert.ok(resetError);
  assert.equal(resetError.correlationId, logCorr);
});

test('legacy assign repetida no genera confirmed', async () => {
  let markCalls = 0;
  const prevMark = conversationService.markAssigned;
  conversationService.markAssigned = async () => {
    markCalls += 1;
    return { id: CONV_ID, status: 'assigned', assignedAgentId: AGENT_ID, statusVersion: 2 };
  };
  const events = await captureAllStructuredLogs(async () => {
    const service = new ConversationInboxService();
    service.ensureReady = async () => {};
    await service._assignConversationToAgent(
      CONV_ID,
      AGENT_ID,
      { id: CONV_ID, status: 'assigned', assignedAgentId: AGENT_ID },
      'corr-legacy-repeat',
    );
  });
  conversationService.markAssigned = prevMark;
  assert.equal(markCalls, 1);
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.equal(transition?.outcome, OUTCOMES.idempotentReplay);
  assert.equal(transition?.correlationId, ensureCorrelationId('corr-legacy-repeat'));
});

test('evento histórico conversation_returned_to_bot se conserva', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logLegacyAttentionEvent('conversation_returned_to_bot', {
      conversationId: CONV_ID,
      correlationId: 'corr-legacy',
      previousStatus: 'assigned',
      newStatus: 'bot',
      reasonCode: REASON_CODES.returnToBot,
      resolvedHandoffIds: [HANDOFF_ID],
    });
    logLegacyAttentionEvent('evento_no_historico', { conversationId: CONV_ID });
  });
  assert.equal(events.filter((row) => row.event === 'conversation_returned_to_bot').length, 1);
  assert.equal(events.filter((row) => row.event === 'evento_no_historico').length, 0);
});

test('outcomeFromError: código operativo vs fallo técnico', () => {
  assert.equal(outcomeFromError({ code: 'FORBIDDEN' }).outcome, OUTCOMES.rejected);
  assert.equal(outcomeFromError({ code: 'ETIMEOUT' }).outcome, OUTCOMES.error);
  assert.equal(outcomeFromError({ code: ERROR_CODES.runtimeResetFailed }).outcome, OUTCOMES.error);
  assert.equal(outcomeFromError({ code: 'CONVERSATION_PERSISTENCE_UNAVAILABLE' }).outcome, OUTCOMES.error);
  assert.equal(outcomeFromError({ code: 'not-valid-code' }).outcome, OUTCOMES.error);
  assert.equal(outcomeFromError(new Error('x')).outcome, OUTCOMES.error);
});

test('handoff propio rechaza con error operativo y preserva throw', async () => {
  const transitions = [];
  const service = new HumanHandoffService({
    handoffRepo: {
      async ensurePendingHandoffAtomic() {
        const err = new Error('conflict');
        err.code = 'STATUS_VERSION_CONFLICT';
        throw err;
      },
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return { id: CONV_ID, status: 'bot' };
      },
    },
    sessionRepo: {},
    runTransaction: async (fn) => fn({}),
    logTransition: (entry) => transitions.push(entry),
  });
  await assert.rejects(() => service.requestHumanHandoff(
    { id: CONV_ID, status: 'bot' },
    { engineResult: { terminalReason: 'human_handoff' }, event: { correlationId: 'corr-handoff-err' } },
  ));
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].outcome, OUTCOMES.rejected);
  assert.equal(transitions[0].errorCode, 'STATUS_VERSION_CONFLICT');
  assert.equal(transitions[0].correlationId, ensureCorrelationId('corr-handoff-err'));
});

test('ensureCorrelationId preserva UUID funcional', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal(ensureCorrelationId(id), id);
});