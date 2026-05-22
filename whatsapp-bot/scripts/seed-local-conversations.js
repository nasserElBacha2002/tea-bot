#!/usr/bin/env node
/**
 * Seed local de conversaciones para probar el inbox sin Twilio.
 * Solo dev / ALLOW_DEV_SEED=true. No envía mensajes externos.
 */
import dotenv from 'dotenv';
import { ensureConversationDbReady } from '../src/db/conversation-db-health.js';
import { query } from '../src/db/index.js';
import conversationRepository from '../src/repositories/conversation.repository.js';
import conversationMessageRepository from '../src/repositories/conversation-message.repository.js';
import conversationSessionRepository from '../src/repositories/conversation-session.repository.js';
import humanHandoffRepository from '../src/repositories/human-handoff.repository.js';
import flowDbRepository from '../src/repositories/flow-db.repository.js';
import jsonFlowLoader from '../src/loaders/json-flow-loader.js';

dotenv.config();

const SEED_META = { seed: true, createdFor: 'local-development' };

function assertDevSeedAllowed() {
  const allow = process.env.ALLOW_DEV_SEED === 'true';
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && !allow) {
    console.error(
      'Abortado: seed bloqueado en producción. Usá ALLOW_DEV_SEED=true solo en entornos controlados.',
    );
    process.exit(1);
  }
}

async function deleteSeedData() {
  await query(
    `DELETE FROM dbo.conversation_messages
     WHERE metadata_json LIKE N'%"seed":true%' OR metadata_json LIKE N'%"seed": true%'`,
  );
  await query(
    `DELETE FROM dbo.human_handoffs
     WHERE reason LIKE N'Seed local:%'`,
  );
  await query(
    `DELETE FROM dbo.conversation_sessions
     WHERE conversation_id IN (
       SELECT id FROM dbo.conversations
       WHERE external_user_id LIKE N'SIM-%'
     )`,
  );
  await query(
    `DELETE FROM dbo.conversations WHERE external_user_id LIKE N'SIM-%'`,
  );
  console.log('Seed reset: conversaciones SIM-* y mensajes seed eliminados.');
}

async function resolveLatestFlowVersion() {
  try {
    const snap = await flowDbRepository.getLatestPublishedSnapshot('main-menu');
    if (snap?.versionLabel) return snap.versionLabel;
  } catch {
    /* ignore */
  }
  try {
    const loaded = await jsonFlowLoader.loadActivePublished('main-menu');
    return loaded?.source?.version || 'v1';
  } catch {
    return 'v1';
  }
}

async function upsertSeedConversation(def) {
  let conv = await conversationRepository.findByChannelAndExternalUserId(
    def.channel,
    def.externalUserId,
  );
  if (!conv) {
    conv = await conversationRepository.createConversation({
      channel: def.channel,
      provider: def.provider,
      externalUserId: def.externalUserId,
      phoneNumber: def.phoneNumber,
      displayName: def.displayName,
      status: def.status,
      currentFlowId: def.currentFlowId,
      currentFlowVersion: def.currentFlowVersion,
      currentNodeKey: def.currentNodeKey,
    });
  } else {
    conv = await conversationRepository.updateConversation(conv.id, {
      displayName: def.displayName,
      status: def.status,
      currentFlowId: def.currentFlowId,
      currentFlowVersion: def.currentFlowVersion,
      currentNodeKey: def.currentNodeKey,
      assignedAgentId: def.assignedAgentId ?? null,
      closedAt: def.closedAt ?? null,
    });
  }

  const existingMsgs = await conversationMessageRepository.listByConversationId(conv.id, {
    limit: 1,
  });
  if (existingMsgs.length === 0) {
    for (const msg of def.messages) {
      await conversationMessageRepository.createMessage({
        conversationId: conv.id,
        direction: msg.direction,
        senderType: msg.senderType,
        body: msg.body,
        provider: def.provider,
        metadataJson: { ...SEED_META, seedName: def.seedName, ...msg.metadata },
      });
    }
  }

  const active = await conversationSessionRepository.findLatestOpenByConversationId(conv.id);
  if (!active && def.session) {
    const session = await conversationSessionRepository.createSession({
      conversationId: conv.id,
      flowId: def.currentFlowId,
      flowVersion: def.currentFlowVersion,
      currentNodeKey: def.session.currentNodeKey,
      variablesJson: def.session.variables || {},
      historyJson: def.session.history || [],
      status: def.session.status,
    });
    if (def.session.endedAt) {
      await conversationSessionRepository.endSession(session.id, def.session.endedAt);
    } else if (def.session.status === 'paused') {
      await conversationSessionRepository.updateSession(session.id, { status: 'paused' });
    }
  }

  if (def.handoff) {
    const pending = await humanHandoffRepository.findPendingByConversationId(conv.id);
    if (!pending && def.handoff.status === 'pending') {
      await humanHandoffRepository.createHandoff({
        conversationId: conv.id,
        requestedBy: def.handoff.requestedBy || 'user',
        reason: def.handoff.reason,
        status: 'pending',
      });
    } else if (def.handoff.status === 'assigned') {
      const latest = await humanHandoffRepository.findLatestByConversationId(conv.id);
      if (latest && latest.status === 'pending') {
        await humanHandoffRepository.updateHandoff(latest.id, {
          status: 'assigned',
          assignedAt: new Date(),
        });
      } else if (!latest) {
        await humanHandoffRepository.createHandoff({
          conversationId: conv.id,
          requestedBy: 'user',
          reason: def.handoff.reason,
          status: 'assigned',
        });
      }
    } else if (def.handoff.status === 'resolved') {
      const latest = await humanHandoffRepository.findLatestByConversationId(conv.id);
      if (latest) {
        await humanHandoffRepository.updateHandoff(latest.id, {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionNote: def.handoff.resolutionNote,
        });
      }
    }
  }

  await conversationRepository.touchLastMessage(conv.id);
  return conv;
}

async function main() {
  assertDevSeedAllowed();
  const reset = process.argv.includes('--reset') || process.env.RESET_DEV_SEED === 'true';

  await ensureConversationDbReady();

  if (reset) {
    await deleteSeedData();
  }

  const flowVersion = await resolveLatestFlowVersion();
  const entryNode = 'welcome';
  const handoffNode = 'human_handoff';

  const handoffMessage =
    'Perfecto. Te vamos a derivar con una persona del equipo. Te van a responder por este mismo chat.';

  const seeds = [
    {
      seedName: 'bot-active',
      channel: 'simulator',
      provider: 'internal',
      externalUserId: 'SIM-BOT-001',
      phoneNumber: 'SIM-BOT-001',
      displayName: 'Simulación - Bot activo',
      status: 'bot',
      currentFlowId: 'main-menu',
      currentFlowVersion: flowVersion,
      currentNodeKey: entryNode,
      messages: [
        { direction: 'inbound', senderType: 'user', body: 'Hola' },
        {
          direction: 'outbound',
          senderType: 'bot',
          body: '¡Hola! ¿En qué puedo ayudarte?',
        },
        { direction: 'inbound', senderType: 'user', body: '1' },
        {
          direction: 'outbound',
          senderType: 'bot',
          body: 'Elegí una opción del menú para continuar.',
        },
      ],
      session: { status: 'active', currentNodeKey: entryNode, history: [entryNode], variables: {} },
    },
    {
      seedName: 'waiting-human',
      channel: 'simulator',
      provider: 'internal',
      externalUserId: 'SIM-HUMAN-001',
      phoneNumber: 'SIM-HUMAN-001',
      displayName: 'Simulación - Esperando humano',
      status: 'waiting_human',
      currentFlowId: 'main-menu',
      currentFlowVersion: flowVersion,
      currentNodeKey: handoffNode,
      messages: [
        { direction: 'inbound', senderType: 'user', body: 'Quiero hablar con una persona' },
        { direction: 'outbound', senderType: 'bot', body: handoffMessage },
        { direction: 'inbound', senderType: 'user', body: '¿Hay alguien disponible?' },
      ],
      session: {
        status: 'paused',
        currentNodeKey: handoffNode,
        history: [entryNode, handoffNode],
        variables: {},
      },
      handoff: {
        requestedBy: 'user',
        reason: 'Seed local: el usuario pidió hablar con una persona',
        status: 'pending',
      },
    },
    {
      seedName: 'assigned',
      channel: 'simulator',
      provider: 'internal',
      externalUserId: 'SIM-ASSIGNED-001',
      phoneNumber: 'SIM-ASSIGNED-001',
      displayName: 'Simulación - Asignada',
      status: 'assigned',
      currentFlowId: 'main-menu',
      currentFlowVersion: flowVersion,
      currentNodeKey: handoffNode,
      messages: [
        { direction: 'inbound', senderType: 'user', body: 'Necesito información sobre inscripción' },
        { direction: 'outbound', senderType: 'bot', body: handoffMessage },
        {
          direction: 'outbound',
          senderType: 'agent',
          body: 'Hola, soy del equipo de Tea. Te ayudo con tu consulta.',
        },
        {
          direction: 'inbound',
          senderType: 'user',
          body: 'Gracias, quería saber los horarios.',
        },
      ],
      session: { status: 'paused', currentNodeKey: handoffNode, history: [], variables: {} },
      handoff: {
        reason: 'Seed local: asignada para pruebas',
        status: 'assigned',
      },
    },
    {
      seedName: 'closed',
      channel: 'simulator',
      provider: 'internal',
      externalUserId: 'SIM-CLOSED-001',
      phoneNumber: 'SIM-CLOSED-001',
      displayName: 'Simulación - Cerrada',
      status: 'closed',
      closedAt: new Date(),
      currentFlowId: 'main-menu',
      currentFlowVersion: flowVersion,
      currentNodeKey: handoffNode,
      messages: [
        { direction: 'inbound', senderType: 'user', body: 'Hola, necesito ayuda' },
        { direction: 'outbound', senderType: 'bot', body: handoffMessage },
        {
          direction: 'outbound',
          senderType: 'agent',
          body: 'La consulta quedó resuelta.',
        },
        {
          direction: 'outbound',
          senderType: 'system',
          body: 'Conversación cerrada por el equipo.',
          metadata: { event: 'conversation_closed' },
        },
      ],
      session: {
        status: 'ended',
        currentNodeKey: handoffNode,
        history: [],
        variables: {},
        endedAt: new Date(),
      },
      handoff: {
        status: 'resolved',
        resolutionNote: 'Seed local: consulta resuelta',
      },
    },
    {
      seedName: 'whatsapp-like-ui',
      channel: 'simulator',
      provider: 'internal',
      externalUserId: 'SIM-WA-001',
      phoneNumber: '+5491100000001',
      displayName: 'Seed WhatsApp local',
      status: 'waiting_human',
      currentFlowId: 'main-menu',
      currentFlowVersion: flowVersion,
      currentNodeKey: handoffNode,
      messages: [
        { direction: 'inbound', senderType: 'user', body: 'Hola desde simulador tipo WhatsApp' },
      ],
      session: { status: 'paused', currentNodeKey: handoffNode, history: [], variables: {} },
      handoff: {
        requestedBy: 'user',
        reason: 'Seed local: UI tipo WhatsApp',
        status: 'pending',
      },
    },
  ];

  for (const def of seeds) {
    const conv = await upsertSeedConversation(def);
    console.log(`  seed OK: ${def.seedName} → ${conv.id} (${def.status})`);
  }

  console.log(`Seed completado (${seeds.length} conversaciones). flowVersion=${flowVersion}`);
  console.log('Abrí el inbox en /conversations y filtrá por Simulador / estados.');
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
