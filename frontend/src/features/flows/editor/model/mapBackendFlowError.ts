/**
 * Convierte errores del API de flujos (con ids internos de nodos) en mensajes legibles.
 */

export type StepTitleLookup = { internalId: string; title: string };

export function extractNodeIdFromNodoError(raw: string): string | null {
  const m = /El nodo "([^"]+)"/.exec(raw);
  return m?.[1] ?? null;
}

export function extractNodeIdFromFlowFieldPath(raw: string): string | null {
  const fromPath = /nodes\.([^.[\]]+)\./.exec(raw);
  if (fromPath) return fromPath[1];
  const fromParen = /\(node ([^)]+)\)/.exec(raw);
  return fromParen?.[1] ?? null;
}

export function extractNodeIdFromBackendFlowError(raw: string): string | null {
  return extractNodeIdFromNodoError(raw) || extractNodeIdFromFlowFieldPath(raw);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sustituye ids de nodos conocidos por el título visible entre comillas.
 */
export function replaceKnownNodeIdsInMessage(raw: string, steps: StepTitleLookup[]): string {
  let out = raw;
  for (const s of steps) {
    const t = s.title?.trim();
    if (!t) continue;
    out = out.replace(new RegExp(`"${escapeRegExp(s.internalId)}"`, 'g'), `"${t}"`);
  }
  return out;
}

/**
 * Mapea mensajes frecuentes de validación del servidor a copy orientada al usuario.
 */
export function mapBackendFlowErrorToUserMessage(raw: string, steps: StepTitleLookup[]): string {
  const requireField = /El nodo "([^"]+)" de tipo "([^"]+)" requiere un campo "([^"]+)"\./.exec(raw);
  if (requireField) {
    const [, nodeId, , field] = requireField;
    const step = steps.find(s => s.internalId === nodeId);
    const name = step?.title?.trim();
    if (field === 'message') {
      return name ? `El paso "${name}" requiere un mensaje del bot.` : 'Un paso requiere un mensaje del bot.';
    }
    return name
      ? `El paso "${name}" requiere completar el campo "${field}".`
      : replaceKnownNodeIdsInMessage(raw, steps);
  }

  const softened = replaceKnownNodeIdsInMessage(raw, steps);

  const invalidField = /Invalid flow [^:]+: field nodes\.([^.[\]]+)\.transitions\[(\d+)\]\.value/.exec(raw);
  if (invalidField) {
    const [, nodeId, index] = invalidField;
    const step = steps.find(s => s.internalId === nodeId);
    const name = step?.title?.trim() || nodeId;
    return `El paso «${name}» tiene una respuesta avanzada (transición ${Number(index) + 1}) sin texto definido. Revisalo en el mapa o la vista clásica.`;
  }

  return softened;
}
