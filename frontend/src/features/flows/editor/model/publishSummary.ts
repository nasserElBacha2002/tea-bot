import type { ConversationResponse, ConversationStep, ConversationViewModel } from './conversationViewModel';

function responseFingerprint(r: ConversationResponse): string {
  return `${r.kind}:${r.values.join('\u001f')}:${r.destinationStepId}:${r.displayOrder}`;
}

function stepTitle(step: ConversationStep): string {
  return step.title.trim() || 'Sin título';
}

/**
 * Compara el borrador actual con la versión en vivo (como view model) y devuelve frases legibles.
 */
export function buildPublishChangeSummary(
  draft: ConversationViewModel,
  baseline: ConversationViewModel | null
): string[] {
  if (!baseline) {
    if (draft.steps.length === 0) {
      return ['Primera publicación: el borrador aún no tiene pasos.'];
    }
    const intro = 'Es la primera vez que publicás esta conversación.';
    const perStep = draft.steps.slice(0, 12).map(s => `Incluirá el paso: «${stepTitle(s)}»`);
    const extra =
      draft.steps.length > 12 ? [`…y ${draft.steps.length - 12} paso(s) más.`] : [];
    return [intro, ...perStep, ...extra];
  }

  const lines: string[] = [];
  const baseById = new Map(baseline.steps.map(s => [s.internalId, s]));
  const draftById = new Map(draft.steps.map(s => [s.internalId, s]));

  for (const s of draft.steps) {
    const b = baseById.get(s.internalId);
    if (!b) {
      lines.push(`Nuevo paso: «${stepTitle(s)}»`);
      continue;
    }
    if ((b.title ?? '').trim() !== (s.title ?? '').trim()) {
      lines.push(`Título del paso actualizado: «${stepTitle(b)}» → «${stepTitle(s)}»`);
    }
    if ((b.message ?? '').trim() !== (s.message ?? '').trim()) {
      lines.push(`Mensaje cambiado en: «${stepTitle(s)}»`);
    }

    const br = [...b.responses].sort((a, x) => a.displayOrder - x.displayOrder);
    const dr = [...s.responses].sort((a, x) => a.displayOrder - x.displayOrder);
    if (dr.length > br.length) {
      lines.push(`Nueva respuesta en: «${stepTitle(s)}»`);
    } else if (dr.length < br.length) {
      lines.push(`Se quitó una respuesta en: «${stepTitle(s)}»`);
    } else {
      let respChanged = false;
      for (let i = 0; i < dr.length; i++) {
        const bi = br[i];
        const di = dr[i];
        if (bi && di && responseFingerprint(bi) !== responseFingerprint(di)) {
          respChanged = true;
          break;
        }
      }
      if (respChanged) {
        lines.push(`Respuesta modificada en: «${stepTitle(s)}»`);
      }
    }
  }

  for (const b of baseline.steps) {
    if (!draftById.has(b.internalId)) {
      lines.push(`Se eliminó un paso respecto a la versión en vivo: «${stepTitle(b)}»`);
    }
  }

  if (
    lines.length === 0 &&
    (draft.entryStepId !== baseline.entryStepId || draft.fallbackStepId !== baseline.fallbackStepId)
  ) {
    lines.push('Cambió la configuración de inicio o de respaldo de la conversación.');
  }

  if (lines.length === 0) {
    lines.push('Cambios guardados en la versión en preparación desde la última vez en vivo.');
  }

  return lines;
}

/** Firma estable del flujo técnico para saber si hay diferencia con la versión en vivo. */
export function flowFingerprintForPublish(flow: { entryNode: string; fallbackNode: string; nodes: unknown[] }): string {
  try {
    return JSON.stringify({
      entryNode: flow.entryNode,
      fallbackNode: flow.fallbackNode,
      nodes: flow.nodes,
    });
  } catch {
    return '';
  }
}
