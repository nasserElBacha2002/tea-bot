import test from 'node:test';
import assert from 'node:assert/strict';

import conversationSearchService from './conversation-search.service.js';
import conversationSearchRepository from '../repositories/conversation-search.repository.js';
import { resetConversationSearchRateLimitForTests } from '../middleware/conversation-search-rate-limit.middleware.js';
import { encodeSearchCursor } from '../utils/conversation-search.js';

const ORIGINAL = {
  ensure: conversationSearchService.ensureReady,
  searchContacts: conversationSearchRepository.searchContacts,
  searchGlobal: conversationSearchRepository.searchMessagesGlobal,
  searchInConv: conversationSearchRepository.searchMessagesInConversation,
  getById: conversationSearchRepository.getConversationById,
};

test.afterEach(() => {
  conversationSearchService.ensureReady = ORIGINAL.ensure;
  conversationSearchRepository.searchContacts = ORIGINAL.searchContacts;
  conversationSearchRepository.searchMessagesGlobal = ORIGINAL.searchGlobal;
  conversationSearchRepository.searchMessagesInConversation = ORIGINAL.searchInConv;
  conversationSearchRepository.getConversationById = ORIGINAL.getById;
  resetConversationSearchRateLimitForTests();
});

test('searchGlobal valida q corto', async () => {
  conversationSearchService.ensureReady = async () => {};
  await assert.rejects(
    () => conversationSearchService.searchGlobal({ q: 'a' }),
    (err) => err.code === 'VALIDATION',
  );
});

test('searchGlobal devuelve contactos y mensajes con snippet', async () => {
  conversationSearchService.ensureReady = async () => {};
  conversationSearchRepository.searchContacts = async () => ({
    items: [{
      id: '11111111-1111-4111-8111-111111111111',
      displayName: 'Ana',
      phoneNumber: '+54911',
      lastMessageAt: new Date('2024-01-02T00:00:00.000Z'),
      matchKind: 'name',
    }],
    hasMore: false,
    nextCursor: null,
  });
  conversationSearchRepository.searchMessagesGlobal = async () => ({
    items: [{
      id: '22222222-2222-4222-8222-222222222222',
      conversationId: '11111111-1111-4111-8111-111111111111',
      direction: 'inbound',
      senderType: 'user',
      body: 'Hola café',
      createdAt: new Date('2024-01-02T00:00:00.000Z'),
      displayName: 'Ana',
      phoneNumber: '+54911',
    }],
    hasMore: false,
    nextCursor: null,
  });

  const data = await conversationSearchService.searchGlobal({ q: 'café' });
  assert.equal(data.contacts.items.length, 1);
  assert.equal(data.messages.items.length, 1);
  assert.equal(data.messages.items[0].snippet, 'Hola café');
  assert.ok(data.messages.items[0].highlightEnd > 0);
});

test('searchInConversation rechaza cursor inválido', async () => {
  conversationSearchService.ensureReady = async () => {};
  conversationSearchRepository.getConversationById = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
  await assert.rejects(
    () => conversationSearchService.searchMessagesInConversation(
      '11111111-1111-4111-8111-111111111111',
      { q: 'hola', cursor: '%%%' },
    ),
    (err) => err.code === 'VALIDATION',
  );
});

test('parseCursors acepta cursor válido', async () => {
  const raw = encodeSearchCursor({
    createdAt: '2024-01-01T00:00:00.000Z',
    id: '11111111-1111-4111-8111-111111111111',
  }, { scope: 'message_global', q: 'hola' });
  const parsed = conversationSearchService.parseCursors({ q: 'hola', cursorMessage: raw });
  assert.equal(parsed.message.id, '11111111-1111-4111-8111-111111111111');
});