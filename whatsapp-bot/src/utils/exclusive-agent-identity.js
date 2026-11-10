/**
 * Con la toma exclusiva, admin y operador tienen que ser agentes distintos.
 * INTERNAL_AGENT_ID reemplaza el id derivado del usuario para todas las cuentas.
 * El resultado no incluye el valor de la variable.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ code: 'SHARED_AGENT_IDENTITY', message: string } | null}
 */
export function exclusiveAgentIdentityConflict(env = process.env) {
  const sharedId = String(env.INTERNAL_AGENT_ID || '').trim();
  if (!sharedId) return null;
  const admin = String(env.ADMIN_USERNAME || '').trim();
  const operator = String(env.CONVERSATIONS_OPERATOR_USERNAME || '').trim();
  if (!admin || !operator) return null;
  if (admin.toLowerCase() === operator.toLowerCase()) return null;
  return {
    code: 'SHARED_AGENT_IDENTITY',
    message: 'INTERNAL_AGENT_ID hace que el administrador y el operador sean el mismo agente. La toma exclusiva no puede distinguirlos. Quite esa variable antes de activar la toma manual.',
  };
}
