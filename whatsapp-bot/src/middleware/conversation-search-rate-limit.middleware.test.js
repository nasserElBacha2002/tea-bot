import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationSearchRateLimit,
  finishConversationSearchRequest,
  getConversationSearchConcurrentForTests,
  resetConversationSearchRateLimitForTests,
} from './conversation-search-rate-limit.middleware.js';

function mockRes() {
  const listeners = {};
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json() { return this; },
    on(event, fn) { listeners[event] = fn; },
    emit(event) { listeners[event]?.(); },
  };
}

test('libera cupo una sola vez al finalizar operación', () => {
  resetConversationSearchRateLimitForTests();
  const req = { method: 'POST', path: '/search', body: { groups: 'messages' }, ip: '1.1.1.1' };
  const res = mockRes();
  let called = false;
  conversationSearchRateLimit(req, res, () => { called = true; });
  assert.ok(called);
  assert.equal(getConversationSearchConcurrentForTests(), 1);
  finishConversationSearchRequest(req);
  assert.equal(getConversationSearchConcurrentForTests(), 0);
  finishConversationSearchRequest(req);
  assert.equal(getConversationSearchConcurrentForTests(), 0);
});