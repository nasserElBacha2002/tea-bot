import crypto from 'crypto';

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
