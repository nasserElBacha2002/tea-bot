import test from 'node:test';
import assert from 'node:assert/strict';
import { isConversationInHumanMode } from '../utils/handoff-detection.js';

test('modo humano: metadata de skip para waiting_human y assigned', () => {
  const waiting = isConversationInHumanMode({ status: 'waiting_human' });
  const assigned = isConversationInHumanMode({ status: 'assigned' });
  assert.equal(waiting, true);
  assert.equal(assigned, true);

  const waitingMeta = waiting
    ? { botSkipped: true, skipReason: 'conversation_waiting_human' }
    : {};
  const assignedMeta = assigned
    ? { botSkipped: true, skipReason: 'conversation_assigned' }
    : {};

  assert.equal(waitingMeta.skipReason, 'conversation_waiting_human');
  assert.equal(assignedMeta.skipReason, 'conversation_assigned');
});
