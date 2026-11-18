import test from 'node:test';
import assert from 'node:assert/strict';
import conversationInboxService from './conversation-inbox.service.js';
import agentOutboundSendService from './agent-outbound-send.service.js';

test('sendAgentMessage delega lote a sendBatch', async () => {
  const calls = [];
  const prevBatch = agentOutboundSendService.sendBatch;
  const prevCtx = conversationInboxService._buildSharedAgentOutboundContext;
  conversationInboxService._buildSharedAgentOutboundContext = async () => ({
    conversation: { id: 'c1', provider: 'internal', status: 'assigned' },
    actorAgentId: 'a1',
  });
  agentOutboundSendService.sendBatch = async (ctx, input) => {
    calls.push({ ctx, input });
    return {
      results: [{ clientRequestId: 'f1', ok: true }],
      partial: false,
      allSucceeded: true,
      conversation: ctx.conversation,
    };
  };
  try {
    const data = await conversationInboxService.sendAgentMessage('c1', 'texto', 'a1', null, {
      attachments: [{ clientRequestId: 'f1', mimeType: 'image/png', contentBase64: 'eA==' }],
      batchClientRequestId: 'batch-1',
    });
    assert.equal(calls.length, 1);
    assert.equal(data.allSucceeded, true);
  } finally {
    agentOutboundSendService.sendBatch = prevBatch;
    conversationInboxService._buildSharedAgentOutboundContext = prevCtx;
  }
});

test('sendAgentMessage propaga error Twilio en envío individual', async () => {
  const prevSingle = agentOutboundSendService.sendSingleItem;
  const prevCtx = conversationInboxService._buildSharedAgentOutboundContext;
  conversationInboxService._buildSharedAgentOutboundContext = async () => ({
    conversation: { id: 'c1', provider: 'twilio', status: 'assigned' },
    actorAgentId: 'a1',
  });
  agentOutboundSendService.sendSingleItem = async () => ({
    ok: false,
    error: { code: 'TWILIO_SEND_FAILED', message: 'rechazado' },
    deliveryState: 'failed',
  });
  try {
    await assert.rejects(
      () => conversationInboxService.sendAgentMessage('c1', '', 'a1', null, {
        attachment: { mimeType: 'image/png', contentBase64: 'eA==' },
        clientRequestId: 'req-1',
      }),
      (err) => err.code === 'TWILIO_SEND_FAILED',
    );
  } finally {
    agentOutboundSendService.sendSingleItem = prevSingle;
    conversationInboxService._buildSharedAgentOutboundContext = prevCtx;
  }
});