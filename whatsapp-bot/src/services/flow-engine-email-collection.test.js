import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { FlowEngine } from './flow-engine.service.js';
import sessionService from './session.service.js';
import {
  COLLECT_EMAIL_NODE_ID,
  WELCOME_NODE_ID,
} from '../constants/contact-email-flow.js';

const TEST_USER = 'test-email-collection-user';

function buildEmailFlow() {
  return {
    id: 'email-test-flow',
    version: 'v1',
    entryNode: COLLECT_EMAIL_NODE_ID,
    fallbackNode: 'fallback',
    nodes: [
      {
        id: COLLECT_EMAIL_NODE_ID,
        type: 'message',
        message: 'Por favor enviá tu email',
        transitions: [{ type: 'default', nextNode: COLLECT_EMAIL_NODE_ID, priority: 0 }],
      },
      {
        id: WELCOME_NODE_ID,
        type: 'message',
        message: 'Menú principal',
        transitions: [{ type: 'match', value: '1', nextNode: 'fallback', priority: 0 }],
      },
      { id: 'fallback', type: 'message', message: 'fallback', transitions: [] },
    ],
  };
}

function engineArgs(text, flow, conversationContext = { id: 'c1' }) {
  return {
    userId: TEST_USER,
    text,
    flowId: flow.id,
    flowSnapshot: flow,
    conversationContext,
  };
}

beforeEach(async () => {
  await sessionService.resetSession(TEST_USER);
});

afterEach(async () => {
  await sessionService.resetSession(TEST_USER);
});

test('new conversation asks for email before menu', async () => {
  const engine = new FlowEngine();
  const flow = buildEmailFlow();
  const first = await engine.resolveIncomingMessage(engineArgs('hola', flow));
  assert.equal(first.currentNodeId, COLLECT_EMAIL_NODE_ID);
  assert.match(first.reply, /email/i);
});

test('invalid email is rejected and user stays on collect_email', async () => {
  const engine = new FlowEngine();
  const flow = buildEmailFlow();
  await engine.resolveIncomingMessage(engineArgs('hola', flow));
  const second = await engine.resolveIncomingMessage(engineArgs('not-email', flow));
  assert.equal(second.currentNodeId, COLLECT_EMAIL_NODE_ID);
  assert.match(second.reply, /válido|valido/i);
});

test('valid email advances to welcome menu', async () => {
  const engine = new FlowEngine();
  const flow = buildEmailFlow();
  await engine.resolveIncomingMessage(engineArgs('hola', flow, null));
  const third = await engine.resolveIncomingMessage(engineArgs('user@example.com', flow, null));
  assert.equal(third.currentNodeId, WELCOME_NODE_ID);
  assert.equal(third.reply, 'Menú principal');
  assert.equal(third.variables.contact_email, 'user@example.com');
});

test('contact with existing email skips collect_email prompt', async () => {
  const engine = new FlowEngine();
  const flow = buildEmailFlow();
  const result = await engine.resolveIncomingMessage(
    engineArgs('hola', flow, { id: 'c2', contactEmail: 'known@example.com' }),
  );
  assert.equal(result.currentNodeId, WELCOME_NODE_ID);
  assert.equal(result.reply, 'Menú principal');
});

test('global menu command is blocked while awaiting email', async () => {
  const engine = new FlowEngine();
  const flow = buildEmailFlow();
  await engine.resolveIncomingMessage(engineArgs('hola', flow));
  const menuAttempt = await engine.resolveIncomingMessage(engineArgs('menu', flow));
  assert.equal(menuAttempt.currentNodeId, COLLECT_EMAIL_NODE_ID);
  assert.match(menuAttempt.reply, /email/i);
});
