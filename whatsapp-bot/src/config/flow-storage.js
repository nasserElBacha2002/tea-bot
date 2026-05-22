/**
 * Runtime de flujos: única fuente SQL Server (snapshots en DB).
 * Valores legacy json / db_with_json_fallback se ignoran con advertencia.
 */
export const FLOW_STORAGE_MODES = ['db'];

export function getFlowStorageMode() {
  const raw = String(process.env.FLOW_STORAGE_MODE || 'db').trim().toLowerCase();
  if (raw === 'db') return 'db';
  if (['json', 'db_with_json_fallback'].includes(raw)) {
    console.warn(
      `[FlowStorage] FLOW_STORAGE_MODE="${raw}" está obsoleto; usando "db" (única fuente de verdad).`,
    );
    return 'db';
  }
  if (raw) {
    console.warn(`[FlowStorage] FLOW_STORAGE_MODE="${raw}" inválido; usando "db".`);
  }
  return 'db';
}

export function isDbFlowStorageEnabled() {
  return true;
}
