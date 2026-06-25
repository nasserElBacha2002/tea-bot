import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isEmailCollectionNode,
  resolveInitialNodeId,
  shouldBlockGlobalMenuDuringEmailCapture,
  tryHandleEmailCollectionInput,
} from './email-collection-runtime.js';
import {
  COLLECT_EMAIL_NODE_ID,
  DEFAULT_INVALID_EMAIL_REPLY,
  WELCOME_NODE_ID,
} from '../constants/contact-email-flow.js';

const collectNode = {
  id: COLLECT_EMAIL_NODE_ID,
  message: 'send email',
  metadata: { invalidEmailMessage: 'custom invalid' },
};
const welcomeNode = { id: WELCOME_NODE_ID, message: 'welcome menu' };

test('resolveInitialNodeId skips collect_email when contact already has email', () => {
  const flow = { entryNode: COLLECT_EMAIL_NODE_ID };
  assert.equal(resolveInitialNodeId(flow, true), WELCOME_NODE_ID);
  assert.equal(resolveInitialNodeId(flow, false), COLLECT_EMAIL_NODE_ID);
});

test('shouldBlockGlobalMenuDuringEmailCapture only before email is stored', () => {
  assert.equal(shouldBlockGlobalMenuDuringEmailCapture(COLLECT_EMAIL_NODE_ID, false), true);
  assert.equal(shouldBlockGlobalMenuDuringEmailCapture(COLLECT_EMAIL_NODE_ID, true), false);
  assert.equal(shouldBlockGlobalMenuDuringEmailCapture(WELCOME_NODE_ID, false), false);
});

test('tryHandleEmailCollectionInput rejects invalid email', async () => {
  const result = await tryHandleEmailCollectionInput({
    rawText: 'not-an-email',
    conversation: null,
    collectEmailNode: collectNode,
    welcomeNode,
  });
  assert.equal(result.currentNodeId, COLLECT_EMAIL_NODE_ID);
  assert.equal(result.reply, 'custom invalid');
  assert.equal(result.emailSaved, false);
});

test('tryHandleEmailCollectionInput advances to welcome without DB when no conversation', async () => {
  const result = await tryHandleEmailCollectionInput({
    rawText: 'user@example.com',
    conversation: null,
    collectEmailNode: collectNode,
    welcomeNode,
  });
  assert.equal(result.currentNodeId, WELCOME_NODE_ID);
  assert.equal(result.reply, 'welcome menu');
  assert.equal(result.variables.contact_email, 'user@example.com');
  assert.equal(result.emailSaved, true);
});

test('isEmailCollectionNode identifies collect_email node id', () => {
  assert.equal(isEmailCollectionNode(COLLECT_EMAIL_NODE_ID), true);
  assert.equal(isEmailCollectionNode('welcome'), false);
});

test('invalid email falls back to default message', async () => {
  const result = await tryHandleEmailCollectionInput({
    rawText: 'x',
    conversation: null,
    collectEmailNode: { id: COLLECT_EMAIL_NODE_ID, message: 'ask' },
    welcomeNode,
  });
  assert.equal(result.reply, DEFAULT_INVALID_EMAIL_REPLY);
});
