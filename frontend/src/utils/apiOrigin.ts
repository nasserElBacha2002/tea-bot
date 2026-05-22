/** Origen del API: env explícito o mismo host (proxy Vite en dev). */
export function resolveApiOrigin(): string {
  const env = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
  if (env) return env.replace(/\/$/, '');
  if (typeof window !== 'undefined') return window.location.origin;
  return 'http://localhost:3000';
}

export function resolveWebSocketOrigin(): string {
  return resolveApiOrigin().replace(/^http/, 'ws');
}
