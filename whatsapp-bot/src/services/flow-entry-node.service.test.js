import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveFlowEntryNodeForConversation,
  FlowEntryNodeResolutionError,
} from './flow-entry-node.service.js';
import { WELCOME_NODE_ID, COLLECT_EMAIL_NODE_ID } from '../constants/contact-email-flow.js';

test('resolveFlowEntryNodeForConversation usa welcome cuando hay email almacenado', async () => {
  const nodeKey = await resolveFlowEntryNodeForConversation({
    id: 'conv-1',
    currentFlowId: 'main-menu',
    contactEmail: 'user@example.com',
  });
  assert.equal(nodeKey, WELCOME_NODE_ID);
});

test('resolveFlowEntryNodeForConversation propaga fallo de carga de flow', async () => {
  const flowLoader = {
    getDefaultFlowId: () => 'missing-flow',
    getFlow: async () => {
      throw new Error('db unavailable');
    },
  };

  const original = await import('../utils/flow-loader.js');
  const prevGetFlow = original.default.getFlow;
  const prevDefault = original.default.getDefaultFlowId;
  original.default.getFlow = flowLoader.getFlow;
  original.default.getDefaultFlowId = flowLoader.getDefaultFlowId;

  try {
    await assert.rejects(
      () => resolveFlowEntryNodeForConversation({ id: 'conv-1', currentFlowId: 'missing-flow' }),
      (err) => err instanceof FlowEntryNodeResolutionError,
    );
  } finally {
    original.default.getFlow = prevGetFlow;
    original.default.getDefaultFlowId = prevDefault;
  }
});

test('resolveFlowEntryNodeForConversation usa collect_email sin email', async () => {
  const flowLoader = await import('../utils/flow-loader.js');
  const prevGetFlow = flowLoader.default.getFlow;
  flowLoader.default.getFlow = async () => ({
    id: 'main-menu',
    entryNode: COLLECT_EMAIL_NODE_ID,
    nodes: [],
  });

  try {
    const nodeKey = await resolveFlowEntryNodeForConversation({
      id: 'conv-2',
      currentFlowId: 'main-menu',
      contactEmail: null,
      phoneNumber: null,
    });
    assert.equal(nodeKey, COLLECT_EMAIL_NODE_ID);
  } finally {
    flowLoader.default.getFlow = prevGetFlow;
  }
});
