/**
 * Modo de almacenamiento de flujos en runtime.
 * - json: solo archivos JSON (default explícito o sin DB flows)
 * - db: solo snapshots en SQL Server
 * - db_with_json_fallback: DB primero, JSON si falla
 */
export const FLOW_STORAGE_MODES = ['json', 'db', 'db_with_json_fallback'];

export function getFlowStorageMode() {
  const raw = String(process.env.FLOW_STORAGE_MODE || 'json').trim().toLowerCase();
  if (FLOW_STORAGE_MODES.includes(raw)) return raw;
  console.warn(
    `[FlowStorage] FLOW_STORAGE_MODE="${raw}" inválido; usando "json". Valores: ${FLOW_STORAGE_MODES.join(', ')}`,
  );
  return 'json';
}

export function isDbFlowStorageEnabled() {
  const mode = getFlowStorageMode();
  return mode === 'db' || mode === 'db_with_json_fallback';
}
