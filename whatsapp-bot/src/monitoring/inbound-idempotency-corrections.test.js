import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasResponseBodyColumn,
  markWebhookProcessed,
  requeueDeadLetter,
  resetResponseBodyColumnCache,
  responseBodyColumnPresent,
} from './monitoring.repository.js';
import { twilioTurnOutboundId, requeueDeadLetter as prepareDeadLetter } from './webhook-events.service.js';
import {
  fenceInboundLease,
  withInboundLease,
} from './inbound-lease.js';
import { isolatedTestDatabaseReason } from '../db/isolated-test-database.js';
import { ConversationReentryService } from '../services/conversation-reentry.service.js';

function columnQuery(state) {
  return async (sql, params) => {
    state.sql.push(sql);
    if (sql.includes('sys.columns')) {
      if (state.length == null) return { rows: [] };
      return { rows: [{ column_length: state.length }] };
    }
    if (sql.includes("status = N'PROCESSED'")) {
      const row = state.row;
      if (!row || row.status !== 'PROCESSING' || Number(row.attempts) !== Number(params[1])) {
        return { rows: [] };
      }
      row.status = 'PROCESSED';
      if (sql.includes('response_body')) row.response_body = params[2];
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes("status = N'FAILED'") && sql.includes('DEAD_LETTER')) {
      const row = state.dead;
      if (!row || row.status !== 'DEAD_LETTER' || row.id !== params[0]) return { rows: [] };
      row.attempts = row.attempts > 0 ? row.attempts - 1 : 0;
      row.status = 'FAILED';
      return { rows: [{ ...row, provider_message_id: row.providerMessageId }] };
    }
    throw new Error(`sql inesperado: ${sql}`);
  };
}

test('NVARCHAR(MAX) cuenta como columna presente y NULL como ausente', () => {
  assert.equal(responseBodyColumnPresent(null), false);
  assert.equal(responseBodyColumnPresent(undefined), false);
  assert.equal(responseBodyColumnPresent(-1), true);
  assert.equal(responseBodyColumnPresent('-1'), true);
  assert.equal(responseBodyColumnPresent(0), true);
});

test('la columna ausente no se cachea y NVARCHAR(MAX) aplicada después sí guarda el TwiML', async () => {
  resetResponseBodyColumnCache();
  const state = {
    length: null,
    sql: [],
    row: { id: 'evt-1', status: 'PROCESSING', attempts: 1, response_body: null },
  };
  const dbQuery = columnQuery(state);
  try {
    assert.equal(await hasResponseBodyColumn(dbQuery), false);
    state.length = -1;
    assert.equal(await hasResponseBodyColumn(dbQuery), true);
    const twiml = '<Response><Message>Menú exacto</Message></Response>';
    const stored = await markWebhookProcessed('evt-1', { attempts: 1, responseBody: twiml }, dbQuery);
    assert.equal(stored.owned, true);
    assert.equal(stored.replayStored, true);
    assert.equal(state.row.response_body, twiml);
    assert.equal(state.row.status, 'PROCESSED');
    const late = await markWebhookProcessed('evt-1', {
      attempts: 1,
      responseBody: '<Response><Message>otro</Message></Response>',
    }, dbQuery);
    assert.equal(late.owned, false);
    assert.equal(state.row.response_body, twiml);
  } finally {
    resetResponseBodyColumnCache();
  }
});

test('sin la columna el cierre no escribe response_body', async () => {
  resetResponseBodyColumnCache();
  const state = {
    length: null,
    sql: [],
    row: { id: 'evt-2', status: 'PROCESSING', attempts: 1, response_body: null },
  };
  try {
    const stored = await markWebhookProcessed(
      'evt-2',
      { attempts: 1, responseBody: '<Response><Message>no</Message></Response>' },
      columnQuery(state),
    );
    assert.equal(stored.replayStored, false);
    assert.equal(state.row.response_body, null);
    assert.equal(state.row.status, 'PROCESSED');
    assert.equal(state.sql.some((sql) => sql.includes('response_body = $3')), false);
  } finally {
    resetResponseBodyColumnCache();
  }
});

test('el worker vencido no escribe después de perder el fence', async () => {
  let wrote = false;
  await withInboundLease({ id: 'evt-a', attempts: 1 }, async () => {
    await assert.rejects(
      async () => {
        await fenceInboundLease({ name: 'tx' }, async (_sql, params) => {
          assert.deepEqual(params, ['evt-a', 1]);
          return { rows: [] };
        });
        wrote = true;
      },
      (error) => error.code === 'INBOUND_LEASE_LOST',
    );
  });
  assert.equal(wrote, false);
  let queried = false;
  await fenceInboundLease(null, async () => {
    queried = true;
    return { rows: [] };
  });
  assert.equal(queried, false);
});

test('requeue de DEAD_LETTER no borra la fila y un PROCESSED no se reencola', async () => {
  const dead = {
    id: 'dead-1',
    status: 'DEAD_LETTER',
    attempts: 3,
    providerMessageId: 'SMDEAD',
    error_code: 'db down',
    error_message: 'timeout',
  };
  const result = await requeueDeadLetter('dead-1', async (sql, params) => {
    assert.equal(sql.includes('DELETE'), false);
    assert.equal(params[0], 'dead-1');
    if (dead.status !== 'DEAD_LETTER') return { rows: [] };
    dead.attempts -= 1;
    dead.status = 'FAILED';
    return {
      rows: [{
        id: dead.id,
        provider_message_id: dead.providerMessageId,
        attempts: dead.attempts,
        error_code: dead.error_code,
        error_message: dead.error_message,
        status: dead.status,
      }],
    };
  });
  assert.equal(result.requeued, true);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.attempts, 2);
  assert.equal(result.errorMessage, 'timeout');
  assert.equal(dead.status, 'FAILED');

  const kept = await requeueDeadLetter('processed-1', async () => ({ rows: [] }));
  assert.equal(kept.requeued, false);

  const prepared = await prepareDeadLetter('dead-1', {
    async requeueDeadLetter() {
      return {
        requeued: true,
        id: 'dead-1',
        providerMessageId: 'SMDEAD',
        attempts: 2,
        errorCode: 'db down',
        errorMessage: 'timeout',
        status: 'FAILED',
      };
    },
  });
  assert.equal(prepared.stateChangedToFailed, true);
  assert.equal(prepared.executed, false);
  assert.equal(prepared.recovered, false);
  assert.equal(prepared.reprocessed, false);
  assert.equal(prepared.requiresManualWebhook, true);

  const untouched = await prepareDeadLetter('processed-1', {
    async requeueDeadLetter() {
      return { requeued: false };
    },
  });
  assert.equal(untouched.stateChangedToFailed, false);
  assert.equal(untouched.executed, false);
  assert.equal(untouched.requiresManualWebhook, false);
});

test('el mismo MessageSid no aplica la reentrada dos veces', async () => {
  const conversation = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'bot',
    externalUserId: 'twilio:user',
    currentFlowId: 'main-menu',
    reentryJson: {
      status: 'pending',
      flowId: 'main-menu',
      flowVersion: 'v1',
      resumeNodeKey: 'welcome',
    },
  };
  let updates = 0;
  const message = {
    id: 'msg-1',
    conversationId: conversation.id,
    metadataJson: {},
  };
  const service = new ConversationReentryService({
    policy: () => 'prompt',
    queriesEnabled: () => true,
    runTransaction: async (fn) => fn({}),
    conversationRepo: {
      async findById() {
        return { ...conversation, reentryJson: conversation.reentryJson };
      },
      async findByIdForUpdate() {
        return { ...conversation, reentryJson: conversation.reentryJson };
      },
      async updateConversation(_id, patch) {
        updates += 1;
        if (patch.reentryJson !== undefined) conversation.reentryJson = patch.reentryJson;
        return { ...conversation };
      },
    },
    messageRepo: {
      async findByProviderMessageId() {
        return message;
      },
      async recordTurnEffect(_provider, _id, effect) {
        message.metadataJson = { ...message.metadataJson, turnEffect: effect };
        return message;
      },
    },
    sessionRepo: {
      async endAllOpenForConversation() {},
    },
    runtimeSession: {
      async resetSession() {},
      async createSession() {},
      async updateSession() {},
    },
  });

  const first = await service.consumeInbound(conversation, 'quiero saber horarios', {
    providerMessageId: 'SMreentry1',
  });
  const second = await service.consumeInbound(conversation, 'quiero saber horarios', {
    providerMessageId: 'SMreentry1',
  });
  assert.equal(first.action, 'prompt');
  assert.equal(second.action, 'prompt');
  assert.equal(second.replayed, true);
  assert.equal(second.reply, first.reply);
  assert.equal(updates, 1);
  assert.equal(conversation.reentryJson.status, 'awaiting_choice');
});

test('la clave del outbound cabe en el índice y no reutiliza el MessageSid', () => {
  assert.equal(twilioTurnOutboundId('SM123'), 'SM123:outbound');
  assert.equal(twilioTurnOutboundId(''), null);
  assert.equal(twilioTurnOutboundId('tiene espacios'), null);
  const longestSuffix = 'S'.repeat(119);
  assert.equal(twilioTurnOutboundId(longestSuffix), `${longestSuffix}:outbound`);
  assert.equal(twilioTurnOutboundId(longestSuffix).length, 128);
  const overflow = 'S'.repeat(120);
  const hashed = twilioTurnOutboundId(overflow);
  const maximum = 'M'.repeat(128);
  const maximumAgain = twilioTurnOutboundId(maximum);
  assert.equal(hashed, twilioTurnOutboundId(overflow));
  assert.equal(maximumAgain, twilioTurnOutboundId(maximum));
  assert.notEqual(hashed, overflow);
  assert.notEqual(maximumAgain, maximum);
  assert.ok(hashed.length <= 128);
  assert.ok(maximumAgain.length <= 128);
  assert.notEqual(hashed, maximumAgain);
});

test('la base de pruebas no se acepta por contener la palabra test', () => {
  const previous = {
    server: process.env.DB_SERVER,
    name: process.env.DB_NAME,
    confirm: process.env.TB_SQL_TEST_CONFIRM,
  };
  try {
    process.env.DB_SERVER = 'localhost';
    process.env.DB_NAME = 'contest';
    process.env.TB_SQL_TEST_CONFIRM = 'tea_bot_test';
    assert.match(isolatedTestDatabaseReason(), /tea_bot_test_/);
    process.env.DB_NAME = 'tea-bot';
    assert.match(isolatedTestDatabaseReason(), /TB_SQL_TEST_CONFIRM=tea-bot/);
    process.env.TB_SQL_TEST_CONFIRM = 'tea-bot';
    assert.equal(isolatedTestDatabaseReason(), null);
    process.env.DB_NAME = 'tea_bot_test_local';
    delete process.env.TB_SQL_TEST_CONFIRM;
    assert.match(isolatedTestDatabaseReason(), /TB_SQL_TEST_CONFIRM=tea_bot_test/);
    process.env.TB_SQL_TEST_CONFIRM = 'tea_bot_test';
    assert.equal(isolatedTestDatabaseReason(), null);
    process.env.DB_SERVER = '170.239.85.196';
    assert.match(isolatedTestDatabaseReason(), /DB_SERVER/);
    process.env.DB_SERVER = 'localhost';
    process.env.DB_NAME = 'tea-bot';
    process.env.TB_SQL_TEST_CONFIRM = 'tea_bot_test';
    assert.match(isolatedTestDatabaseReason(), /TB_SQL_TEST_CONFIRM=tea-bot/);
  } finally {
    if (previous.server === undefined) delete process.env.DB_SERVER;
    else process.env.DB_SERVER = previous.server;
    if (previous.name === undefined) delete process.env.DB_NAME;
    else process.env.DB_NAME = previous.name;
    if (previous.confirm === undefined) delete process.env.TB_SQL_TEST_CONFIRM;
    else process.env.TB_SQL_TEST_CONFIRM = previous.confirm;
  }
});
