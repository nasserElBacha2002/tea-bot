import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationReentryService } from './conversation-reentry.service.js';
import {
  captureAllStructuredLogs,
  ensureCorrelationId,
  internalLoggingCorrelationId,
  logAttentionTransition,
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
} from './conversation-attention-transition-log.js';

const CONV_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('ROUND5: client req/corr no aparecen en logs; correlación estable', async () => {
  const sensitive = [
    'corr-5491100000000',
    'req-token-secreto-ficticio',
  ];
  for (const clientCorrelation of sensitive) {
    const expected = ensureCorrelationId(clientCorrelation);
    assert.notEqual(expected, clientCorrelation);
    assert.equal(expected, internalLoggingCorrelationId(clientCorrelation));
    const events = await captureAllStructuredLogs(async () => {
      logAttentionTransition({
        transitionType: TRANSITION_TYPES.manualTakeover,
        outcome: OUTCOMES.confirmed,
        conversationId: CONV_ID,
        correlationId: clientCorrelation,
        newStatus: 'assigned',
        reasonCode: REASON_CODES.manualTakeover,
      });
    });
    const line = events.find((row) => row.event === 'conversation_attention_transition');
    assert.equal(line?.correlationId, expected);
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes(clientCorrelation), false);
  }
});

test('ROUND5: legacy_cleared comparte correlationId entre reset y rollback', async () => {
  const events = await captureAllStructuredLogs(async () => {
    const service = new ConversationReentryService({
      policy: () => 'legacy',
      queriesEnabled: () => false,
      runTransaction: async (fn) => fn({ id: 'tx' }),
      conversationRepo: {
        async findByIdForUpdate() {
          return {
            id: CONV_ID,
            status: 'bot',
            reentryJson: { status: 'pending' },
            externalUserId: 'twilio:+5491999888777',
          };
        },
        async updateConversation(_id, patch) {
          return {
            id: CONV_ID,
            status: 'bot',
            externalUserId: 'twilio:+5491999888777',
            ...patch,
          };
        },
      },
      sessionRepo: {
        async endAllOpenForConversation() {
          return 1;
        },
      },
      runtimeSession: {
        async resetSession() {
          throw new Error('reset failed');
        },
      },
    });
    await service.rollbackPending({
      id: CONV_ID,
      status: 'bot',
      reentryJson: { status: 'pending' },
    });
  });

  const resetFailed = events.find((row) => row.event === 'reentry_runtime_reset_failed');
  const rollback = events.find((row) => row.event === 'reentry_legacy_rollback');
  assert.ok(resetFailed?.correlationId);
  assert.ok(rollback?.correlationId);
  assert.equal(resetFailed.correlationId, rollback.correlationId);
  assert.match(resetFailed.correlationId, /^[0-9a-f-]{36}$/i);
});