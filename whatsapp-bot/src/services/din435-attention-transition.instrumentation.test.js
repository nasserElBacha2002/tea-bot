import test from 'node:test';
import assert from 'node:assert/strict';
import { HumanHandoffService } from './human-handoff.service.js';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { ConversationInboxService } from './conversation-inbox.service.js';
import conversationService from './conversation.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import {
  OUTCOMES,
  TRANSITION_TYPES,
  captureAttentionTransitionLogs,
  ensureCorrelationId,
} from './conversation-attention-transition-log.js';

function createHandoffMocks(initialStatus = 'bot') {
  let conversation = {
    id: 'conv-h-1',
    status: initialStatus,
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v1',
    currentNodeKey: 'welcome',
    assignedAgentId: null,
    statusVersion: 1,
  };
  const handoffs = [];
  const handoffRepo = {
    async ensurePendingHandoffAtomic(conversationId, data) {
      const row = {
        id: 'handoff-1',
        conversationId,
        ...data,
        status: 'pending',
      };
      handoffs.push(row);
      return { handoff: row, created: true };
    },
  };
  const conversationRepo = {
    async findByIdForUpdate() {
      return { ...conversation };
    },
    async updateConversation(_id, patch) {
      conversation = {
        ...conversation,
        ...patch,
        statusVersion: patch.incrementStatusVersion
          ? Number(conversation.statusVersion || 0) + 1
          : conversation.statusVersion,
      };
      return { ...conversation };
    },
  };
  const sessionRepo = {
    async findActiveByConversationId() {
      return { id: 'sess-1', status: 'active' };
    },
    async updateSession(id, patch) {
      return { id, ...patch };
    },
  };
  const transitions = [];
  const service = new HumanHandoffService({
    handoffRepo,
    conversationRepo,
    sessionRepo,
    runTransaction: (fn) => fn({}),
    logTransition: (entry) => transitions.push(entry),
  });
  return { service, getConversation: () => conversation, transitions };
}

test('DIN-435: handoff bot confirma waiting_human con correlación inbound', async () => {
  const mocks = createHandoffMocks();
  await mocks.service.requestHumanHandoff(mocks.getConversation(), {
    engineResult: { terminalReason: 'human_handoff', currentNodeId: 'human_handoff' },
    event: { messageId: 'SMabcdefabcdefabcdefabcdefabcdefab' },
  });
  assert.equal(mocks.transitions.length, 1);
  assert.equal(mocks.transitions[0].transitionType, TRANSITION_TYPES.botHandoff);
  assert.equal(mocks.transitions[0].outcome, OUTCOMES.confirmed);
  assert.equal(mocks.transitions[0].correlationId, 'SMabcdefabcdefabcdefabcdefabcdefab');
  assert.equal(mocks.transitions[0].newStatus, 'waiting_human');
});

test('DIN-435: handoff abortado no emite confirmed', async () => {
  const mocks = createHandoffMocks('waiting_human');
  await mocks.service.requestHumanHandoff(mocks.getConversation(), {
    engineResult: { terminalReason: 'human_handoff', currentNodeId: 'human_handoff' },
    event: { messageId: 'SMbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
  });
  assert.equal(mocks.transitions.length, 1);
  assert.equal(mocks.transitions[0].outcome, OUTCOMES.aborted);
  assert.equal(
    mocks.transitions.filter((row) => row.outcome === OUTCOMES.confirmed).length,
    0,
  );
});

test('DIN-435: return to bot enriquece evento confirmado e idempotente', async () => {
  const handoffs = [{
    id: 'handoff-return',
    conversationId: 'conv-return',
    status: 'assigned',
  }];
  let conversation = {
    id: 'conv-return',
    status: 'assigned',
    assignedAgentId: 'agent-1',
    currentNodeKey: 'human_handoff',
    statusVersion: 3,
    externalUserId: 'twilio:+54111',
  };
  const transitions = [];
  let endOpenCalls = 0;
  let resolveHandoffCalls = 0;
  const service = new ConversationBotLifecycleService({
    conversationRepo: {
      async findByIdForUpdate() {
        return { ...conversation };
      },
      async updateConversation(_id, patch) {
        conversation = {
          ...conversation,
          ...patch,
          statusVersion: patch.incrementStatusVersion
            ? Number(conversation.statusVersion) + 1
            : conversation.statusVersion,
        };
        return { ...conversation };
      },
    },
    sessionRepo: {
      async findLatestOpenByConversationId() {
        return { id: 'sess', status: 'paused' };
      },
      async endAllOpenForConversation() {
        endOpenCalls += 1;
        return endOpenCalls === 1 ? 1 : 0;
      },
    },
    handoffRepo: {
      async resolveActiveHandoffs() {
        resolveHandoffCalls += 1;
        if (resolveHandoffCalls > 1) return [];
        handoffs[0].status = 'resolved';
        return ['handoff-return'];
      },
    },
    runtimeSession: {
      async resetSession() {},
    },
    runTransaction: (fn) => fn({}),
    logTransition: (entry) => transitions.push(entry),
  });

  const first = await service.returnConversationToBot(conversation, { resolutionNote: 'ok' });
  await service.returnConversationToBot(first.conversation);

  const confirmed = transitions.filter((row) => row.outcome === OUTCOMES.confirmed);
  const replay = transitions.filter((row) => row.outcome === OUTCOMES.idempotentReplay);
  assert.equal(confirmed.length, 1);
  assert.equal(replay.length, 1);
  assert.equal(confirmed[0].transitionType, TRANSITION_TYPES.returnToBot);
});

test('DIN-435: helper no altera operación si console.log falla', async () => {
  const { logAttentionTransition } = await import('./conversation-attention-transition-log.js');
  const original = console.log;
  console.log = () => {
    throw new Error('broken sink');
  };
  try {
    assert.doesNotThrow(() => logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: 'conv',
    }));
  } finally {
    console.log = original;
  }
});

test('DIN-435: asignación legacy emite confirmed tras commit', async () => {
  const events = await captureAttentionTransitionLogs(async () => {
    const service = new ConversationInboxService();
    service.ensureReady = async () => {};
    const prevMark = conversationService.markAssigned;
    const prevPending = humanHandoffRepository.findPendingByConversationId;
    const prevUpdate = humanHandoffRepository.updateHandoff;
    conversationService.markAssigned = async () => ({
      id: 'conv-legacy',
      status: 'assigned',
      statusVersion: 4,
    });
    humanHandoffRepository.findPendingByConversationId = async () => ({
      id: 'handoff-legacy',
      status: 'pending',
    });
    humanHandoffRepository.updateHandoff = async (id, patch) => ({ id, ...patch });
    try {
      await service._assignConversationToAgent(
        'conv-legacy',
        '11111111-1111-4111-8111-111111111111',
        { id: 'conv-legacy', status: 'waiting_human' },
        'corr-legacy-1',
      );
    } finally {
      conversationService.markAssigned = prevMark;
      humanHandoffRepository.findPendingByConversationId = prevPending;
      humanHandoffRepository.updateHandoff = prevUpdate;
    }
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].transitionType, TRANSITION_TYPES.legacyAssign);
  assert.equal(events[0].outcome, OUTCOMES.confirmed);
  assert.equal(events[0].previousStatus, 'waiting_human');
  assert.equal(events[0].correlationId, ensureCorrelationId('corr-legacy-1'));
});

test('DIN-435: captura de stdout solo incluye transitions permitidas', async () => {
  const events = await captureAttentionTransitionLogs(async () => {
    const { logAttentionTransition } = await import('./conversation-attention-transition-log.js');
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.reopen,
      outcome: OUTCOMES.confirmed,
      conversationId: 'conv',
    });
    console.log(JSON.stringify({ event: 'other_event' }));
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].transitionType, TRANSITION_TYPES.reopen);
});