#!/usr/bin/env node
/**
 * Diagnóstico de asignación de conversación vs identidad de agente.
 *
 * Uso:
 *   node scripts/diagnose-conversation-assignment.js <conversationId> [username]
 *
 * Ejemplo:
 *   node scripts/diagnose-conversation-assignment.js 87CCB00E-B2E0-4AC3-903A-2D398ACA0D07 admin
 */
import conversationRepository from '../src/repositories/conversation.repository.js';
import humanHandoffRepository from '../src/repositories/human-handoff.repository.js';
import {
  agentsMatch,
  normalizeAgentId,
  resolveAgentIdFromUsername,
} from '../src/utils/agent-identity.js';
import { closePool } from '../src/db/index.js';

const conversationId = process.argv[2];
const username = process.argv[3] || 'admin';

if (!conversationId) {
  console.error('Usage: node scripts/diagnose-conversation-assignment.js <conversationId> [username]');
  process.exit(1);
}

function decisionLabel(conversationAssignedId) {
  if (!conversationAssignedId) return 'unassigned';
  return 'shared_inbox_human';
}

try {
  const configuredInternalAgentId = (process.env.INTERNAL_AGENT_ID || '').trim() || null;
  const currentAgentId = resolveAgentIdFromUsername(username);
  const conversation = await conversationRepository.getConversationById(conversationId);
  const handoff = await humanHandoffRepository.findLatestByConversationId(conversationId);

  if (!conversation) {
    console.log(JSON.stringify({ ok: false, error: 'conversation_not_found', conversationId }, null, 2));
    process.exit(2);
  }

  const payload = {
    ok: true,
    conversationId,
    username,
    configuredInternalAgentId,
    currentAgentId,
    currentAgentIdNormalized: normalizeAgentId(currentAgentId),
    conversation: {
      status: conversation.status,
      assignedAgentId: conversation.assignedAgentId,
      assignedAgentIdNormalized: normalizeAgentId(conversation.assignedAgentId),
    },
    humanHandoff: handoff
      ? {
          status: handoff.status,
          assignedAgentId: handoff.assignedAgentId,
          assignedAgentIdNormalized: normalizeAgentId(handoff.assignedAgentId),
        }
      : null,
    matches: {
      conversationVsCurrent: agentsMatch(conversation.assignedAgentId, currentAgentId),
      handoffVsCurrent: agentsMatch(handoff?.assignedAgentId, currentAgentId),
      conversationVsHandoff: agentsMatch(
        conversation.assignedAgentId,
        handoff?.assignedAgentId,
      ),
    },
    uiDecision: decisionLabel(conversation.assignedAgentId),
    sharedInbox: true,
  };

  console.log(JSON.stringify(payload, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(1);
} finally {
  await closePool();
}
