import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapConversationPublic } from '../utils/conversation-inbox.mapper.js';

test('mapConversationPublic includes contactEmail', () => {
  const mapped = mapConversationPublic({
    id: 'abc',
    channel: 'whatsapp',
    provider: 'twilio',
    phoneNumber: '+54911',
    displayName: 'Ana',
    contactEmail: 'ana@example.com',
    status: 'bot',
    assignedAgentId: null,
    currentFlowId: 'main-menu',
    currentFlowVersion: 'v11',
    currentNodeKey: 'welcome',
    lastMessageAt: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    closedAt: null,
  });
  assert.equal(mapped.contactEmail, 'ana@example.com');
});
