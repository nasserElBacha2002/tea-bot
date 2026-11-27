import type { ComposerFileItem } from './ConversationComposer';

/** Actualiza estados de archivo tras respuesta de lote (expuesto para la página). */
export function applyComposerBatchResults(
  files: ComposerFileItem[],
  results: Array<{ clientRequestId: string; ok: boolean; error?: { message?: string } }>,
): ComposerFileItem[] {
  const byId = new Map(results.map((row) => [row.clientRequestId, row]));
  return files.map((item) => {
    const row = byId.get(item.clientRequestId);
    if (!row) return item;
    return {
      ...item,
      status: row.ok ? 'ok' : 'error',
      errorMessage: row.ok ? null : row.error?.message || 'No se pudo enviar',
    };
  });
}