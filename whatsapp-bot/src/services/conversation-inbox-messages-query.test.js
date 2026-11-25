import test from 'node:test';
import assert from 'node:assert/strict';

import conversationInboxService from './conversation-inbox.service.js';
import conversationRepository from '../repositories/conversation.repository.js';
import conversationSearchRepository from '../repositories/conversation-search.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';

const original = {
  getConversationById: conversationRepository.getConversationById,
  listAroundMessage: conversationSearchRepository.listAroundMessage,
  listLatestTail: conversationMessageRepository.listLatestTail,
};

test.before(() => {
  conversationInboxService.ensureReady = async () => {};
});

test.afterEach(() => {
  conversationRepository.getConversationById = original.getConversationById;
  conversationSearchRepository.listAroundMessage = original.listAroundMessage;
  conversationMessageRepository.listLatestTail = original.listLatestTail;
});

test('rechaza anclas combinadas', async () => {
  conversationRepository.getConversationById = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
  await assert.rejects(
    () => conversationInboxService.getConversationMessages('11111111-1111-4111-8111-111111111111', {
      aroundMessageId: '22222222-2222-4222-8222-222222222222',
      beforeMessageId: '33333333-3333-4333-8333-333333333333',
    }),
    (err) => err.code === 'VALIDATION',
  );
});

test('rechaza tail con ancla', async () => {
  conversationRepository.getConversationById = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
  await assert.rejects(
    () => conversationInboxService.getConversationMessages('11111111-1111-4111-8111-111111111111', {
      tail: '1',
      aroundMessageId: '22222222-2222-4222-8222-222222222222',
    }),
    (err) => err.code === 'VALIDATION',
  );
});

test('rechaza identificador inválido', async () => {
  conversationRepository.getConversationById = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
  await assert.rejects(
    () => conversationInboxService.getConversationMessages('11111111-1111-4111-8111-111111111111', {
      aroundMessageId: 'not-a-uuid',
    }),
    (err) => err.code === 'VALIDATION',
  );
});