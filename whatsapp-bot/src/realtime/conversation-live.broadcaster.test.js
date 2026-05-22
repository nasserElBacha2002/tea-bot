import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLiveClientCount,
  publishConversationLiveEvent,
  registerLiveClient,
  resetLiveClientsForTests,
} from './conversation-live.broadcaster.js';

test('broadcaster registra y limpia clientes', () => {
  resetLiveClientsForTests();
  assert.equal(getLiveClientCount(), 0);

  const closed = [];
  const fakeWs = {
    readyState: 1,
    send(payload) {
      closed.push(payload);
    },
    on(event, fn) {
      if (event === 'close') this._closeFn = fn;
    },
  };

  registerLiveClient(fakeWs);
  assert.equal(getLiveClientCount(), 1);

  publishConversationLiveEvent({
    type: 'conversation.message.created',
    conversationId: 'c1',
    data: { message: { id: 'm1' } },
  });
  assert.equal(closed.length, 1);
  const parsed = JSON.parse(closed[0]);
  assert.equal(parsed.type, 'conversation.message.created');
  assert.equal(parsed.conversationId, 'c1');

  fakeWs._closeFn();
  assert.equal(getLiveClientCount(), 0);
});

test('publishConversationLiveEvent ignora eventos sin conversationId', () => {
  resetLiveClientsForTests();
  const sent = [];
  registerLiveClient({
    readyState: 1,
    send: (p) => sent.push(p),
    on: () => {},
  });
  publishConversationLiveEvent({ type: 'conversation.updated' });
  assert.equal(sent.length, 0);
});
