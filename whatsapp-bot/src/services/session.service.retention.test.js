import test from 'node:test';
import assert from 'node:assert/strict';
import sessionService from './session.service.js';

const USER = 'wa:retention-user';

test.beforeEach(() => {
  sessionService.sessions = {};
});

test('resetSessionForDeletedConversation respeta conversationId enlazado', async () => {
  await sessionService.createSession(USER, 'main-menu', 'welcome', {});
  await sessionService.bindConversationId(USER, '11111111-1111-4111-8111-111111111111');
  const kept = await sessionService.resetSessionForDeletedConversation(
    USER,
    '22222222-2222-4222-8222-222222222222',
  );
  assert.equal(kept.action, 'skipped_bound_to_other_conversation');
  assert.ok(sessionService.getSession(USER));
});

test('resetSessionForDeletedConversation elimina sesión del mismo id', async () => {
  const id = '33333333-3333-4333-8333-333333333333';
  await sessionService.createSession(USER, 'main-menu', 'welcome', { conversationId: id });
  const result = await sessionService.resetSessionForDeletedConversation(USER, id);
  assert.equal(result.action, 'reset');
  assert.equal(sessionService.getSession(USER), null);
});

test('reset no borra sesión actualizada tras ventana async', async () => {
  await sessionService.createSession(USER, 'main-menu', 'welcome', {});
  const deletedId = '44444444-4444-4444-8444-444444444444';
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const pending = sessionService.resetSessionForDeletedConversation(
    USER,
    deletedId,
    {
      resolveActiveConversation: async () => {
        await barrier;
        return null;
      },
    },
  );
  await sessionService.bindConversationId(USER, '66666666-6666-4666-8666-666666666666');
  releaseBarrier();
  const result = await pending;
  assert.equal(result.action, 'skipped_bound_to_other_conversation');
  assert.ok(sessionService.getSession(USER));
});

test('bindConversationId a otra conversación resetea history/variables', async () => {
  const oldId = '77777777-7777-4777-8777-777777777777';
  const newId = '88888888-8888-4888-8888-888888888888';
  await sessionService.createSession(USER, 'main-menu', 'welcome', {
    conversationId: oldId,
    variables: { x: 1 },
    history: ['n1'],
  });
  await sessionService.bindConversationId(USER, newId);
  const session = sessionService.getSession(USER);
  assert.equal(session.conversationId, newId);
  assert.deepEqual(session.variables, {});
  assert.deepEqual(session.history, []);
});

test('mutación entre resolveActiveConversation y reset evita borrado', async () => {
  await sessionService.createSession(USER, 'main-menu', 'welcome', {});
  const deletedId = '99999999-9999-4999-8999-999999999999';
  let releaseBarrier;
  const barrier = new Promise((resolve) => { releaseBarrier = resolve; });
  const pending = sessionService.resetSessionForDeletedConversation(
    USER,
    deletedId,
    {
      resolveActiveConversation: async () => {
        await barrier;
        return null;
      },
    },
  );
  await sessionService.updateSession(USER, { variables: { touched: true } });
  releaseBarrier();
  const result = await pending;
  assert.equal(result.action, 'skipped_concurrent_mutation');
  assert.ok(sessionService.getSession(USER));
});

test('replace total de sesión antes del reset la conserva', async () => {
  await sessionService.createSession(USER, 'main-menu', 'welcome', {
    conversationId: 'aaaa1111-1111-4111-8111-111111111111',
  });
  const deletedId = 'aaaa1111-1111-4111-8111-111111111111';
  await sessionService.updateSession(USER, {
    conversationId: 'bbbb2222-2222-4222-8222-222222222222',
    variables: {},
    __resetHistory: true,
  });
  const result = await sessionService.resetSessionForDeletedConversation(USER, deletedId);
  assert.equal(result.action, 'skipped_bound_to_other_conversation');
});

test('sesión legacy consulta resolveActiveConversation antes de resetear', async () => {
  await sessionService.createSession(USER, 'main-menu', 'welcome', {});
  let queried = false;
  const result = await sessionService.resetSessionForDeletedConversation(
    USER,
    '44444444-4444-4444-8444-444444444444',
    {
      resolveActiveConversation: async () => {
        queried = true;
        return { id: '55555555-5555-4555-8555-555555555555' };
      },
    },
  );
  assert.equal(queried, true);
  assert.equal(result.action, 'skipped_new_conversation');
  assert.equal(sessionService.getSession(USER).conversationId, '55555555-5555-4555-8555-555555555555');
});