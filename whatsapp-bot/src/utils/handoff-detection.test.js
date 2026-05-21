import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEngineHumanHandoffResult,
  isConversationInHumanMode,
  resolveHandoffConfirmationMessage,
  DEFAULT_HANDOFF_MESSAGE,
} from './handoff-detection.js';

test('isEngineHumanHandoffResult detecta requiresHuman y terminalReason', () => {
  assert.equal(isEngineHumanHandoffResult({ requiresHuman: true }), true);
  assert.equal(
    isEngineHumanHandoffResult({ terminalReason: 'human_handoff', currentNodeId: 'x' }),
    true,
  );
  assert.equal(isEngineHumanHandoffResult({ currentNodeId: 'human_handoff' }), true);
  assert.equal(isEngineHumanHandoffResult({ currentNodeId: 'welcome' }), false);
});

test('isConversationInHumanMode reconoce waiting_human y assigned', () => {
  assert.equal(isConversationInHumanMode({ status: 'waiting_human' }), true);
  assert.equal(isConversationInHumanMode({ status: 'assigned' }), true);
  assert.equal(isConversationInHumanMode({ status: 'bot' }), false);
});

test('resolveHandoffConfirmationMessage prioriza reply del motor', () => {
  assert.equal(resolveHandoffConfirmationMessage('human_handoff', 'Hola agente'), 'Hola agente');
  assert.equal(
    resolveHandoffConfirmationMessage('human_handoff', ''),
    DEFAULT_HANDOFF_MESSAGE,
  );
});
