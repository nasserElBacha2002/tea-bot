import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAutomaticReply, REPLY_DECISION } from './conversation-turn-guard.service.js';

const CONVERSATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function row(patch = {}) {
  return {
    id: CONVERSATION_ID,
    status: 'bot',
    statusVersion: 2,
    ...patch,
  };
}

test('la persistencia comparte la transacción que autoriza', async () => {
  let seenTransaction = null;
  const decision = await authorizeAutomaticReply({
    conversation: row(),
    statusVersionAtStart: 2,
    persist: async (transaction) => {
      seenTransaction = transaction;
      return { id: 'msg-1' };
    },
  }, {
    dbEnabled: () => true,
    takeoverEnabled: () => true,
    schemaReady: async () => true,
    runTransaction: async (fn) => fn('tx-lock'),
    conversationRepo: {
      async findByIdForUpdate() {
        return row();
      },
    },
  });

  assert.equal(decision.decision, REPLY_DECISION.ALLOW);
  assert.equal(decision.persisted.id, 'msg-1');
  assert.equal(seenTransaction, 'tx-lock');
});

test('un takeover que commitea antes del lock no inserta el outbound', async () => {
  const locked = row();
  let inserts = 0;
  const decision = await authorizeAutomaticReply({
    conversation: row(),
    statusVersionAtStart: 2,
    persist: async () => {
      inserts += 1;
      return { id: 'msg-late' };
    },
  }, {
    dbEnabled: () => true,
    takeoverEnabled: () => true,
    schemaReady: async () => true,
    runTransaction: async (fn) => {
      locked.status = 'assigned';
      locked.statusVersion = 3;
      return fn('tx-lock');
    },
    conversationRepo: {
      async findByIdForUpdate() {
        return locked;
      },
    },
  });

  assert.equal(decision.decision, REPLY_DECISION.SUPPRESS);
  assert.equal(decision.reason, 'not_bot');
  assert.equal(inserts, 0);
  assert.equal(decision.persisted, null);
});

test('una versión nula no se trata como 0', async () => {
  const decision = await authorizeAutomaticReply({
    conversation: row({ statusVersion: null }),
    statusVersionAtStart: 0,
    persist: async () => {
      throw new Error('no debe persistir');
    },
  }, {
    dbEnabled: () => true,
    takeoverEnabled: () => true,
    schemaReady: async () => true,
    runTransaction: async (fn) => fn('tx'),
    conversationRepo: {
      async findByIdForUpdate() {
        return row({ statusVersion: null });
      },
    },
  });

  assert.equal(decision.decision, REPLY_DECISION.INDETERMINATE);
  assert.equal(decision.reason, 'version_required');
});

test('sin fila persistida la respuesta no se autoriza', async () => {
  let inserts = 0;
  const decision = await authorizeAutomaticReply({
    conversation: row(),
    statusVersionAtStart: 2,
    persist: async () => {
      inserts += 1;
    },
  }, {
    dbEnabled: () => true,
    runTransaction: async (fn) => fn('tx'),
    conversationRepo: {
      async findByIdForUpdate() {
        return null;
      },
    },
  });
  assert.equal(decision.decision, REPLY_DECISION.INDETERMINATE);
  assert.equal(decision.reason, 'missing_row');
  assert.equal(inserts, 0);
});

test('un error SQL durante la autorización no envía la respuesta', async () => {
  let inserts = 0;
  const decision = await authorizeAutomaticReply({
    conversation: row(),
    statusVersionAtStart: 2,
    persist: async () => {
      inserts += 1;
    },
  }, {
    dbEnabled: () => true,
    runTransaction: async (fn) => fn('tx'),
    conversationRepo: {
      async findByIdForUpdate() {
        throw new Error('connection reset');
      },
    },
  });
  assert.equal(decision.decision, REPLY_DECISION.INDETERMINATE);
  assert.equal(decision.reason, 'sql_error');
  assert.equal(inserts, 0);
});

test('un id no persistido queda autorizado por regla explícita', async () => {
  const decision = await authorizeAutomaticReply({
    conversation: { id: 'conv-simulator', status: 'bot' },
    statusVersionAtStart: null,
  }, {
    dbEnabled: () => true,
    runTransaction: async () => {
      throw new Error('no debe abrir transacción');
    },
  });
  assert.equal(decision.decision, REPLY_DECISION.ALLOW);
  assert.equal(decision.reason, 'unpersisted');
});

test('la base apagada es una autorización explícita, no un fallo abierto', async () => {
  const decision = await authorizeAutomaticReply({
    conversation: row(),
    statusVersionAtStart: 2,
  }, {
    dbEnabled: () => false,
    runTransaction: async () => {
      throw new Error('no debe abrir transacción');
    },
  });
  assert.equal(decision.decision, REPLY_DECISION.ALLOW);
  assert.equal(decision.reason, 'persistence_disabled');
});

test('con la toma activa y sin columna la autorización queda indeterminada', async () => {
  const decision = await authorizeAutomaticReply({
    conversation: row({ statusVersion: null }),
    statusVersionAtStart: null,
    persist: async () => {
      throw new Error('no debe persistir');
    },
  }, {
    dbEnabled: () => true,
    takeoverEnabled: () => true,
    schemaReady: async () => false,
    runTransaction: async (fn) => fn('tx'),
    conversationRepo: {
      async findByIdForUpdate() {
        return row({ statusVersion: null });
      },
    },
  });
  assert.equal(decision.decision, REPLY_DECISION.INDETERMINATE);
  assert.equal(decision.reason, 'takeover_schema_required');
});
