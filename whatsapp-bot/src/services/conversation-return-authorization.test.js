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

test('otro agente no puede cerrar la atención de otro', () => {
  assert.throws(
    () => assertExclusiveReturnAllowed(locked, other, { takeoverEnabled: true }),
    (error) => error.code === 'CONVERSATION_OWNED' && error.httpStatus === 409,
  );
  assert.deepEqual(
    describeReturnAccess(locked, other, { enabled: true }),
    { canReturnToBot: false, canForceReturn: false },
  );
});

test('el administrador tampoco salta la propiedad de otro agente', () => {
  assert.throws(
    () => assertExclusiveReturnAllowed(locked, admin, { takeoverEnabled: true }),
    (error) => error.code === 'CONVERSATION_OWNED' && error.httpStatus === 409,
  );
  assert.deepEqual(
    describeReturnAccess(locked, admin, { enabled: true }),
    { canReturnToBot: false, canForceReturn: false },
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
