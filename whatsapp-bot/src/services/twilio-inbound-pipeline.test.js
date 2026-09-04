import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { processCanonicalTwilioInbound } from './twilio-inbound-pipeline.js';
import conversationService from './conversation.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';

const INSCRIPTION_TEXT =
  'Hola, buenos días, quería saber si todavía están abiertas las inscripciones para agosto o si solo hay inscripciones en marzo.';

function buildMenuFlow() {
  return {
    id: 'first-contact-e2e-flow',
    version: 'v1',
    entryNode: 'welcome',
    fallbackNode: 'fallback',
    nodes: [
      {
        id: 'welcome',
        type: 'message',
        message: '¡Hola! Bienvenido/a a Tea y Deportea. Elegí una opción.',
        transitions: [{ type: 'match', value: '1', nextNode: 'info', priority: 0 }],
      },
      { id: 'info', type: 'message', message: 'Info', transitions: [] },
      {
        id: 'fallback',
        type: 'message',
        message: 'No pude entender tu respuesta. Por favor, elegí una opción válida del menú.',
        transitions: [],
      },
      {
        id: 'human_handoff',
        type: 'message',
        message: 'Te vamos a derivar con una persona del equipo.',
        transitions: [],
      },
    ],
  };
}

function stubConversationService(conversation, extras = {}) {
  const original = {};
  const stubs = {
    isEnabled: () => true,
    findOrCreateTwilioConversation: async () => ({ conversation, created: extras.created ?? true }),
    reloadConversation: async (c) => c,
    reopenClosedConversationIfNeeded: async (c) => c,
    persistInboundMessage: async () => ({ id: 'msg-in' }),
    persistOutboundBotMessage: async (_c, reply) => {
      extras.outbounds = extras.outbounds || [];
      extras.outbounds.push(reply);
      return { id: 'msg-out' };
    },
    getOrCreateActiveSession: async () => ({
      session: extras.dbSession || {
        id: 'sess-1',
        flowId: conversation.currentFlowId,
        currentNodeKey: conversation.currentNodeKey,
        variablesJson: {},
        historyJson: [],
      },
      created: !conversation.currentNodeKey,
    }),
    hydrateRuntimeSessionIfNeeded: conversationService.hydrateRuntimeSessionIfNeeded.bind(conversationService),
    syncSessionFromFlowEngine: async (_conv, _db, _userId, engineResult) => {
      conversation.currentNodeKey = engineResult.currentNodeId;
    },
    ...extras.overrides,
  };
  for (const [key, fn] of Object.entries(stubs)) {
    original[key] = conversationService[key];
    conversationService[key] = fn;
  }
  return () => {
    for (const [key, fn] of Object.entries(original)) {
      conversationService[key] = fn;
    }
  };
}

test('e2e inbound: consulta de inscripciones inicia el menú y no el fallback', async () => {
  const userId = `twilio:whatsapp:+54911e2e${Date.now()}`;
  await sessionService.resetSession(userId);
  const conversation = {
    id: 'conv-e2e',
    status: 'bot',
    currentNodeKey: null,
    currentFlowId: 'first-contact-e2e-flow',
    currentFlowVersion: null,
  };
  const extras = { outbounds: [] };
  const restore = stubConversationService(conversation, extras);
  const prevNormalize = conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded;
  conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = async (c) => ({
    conversation: c,
    normalized: false,
  });
  const prevHandoff = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;

  try {
    const event = {
      userId,
      flowId: 'first-contact-e2e-flow',
      text: INSCRIPTION_TEXT,
      messageId: 'SM-e2e-1',
      provider: 'twilio',
      phone: '+5491100000000',
      rawPayload: { From: 'whatsapp:+5491100000000' },
    };
    const processed = await processCanonicalTwilioInbound(event, {
      flowSnapshot: buildMenuFlow(),
    });
    assert.equal(processed.kind, 'bot');
    assert.equal(processed.result.currentNodeId, 'welcome');
    assert.match(processed.reply, /Bienvenido/i);
    assert.equal(/No pude entender/i.test(processed.reply), false);
    assert.equal(conversation.currentNodeKey, 'welcome');
  } finally {
    humanHandoffRepository.findLatestActiveByConversationId = prevHandoff;
    conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = prevNormalize;
    restore();
    await sessionService.resetSession(userId);
  }
});

test('dos webhooks concurrentes del mismo usuario no duplican el inicio', async () => {
  const userId = `twilio:whatsapp:+54911conc${Date.now()}`;
  await sessionService.resetSession(userId);
  const conversation = {
    id: 'conv-conc',
    status: 'bot',
    currentNodeKey: null,
    currentFlowId: 'first-contact-e2e-flow',
    currentFlowVersion: null,
  };
  const extras = { outbounds: [] };
  const restore = stubConversationService(conversation, extras);
  const prevNormalize = conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded;
  conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = async (c) => ({
    conversation: c,
    normalized: false,
  });
  const prevHandoff = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;

  const flow = buildMenuFlow();
  try {
    const [first, second] = await Promise.all([
      processCanonicalTwilioInbound({
        userId,
        flowId: flow.id,
        text: 'Hola, quería consultar por las inscripciones',
        messageId: 'SM-conc-A',
        provider: 'twilio',
        phone: '+5491100000002',
        rawPayload: {},
      }, { flowSnapshot: flow }),
      processCanonicalTwilioInbound({
        userId,
        flowId: flow.id,
        text: 'cualquier texto inválido',
        messageId: 'SM-conc-B',
        provider: 'twilio',
        phone: '+5491100000002',
        rawPayload: {},
      }, { flowSnapshot: flow }),
    ]);

    const replies = [first, second];
    const welcomes = replies.filter((item) => /Bienvenido/i.test(item.reply || ''));
    const fallbacks = replies.filter((item) => /No pude entender/i.test(item.reply || ''));
    const handoffs = replies.filter((item) => item.kind === 'human_handoff');
    assert.equal(welcomes.length, 1);
    assert.equal(fallbacks.length, 1);
    assert.equal(handoffs.length, 0);
    assert.ok(['welcome', 'fallback'].includes(conversation.currentNodeKey));
    assert.equal(sessionService.getSession(userId) != null, true);
  } finally {
    humanHandoffRepository.findLatestActiveByConversationId = prevHandoff;
    conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = prevNormalize;
    restore();
    await sessionService.resetSession(userId);
  }
});

test('assigned no reinicia el bot en el pipeline', async () => {
  const userId = `twilio:whatsapp:+54911asg${Date.now()}`;
  await sessionService.resetSession(userId);
  const conversation = {
    id: 'conv-asg',
    status: 'assigned',
    assignedAgentId: 'agent-1',
    currentNodeKey: 'welcome',
    currentFlowId: 'first-contact-e2e-flow',
  };
  const restore = stubConversationService(conversation, { created: false });
  try {
    const processed = await processCanonicalTwilioInbound({
      userId,
      flowId: conversation.currentFlowId,
      text: 'Hola',
      messageId: 'SM-asg-1',
      provider: 'twilio',
      rawPayload: {},
    }, { flowSnapshot: buildMenuFlow() });
    assert.equal(processed.kind, 'human_mode_skip');
    assert.equal(sessionService.getSession(userId), null);
  } finally {
    restore();
    await sessionService.resetSession(userId);
  }
});
