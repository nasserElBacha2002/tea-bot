import test from 'node:test';
import assert from 'node:assert/strict';
import { requireConversationsInbox } from './require-conversations-inbox.middleware.js';
import { ROLES } from '../auth/roles.js';

function run(role) {
  let status = null;
  let body = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  let nextCalled = false;
  requireConversationsInbox({ adminUser: { role } }, res, () => {
    nextCalled = true;
  });
  return { status, body, nextCalled };
}

test('requireConversationsInbox permite admin y operador', () => {
  assert.equal(run(ROLES.ADMIN).nextCalled, true);
  assert.equal(run(ROLES.CONVERSATIONS_ONLY).nextCalled, true);
});

test('requireConversationsInbox rechaza rol desconocido', () => {
  const out = run('monitoring');
  assert.equal(out.nextCalled, false);
  assert.equal(out.status, 403);
});