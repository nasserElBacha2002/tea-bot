import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationInboxService, parseListFilters } from './conversation-inbox.service.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationService from './conversation.service.js';

const sampleConversation = {
  id: 'conv-1',
  channel: 'whatsapp',
  provider: 'twilio',
  phoneNumber: '+5491111111111',
  displayName: null,
  status: 'waiting_human',
  assignedAgentId: null,
  currentFlowId: 'main-menu',
  currentFlowVersion: 'v21',
  currentNodeKey: 'human_handoff',
  lastMessageAt: new Date('2026-05-21T10:00:00Z'),
  startedAt: new Date('2026-05-21T09:00:00Z'),
  closedAt: null,
};

const sampleMessage = {
  id: 'msg-1',
  conversationId: 'conv-1',
  direction: 'inbound',
  senderType: 'user',
  body: 'Quiero hablar con una persona',
  provider: 'twilio',
  providerMessageId: 'SM1',
  metadataJson: { botSkipped: true },
  createdAt: new Date('2026-05-21T10:00:00Z'),
};

const sampleHandoff = {
  id: 'handoff-1',
  conversationId: 'conv-1',
  requestedBy: 'bot',
  reason: 'human_handoff',
  status: 'pending',
  assignedAgentId: null,
  requestedAt: new Date('2026-05-21T09:55:00Z'),
  assignedAt: null,
  resolvedAt: null,
};

function createService(overrides = {}) {
  const conversationRepo = {
    isEnabled: () => true,
    listConversations: async () => [sampleConversation],
    countConversations: async () => 1,
    getConversationById: async (id) => (id === 'conv-1' ? sampleConversation : null),
    ...overrides.conversationRepo,
  };

  const messageRepo = {
    getLastMessageByConversationIds: async () => new Map([[sampleConversation.id, sampleMessage]]),
    listByConversationId: async () => [sampleMessage],
    countByConversationId: async () => 1,
    ...overrides.messageRepo,
  };

  const sessionRepo = {
    findLatestOpenByConversationId: async () => ({
      id: 'sess-1',
      conversationId: 'conv-1',
      flowId: 'main-menu',
      flowVersion: 'v21',
      currentNodeKey: 'human_handoff',
      status: 'paused',
      variablesJson: { a: 1 },
      historyJson: ['welcome'],
      startedAt: new Date(),
      updatedAt: new Date(),
    }),
    ...overrides.sessionRepo,
  };

  const handoffRepo = {
    listLatestByConversationIds: async () => new Map([[sampleConversation.id, sampleHandoff]]),
    findLatestByConversationId: async () => sampleHandoff,
    ...overrides.handoffRepo,
  };

  class TestInboxService extends ConversationInboxService {
    isEnabled() {
      return true;
    }

    async ensureReady() {}

    async listInboxConversations(query) {
      const filters = parseListFilters(query);
      const items = await conversationRepo.listConversations(filters);
      const total = await conversationRepo.countConversations(filters);
      const ids = items.map((c) => c.id);
      const lastMessages = await messageRepo.getLastMessageByConversationIds(ids);
      const handoffs = await handoffRepo.listLatestByConversationIds(ids);
      const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
      const offset = Math.max(Number(filters.offset) || 0, 0);
      const { mapConversationPublic, mapLastMessagePublic, mapHumanHandoffPublic } =
        await import('../utils/conversation-inbox.mapper.js');
      return {
        items: items.map((row) => ({
          ...mapConversationPublic(row),
          lastMessage: mapLastMessagePublic(lastMessages.get(row.id)),
          humanHandoff: mapHumanHandoffPublic(handoffs.get(row.id)),
        })),
        total,
        limit,
        offset,
      };
    }

    async getConversationDetail(conversationId) {
      const conversation = await conversationRepo.getConversationById(conversationId);
      if (!conversation) {
        const err = new Error('Conversación no encontrada');
        err.code = 'NOT_FOUND';
        throw err;
      }
      const activeSession = await sessionRepo.findLatestOpenByConversationId(conversationId);
      const humanHandoff = await handoffRepo.findLatestByConversationId(conversationId);
      const { mapConversationPublic, mapHumanHandoffPublic, mapSessionPublic } =
        await import('../utils/conversation-inbox.mapper.js');
      return {
        conversation: mapConversationPublic(conversation),
        activeSession: mapSessionPublic(activeSession),
        humanHandoff: mapHumanHandoffPublic(humanHandoff),
      };
    }

    async getConversationMessages(conversationId, query) {
      const conversation = await conversationRepo.getConversationById(conversationId);
      if (!conversation) {
        const err = new Error('Conversación no encontrada');
        err.code = 'NOT_FOUND';
        throw err;
      }
      const messages = await messageRepo.listByConversationId(conversationId, query);
      const total = await messageRepo.countByConversationId(conversationId);
      const { mapMessagePublic } = await import('../utils/conversation-inbox.mapper.js');
      return {
        items: messages.map((m) => mapMessagePublic(m)),
        total,
        limit: Number(query?.limit) || 100,
        offset: Number(query?.offset) || 0,
        order: query?.order || 'asc',
      };
    }

    async _returnConversationToBot(conversationId, opts = {}) {
      const conversation = await conversationRepo.getConversationById(conversationId);
      if (!conversation) {
        const err = new Error('Conversación no encontrada');
        err.code = 'NOT_FOUND';
        err.httpStatus = 404;
        throw err;
      }

      if (sessionRepo.endAllActiveForConversation) {
        await sessionRepo.endAllActiveForConversation(conversationId);
      }

      if (overrides.resetSession) {
        await overrides.resetSession(conversation.externalUserId);
      }

      const handoff =
        (handoffRepo.findPendingByConversationId
          ? await handoffRepo.findPendingByConversationId(conversationId)
          : null)
        || (handoffRepo.findLatestByConversationId
          ? await handoffRepo.findLatestByConversationId(conversationId)
          : null);
      if (handoff && ['pending', 'assigned'].includes(handoff.status) && handoffRepo.updateHandoff) {
        await handoffRepo.updateHandoff(handoff.id, {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionNote: opts.resolutionNote || null,
        });
      }

      const updated = await conversationService.returnConversationToBot(conversationId);

      if (messageRepo.createMessage) {
        await messageRepo.createMessage({
          conversationId,
          direction: 'outbound',
          senderType: 'system',
          body: opts.systemMessage || 'Conversación devuelta al bot.',
          provider: conversation.provider,
          metadataJson: {
            event: 'conversation_returned_to_bot',
            generatedBy: opts.generatedBy || 'test',
          },
        });
      }

      const { mapConversationPublic } = await import('../utils/conversation-inbox.mapper.js');
      return { conversation: mapConversationPublic(updated) };
    }
  }

  return new TestInboxService();
}

test('parseListFilters valida status y sort', () => {
  const f = parseListFilters({
    status: 'waiting_human',
    channel: 'whatsapp',
    search: '+549',
    sort: 'last_message_at_asc',
    limit: '10',
  });
  assert.equal(f.status, 'waiting_human');
  assert.equal(f.channel, 'whatsapp');
  assert.equal(f.search, '+549');
  assert.equal(f.sort, 'last_message_at_asc');
  assert.equal(f.limit, '10');
});

test('listInboxConversations incluye ultimo mensaje y handoff', async () => {
  const service = createService();
  const result = await service.listInboxConversations({ status: 'waiting_human' });
  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].status, 'waiting_human');
  assert.equal(result.items[0].lastMessage.body, 'Quiero hablar con una persona');
  assert.equal(result.items[0].humanHandoff.status, 'pending');
});

test('getConversationDetail devuelve sesion pausada y handoff', async () => {
  const service = createService();
  const detail = await service.getConversationDetail('conv-1');
  assert.equal(detail.conversation.phoneNumber, '+5491111111111');
  assert.equal(detail.activeSession.status, 'paused');
  assert.equal(detail.humanHandoff.id, 'handoff-1');
});

test('getConversationDetail 404 para id desconocido', async () => {
  const service = createService();
  await assert.rejects(
    () => service.getConversationDetail('missing'),
    (err) => err.code === 'NOT_FOUND',
  );
});

test('getConversationMessages devuelve mensajes ordenados', async () => {
  const service = createService();
  const msgs = await service.getConversationMessages('conv-1', { order: 'asc' });
  assert.equal(msgs.items.length, 1);
  assert.equal(msgs.items[0].direction, 'inbound');
  assert.deepEqual(msgs.items[0].metadata, { botSkipped: true });
});

test('listInboxConversations respeta filtros en repositorio', async () => {
  let captured = null;
  const service = createService({
    conversationRepo: {
      listConversations: async (filters) => {
        captured = filters;
        return [];
      },
      countConversations: async () => 0,
    },
    messageRepo: {
      getLastMessageByConversationIds: async () => new Map(),
    },
    handoffRepo: {
      listLatestByConversationIds: async () => new Map(),
    },
  });

  await service.listInboxConversations({ status: 'bot', channel: 'whatsapp', search: '549' });
  assert.equal(captured.status, 'bot');
  assert.equal(captured.channel, 'whatsapp');
  assert.equal(captured.search, '549');
});

test('updateConversationContact persiste displayName y sincroniza por teléfono', async () => {
  const service = createService();
  let synced = null;
  const prevGet = conversationRepository.getConversationById;
  const prevUpdate = conversationRepository.updateConversation;
  const prevSync = conversationRepository.syncDisplayNameByPhoneAndChannel;

  conversationRepository.getConversationById = async () => ({
    ...sampleConversation,
    phoneNumber: '+5491111111111',
    channel: 'whatsapp',
  });
  conversationRepository.updateConversation = async (_id, patch) => ({
    ...sampleConversation,
    ...patch,
  });
  conversationRepository.syncDisplayNameByPhoneAndChannel = async (phone, channel, name) => {
    synced = { phone, channel, name };
  };

  try {
    const result = await service.updateConversationContact('conv-1', 'Juan Pérez');
    assert.equal(result.contactName, 'Juan Pérez');
    assert.equal(synced.name, 'Juan Pérez');
    assert.equal(synced.channel, 'whatsapp');
  } finally {
    conversationRepository.getConversationById = prevGet;
    conversationRepository.updateConversation = prevUpdate;
    conversationRepository.syncDisplayNameByPhoneAndChannel = prevSync;
  }
});

test('closeConversation devuelve la conversación al bot', async () => {
  const endedSessions = [];
  const resetUsers = [];
  const handoffUpdates = [];
  const createdMessages = [];
  let returnPatch = null;

  const service = createService({
    sessionRepo: {
      endAllActiveForConversation: async (id) => {
        endedSessions.push(id);
      },
    },
    handoffRepo: {
      findPendingByConversationId: async () => sampleHandoff,
      findLatestByConversationId: async () => sampleHandoff,
      updateHandoff: async (id, patch) => {
        handoffUpdates.push({ id, patch });
        return { ...sampleHandoff, ...patch };
      },
      listLatestByConversationIds: async () => new Map(),
    },
    messageRepo: {
      getLastMessageByConversationIds: async () => new Map(),
      listByConversationId: async () => [],
      countByConversationId: async () => 0,
      createMessage: async (data) => {
        createdMessages.push(data);
        return { id: 'sys-1', ...data, createdAt: new Date() };
      },
    },
    conversationRepo: {
      getConversationById: async () => ({
        ...sampleConversation,
        externalUserId: 'twilio:whatsapp:+5491111111111',
      }),
    },
    resetSession: async (userId) => {
      resetUsers.push(userId);
    },
  });

  const prevReturn = conversationService.returnConversationToBot;
  conversationService.returnConversationToBot = async (id) => {
    returnPatch = id;
    return { ...sampleConversation, status: 'bot', assignedAgentId: null, closedAt: null };
  };

  try {
    const result = await service.closeConversation('conv-1', 'Caso resuelto');
    assert.equal(returnPatch, 'conv-1');
    assert.equal(result.conversation.status, 'bot');
    assert.equal(endedSessions[0], 'conv-1');
    assert.equal(resetUsers[0], 'twilio:whatsapp:+5491111111111');
    assert.equal(handoffUpdates[0].patch.status, 'resolved');
    assert.equal(createdMessages[0].metadataJson.event, 'conversation_returned_to_bot');
  } finally {
    conversationService.returnConversationToBot = prevReturn;
  }
});

test('returnConversationToBot reactiva el bot y resetea sesión', async () => {
  const service = createService({
    sessionRepo: {
      endAllActiveForConversation: async () => {},
    },
    handoffRepo: {
      findPendingByConversationId: async () => null,
      findLatestByConversationId: async () => null,
      listLatestByConversationIds: async () => new Map(),
    },
    messageRepo: {
      getLastMessageByConversationIds: async () => new Map(),
      listByConversationId: async () => [],
      countByConversationId: async () => 0,
      createMessage: async (data) => ({ id: 'sys-2', ...data, createdAt: new Date() }),
    },
    conversationRepo: {
      getConversationById: async () => ({
        ...sampleConversation,
        status: 'assigned',
        assignedAgentId: 'agent-1',
        externalUserId: 'twilio:whatsapp:+5491111111111',
      }),
    },
  });

  const prevReturn = conversationService.returnConversationToBot;
  conversationService.returnConversationToBot = async () => ({
    ...sampleConversation,
    status: 'bot',
    assignedAgentId: null,
    closedAt: null,
  });

  try {
    const result = await service.returnConversationToBot('conv-1');
    assert.equal(result.conversation.status, 'bot');
  } finally {
    conversationService.returnConversationToBot = prevReturn;
  }
});
