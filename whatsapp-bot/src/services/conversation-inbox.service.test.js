import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationInboxService, parseListFilters } from './conversation-inbox.service.js';
import conversationRepository from '../repositories/conversation.repository.js';

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

test('returnConversationToBot está desactivado', async () => {
  const service = createService();
  const prevGet = conversationRepository.getConversationById;
  conversationRepository.getConversationById = async () => sampleConversation;

  try {
    await assert.rejects(
      () => service.returnConversationToBot('conv-1'),
      (err) => err.code === 'RETURN_TO_BOT_DISABLED' && err.httpStatus === 410,
    );
  } finally {
    conversationRepository.getConversationById = prevGet;
  }
});
