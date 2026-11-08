import crypto from 'crypto';
import { config } from '../config.js';

/**
 * @param {string | null | undefined} agentId
 * @returns {string | null}
 */
export function normalizeAgentId(agentId) {
  if (agentId == null) return null;
  const trimmed = String(agentId).trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 */
export function agentsMatch(left, right) {
  const a = normalizeAgentId(left);
  const b = normalizeAgentId(right);
  return Boolean(a && b && a === b);
}

/**
 * ID estable para assigned_agent_id sin tabla de usuarios.
 * @param {string} [username]
 */
export function resolveAgentIdFromUsername(username = 'system') {
  const configured = (process.env.INTERNAL_AGENT_ID || '').trim();
  if (configured) return configured;

  const user = username || 'system';
  const hash = crypto.createHash('sha256').update(`tea-agent:${user}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `a${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

/**
 * ID estable para assigned_agent_id sin tabla de usuarios (admin cookie).
 * @param {{ adminUser?: { username?: string } }} req
 */
export function resolveAgentIdFromRequest(req) {
  return resolveAgentIdFromUsername(req?.adminUser?.username);
}

function enabledAccount(username, role, passwordHash) {
  if (!username || !/^[a-f0-9]{64}$/.test(String(passwordHash || ''))) return null;
  return {
    username,
    role,
    agentId: resolveAgentIdFromUsername(username),
    enabled: true,
  };
}

/**
 * Cuentas reales del panel: admin y, si está configurado, el operador de conversaciones.
 * No hay organizaciones ni equipos. El inbox es compartido entre esas cuentas.
 */
export function listEnabledPanelAgents() {
  return [
    enabledAccount(config.adminUsername, 'admin', config.adminPasswordHash),
    enabledAccount(
      config.conversationsOperatorUsername,
      'conversations_only',
      config.conversationsOperatorPasswordHash,
    ),
  ].filter(Boolean);
}

export function resolveEnabledPanelAgent(username) {
  const needle = String(username || '').trim().toLowerCase();
  if (!needle) return null;
  return listEnabledPanelAgents().find((agent) => agent.username.toLowerCase() === needle) || null;
}

export function labelForAssignedAgent(agentId) {
  if (!agentId) return null;
  return listEnabledPanelAgents().find((agent) => agentsMatch(agent.agentId, agentId))?.username || null;
}
