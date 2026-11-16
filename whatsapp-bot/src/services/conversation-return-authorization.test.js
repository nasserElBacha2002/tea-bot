import test from 'node:test';
import assert from 'node:assert/strict';
import { assertExclusiveReturnAllowed } from './conversation-bot-lifecycle.service.js';
import { describeReturnAccess, describeTakeoverAccess } from './conversation-takeover.service.js';

const owner = { agentId: 'agent-ana', username: 'ana', role: 'conversations_only' };
const other = { agentId: 'agent-luis', username: 'luis', role: 'conversations_only' };
const admin = { agentId: 'agent-admin', username: 'admin', role: 'admin' };
const locked = { status: 'assigned', assignedAgentId: 'agent-ana' };

test('admin y operador pueden tomar una conversación libre en bot', () => {
  const bot = { status: 'bot', assignedAgentId: null };
  assert.equal(describeTakeoverAccess(bot, owner, { enabled: true }).canTakeover, true);
  assert.equal(describeTakeoverAccess(bot, admin, { enabled: true }).canTakeover, true);
  assert.equal(describeTakeoverAccess(bot, { role: 'unknown', agentId: 'x' }, { enabled: true }).canTakeover, false);
});

test('el dueño puede devolver la atención exclusiva', () => {
  assert.doesNotThrow(() => assertExclusiveReturnAllowed(locked, owner, { takeoverEnabled: true }));
  assert.deepEqual(
    describeReturnAccess(locked, owner, { enabled: true }),
    { canReturnToBot: true, canForceReturn: false },
  );
});

test('otro operador del panel puede cerrar la atención compartida', () => {
  assert.doesNotThrow(() => assertExclusiveReturnAllowed(locked, other, { takeoverEnabled: true }));
  assert.deepEqual(
    describeReturnAccess(locked, other, { enabled: true }),
    { canReturnToBot: true, canForceReturn: false },
  );
});

test('el administrador también puede devolver una conversación ajena del panel', () => {
  assert.doesNotThrow(() => assertExclusiveReturnAllowed(locked, admin, { takeoverEnabled: true }));
  assert.deepEqual(
    describeReturnAccess(locked, admin, { enabled: true }),
    { canReturnToBot: true, canForceReturn: false },
  );
});

test('inbox compartido expone takeoverBlock shared_inbox para no dueños del panel', () => {
  assert.equal(
    describeTakeoverAccess(locked, other, { enabled: true }).takeoverBlock,
    'shared_inbox',
  );
  assert.equal(
    describeTakeoverAccess(locked, admin, { enabled: true }).takeoverBlock,
    'shared_inbox',
  );
});

test('con la toma apagada cualquier operador habilitado puede devolver la cola', () => {
  assert.doesNotThrow(() => assertExclusiveReturnAllowed(locked, other, { takeoverEnabled: false }));
  assert.deepEqual(
    describeReturnAccess(locked, other, { enabled: false }),
    { canReturnToBot: true, canForceReturn: false },
  );
});

test('un cierre interno sin actor no pasa por esta autorización', () => {
  assert.throws(
    () => assertExclusiveReturnAllowed(locked, null, { takeoverEnabled: true }),
    (error) => error.code === 'FORBIDDEN',
  );
});
