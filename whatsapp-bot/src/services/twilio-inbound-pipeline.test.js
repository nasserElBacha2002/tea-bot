import test from 'node:test';
import assert from 'node:assert/strict';
import '../config.js';
import { processCanonicalTwilioInbound } from './twilio-inbound-pipeline.js';
import conversationService from './conversation.service.js';
import conversationBotLifecycleService from './conversation-bot-lifecycle.service.js';
import humanHandoffRepository from '../repositories/human-handoff.repository.js';
import sessionService from './session.service.js';
import conversationReentryService, { REENTRY_PROMPT } from './conversation-reentry.service.js';
import messagePersistence from './message-persistence.service.js';
import { conversationTurnGuard } from './conversation-turn-guard.service.js';

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
    publishPersistedOutbound: async () => conversation,
    updateConversation: async () => conversation,
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

test('cierre durante el motor reemplaza el fallback por la reentrada y no sincroniza el cursor', async () => {
  const userId = `twilio:whatsapp:+54911race${Date.now()}`;
  await sessionService.resetSession(userId);
  const conversation = {
    id: 'conv-race-close',
    status: 'bot',
    currentNodeKey: 'welcome',
    currentFlowId: 'first-contact-e2e-flow',
    externalUserId: userId,
    contactEmail: 'race@example.com',
  };
  let reloads = 0;
  let syncs = 0;
  const extras = {
    outbounds: [],
    overrides: {
      reloadConversation: async (current) => {
        reloads += 1;
        if (reloads >= 3) {
          return {
            ...current,
            status: 'bot',
            currentNodeKey: null,
            reentryJson: {
              v: 1,
              status: 'pending',
              flowId: 'main-menu',
              resumeNodeKey: 'no_presenciales_menu',
              variables: {},
              history: [],
              tracking: {},
            },
          };
        }
        return current;
      },
      syncSessionFromFlowEngine: async () => {
        syncs += 1;
        conversation.currentNodeKey = 'fallback_global';
      },
      hydrateRuntimeSessionIfNeeded: async (hydratedUserId) => {
        await sessionService.createSession(hydratedUserId, conversation.currentFlowId, 'welcome', {
          simulatorFlowOverride: buildMenuFlow(),
        });
        return sessionService.getSession(hydratedUserId);
      },
    },
  };
  const restore = stubConversationService(conversation, extras);
  const prevNormalize = conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded;
  conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = async (current) => ({
    conversation: current,
    normalized: false,
  });
  const prevHandoff = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;
  const prevConsume = conversationReentryService.consumeInbound;
  conversationReentryService.consumeInbound = async (current) => {
    if (!current?.reentryJson) return null;
    return {
      action: 'prompt',
      reply: REENTRY_PROMPT,
      conversation: { ...current, currentNodeKey: null, reentryJson: { ...current.reentryJson, status: 'awaiting_choice' } },
    };
  };

  try {
    const processed = await processCanonicalTwilioInbound({
      userId,
      flowId: conversation.currentFlowId,
      text: 'quería seguir con la misma consulta',
      messageId: 'SM-race-close',
      provider: 'twilio',
      phone: '+5491100000099',
      rawPayload: {},
    }, { flowSnapshot: buildMenuFlow() });
    assert.equal(processed.kind, 'reentry');
    assert.equal(processed.reply, REENTRY_PROMPT);
    assert.equal(/No pude entender/i.test(processed.reply), false);
    assert.equal(syncs, 0);
    assert.equal(conversation.currentNodeKey, 'welcome');
    assert.deepEqual(extras.outbounds, [REENTRY_PROMPT]);
  } finally {
    conversationReentryService.consumeInbound = prevConsume;
    humanHandoffRepository.findLatestActiveByConversationId = prevHandoff;
    conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = prevNormalize;
    restore();
    await sessionService.resetSession(userId);
  }
});

test('si el outbound de reentrada no se persiste no se devuelve el prompt', async () => {
  const userId = `twilio:whatsapp:+54911fail${Date.now()}`;
  await sessionService.resetSession(userId);
  const conversation = {
    id: 'conv-reentry-fail',
    status: 'bot',
    currentNodeKey: 'welcome',
    currentFlowId: 'first-contact-e2e-flow',
    externalUserId: userId,
    contactEmail: 'fail@example.com',
  };
  let syncs = 0;
  let reloads = 0;
  const extras = {
    overrides: {
      reloadConversation: async (current) => {
        reloads += 1;
        if (reloads >= 3) {
          return {
            ...current,
            currentNodeKey: null,
            reentryJson: { v: 1, status: 'pending', flowId: 'main-menu', flowVersion: 'v1' },
          };
        }
        return current;
      },
      syncSessionFromFlowEngine: async () => {
        syncs += 1;
      },
      hydrateRuntimeSessionIfNeeded: async (hydratedUserId) => {
        await sessionService.createSession(hydratedUserId, conversation.currentFlowId, 'welcome', {
          simulatorFlowOverride: buildMenuFlow(),
        });
        return sessionService.getSession(hydratedUserId);
      },
    },
  };
  const restore = stubConversationService(conversation, extras);
  const prevNormalize = conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded;
  conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = async (current) => ({
    conversation: current,
    normalized: false,
  });
  const prevHandoff = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;
  const prevConsume = conversationReentryService.consumeInbound;
  conversationReentryService.consumeInbound = async (current) => {
    if (!current?.reentryJson) return null;
    return {
      action: 'prompt',
      reply: REENTRY_PROMPT,
      conversation: current,
    };
  };
  const prevFinish = messagePersistence.finishReentry;
  messagePersistence.finishReentry = async () => {
    throw new Error('outbound insert failed');
  };

  try {
    await assert.rejects(
      () => processCanonicalTwilioInbound({
        userId,
        flowId: conversation.currentFlowId,
        text: 'texto libre',
        messageId: 'SM-reentry-fail',
        provider: 'twilio',
        phone: '+5491100000098',
        rawPayload: {},
      }, { flowSnapshot: buildMenuFlow() }),
      /outbound insert failed/,
    );
    assert.equal(syncs, 0);
  } finally {
    messagePersistence.finishReentry = prevFinish;
    conversationReentryService.consumeInbound = prevConsume;
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

test('una toma que commitea durante el turno anula el TwiML del bot', async () => {
  const userId = `twilio:whatsapp:+54911take${Date.now()}`;
  await sessionService.resetSession(userId);
  const conversation = {
    id: 'conv-takeover-race',
    status: 'bot',
    currentNodeKey: null,
    currentFlowId: 'first-contact-e2e-flow',
    currentFlowVersion: null,
    statusVersion: 2,
  };
  const extras = { outbounds: [] };
  const restore = stubConversationService(conversation, extras);
  const prevNormalize = conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded;
  conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = async (current) => ({
    conversation: current,
    normalized: false,
  });
  const prevHandoff = humanHandoffRepository.findLatestActiveByConversationId;
  humanHandoffRepository.findLatestActiveByConversationId = async () => null;
  const prevGuard = conversationTurnGuard.authorizeAutomaticReply;
  conversationTurnGuard.authorizeAutomaticReply = async () => ({
    decision: 'SUPPRESS',
    suppress: true,
    reason: 'not_bot',
    conversation: { ...conversation, status: 'assigned', statusVersion: 3 },
    persisted: null,
  });

  try {
    const processed = await processCanonicalTwilioInbound({
      userId,
      flowId: conversation.currentFlowId,
      text: INSCRIPTION_TEXT,
      messageId: 'SM-takeover-race',
      provider: 'twilio',
      rawPayload: {},
    }, { flowSnapshot: buildMenuFlow() });
    assert.equal(processed.kind, 'human_mode_skip');
    assert.equal(processed.shouldSendTwiml, false);
    assert.equal(processed.reply, null);
    assert.deepEqual(extras.outbounds, []);
  } finally {
    conversationTurnGuard.authorizeAutomaticReply = prevGuard;
    humanHandoffRepository.findLatestActiveByConversationId = prevHandoff;
    conversationBotLifecycleService.normalizeLegacyBotStateIfNeeded = prevNormalize;
    restore();
    await sessionService.resetSession(userId);
  }
});
