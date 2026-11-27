import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationBotLifecycleService } from './conversation-bot-lifecycle.service.js';
import { ConversationReentryService } from './conversation-reentry.service.js';
import {
  ERROR_CODES,
  OUTCOMES,
  REASON_CODES,
  TRANSITION_TYPES,
  captureAllStructuredLogs,
  logAttentionTransition,
  logAuxiliaryAttentionEvent,
  ensureCorrelationId,
  logLegacyAttentionEvent,
  outcomeFromError,
} from './conversation-attention-transition-log.js';

const CONV_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VALID_TWILIO = 'SMabcdefabcdefabcdefabcdefabcdefab';

test('ROUND4: rechaza correlationId token, nodeKey PII y status libre', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAttentionTransition({
      transitionType: TRANSITION_TYPES.botHandoff,
      outcome: OUTCOMES.confirmed,
      conversationId: CONV_ID,
      correlationId: 'TOKEN_SECRETO_FICTICIO',
      nodeKey: 'nombre_apellido_ficticio',
      previousStatus: 'dato_privado',
      newStatus: 'waiting_human',
      reasonCode: REASON_CODES.humanHandoff,
    });
  });
  const transition = events.find((row) => row.event === 'conversation_attention_transition');
  assert.ok(transition?.correlationId);
  assert.notEqual(transition.correlationId, 'TOKEN_SECRETO_FICTICIO');
  assert.equal(transition.nodeKey, undefined);
  assert.equal(transition.previousStatus, undefined);
  assert.equal(transition.newStatus, 'waiting_human');
});

test('ROUND4: logAuxiliaryAttentionEvent conserva errorCode', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logAuxiliaryAttentionEvent('manual_takeover_runtime_reset_failed', {
      conversationId: CONV_ID,
      correlationId: 'corr-aux-r4',
      errorCode: ERROR_CODES.runtimeResetFailed,
      outcome: OUTCOMES.error,
    });
  });
  assert.equal(events[0]?.errorCode, ERROR_CODES.runtimeResetFailed);
});

test('ROUND4: compatibilidad conversation_runtime_reset_failed', async () => {
  const events = await captureAllStructuredLogs(async () => {
    const service = new ConversationBotLifecycleService({
      runtimeSession: {
        async resetSession() {
          throw new Error('reset failed');
        },
      },
      logTransition: () => {},
    });
    await service.resetRuntimeSessionSafe(
      { id: CONV_ID, externalUserId: 'twilio:+1' },
      { correlationId: 'corr-runtime-r4', reasonCode: REASON_CODES.returnToBot },
    );
  });
  const legacy = events.find((row) => row.event === 'conversation_runtime_reset_failed');
  assert.ok(legacy);
  assert.equal(legacy.correlationId, ensureCorrelationId('corr-runtime-r4'));
  assert.equal(legacy.errorCode, ERROR_CODES.runtimeResetFailed);
  assert.equal(legacy.error, undefined);
});

test('ROUND4: compatibilidad conversation_legacy_state_normalized', async () => {
  const events = await captureAllStructuredLogs(async () => {
    logLegacyAttentionEvent('conversation_legacy_state_normalized', {
      conversationId: CONV_ID,
      correlationId: 'corr-legacy-norm-r4',
      previousNodeKey: 'human_handoff',
      resumeNodeKey: 'welcome',
      endedSessionCount: 2,
    });
  });
  const legacy = events.find((row) => row.event === 'conversation_legacy_state_normalized');
  assert.equal(legacy?.correlationId, ensureCorrelationId('corr-legacy-norm-r4'));
  assert.equal(legacy?.previousNodeKey, 'human_handoff');
  assert.equal(legacy?.resumeNodeKey, 'welcome');
  assert.equal(legacy?.endedSessionCount, 2);
});

test('ROUND4: reentry reset auxiliar reutiliza correlación inbound', async () => {
  const events = await captureAllStructuredLogs(async () => {
    const reentry = new ConversationReentryService({
      policy: () => 'prompt',
      queriesEnabled: () => false,
      runtimeSession: {
        async resetSession() {
          throw new Error('reset failed');
        },
      },
    });
    await reentry.resetRuntime(
      { id: CONV_ID, externalUserId: 'twilio:+1' },
      { correlationId: VALID_TWILIO },
    );
  });
  const legacy = events.find((row) => row.event === 'reentry_runtime_reset_failed');
  assert.equal(legacy?.correlationId, VALID_TWILIO);
  assert.equal(legacy?.errorCode, ERROR_CODES.runtimeResetFailed);
});

test('ROUND4: CONVERSATION_PERSISTENCE_UNAVAILABLE es error de infraestructura', () => {
  assert.deepEqual(outcomeFromError({ code: 'CONVERSATION_PERSISTENCE_UNAVAILABLE' }), {
    outcome: OUTCOMES.error,
    errorCode: 'CONVERSATION_PERSISTENCE_UNAVAILABLE',
  });
});