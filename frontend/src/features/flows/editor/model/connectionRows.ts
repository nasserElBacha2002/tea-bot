import { humanizeNodeId } from './conversationAdapters';
import type { ConversationResponse, ConversationViewModel } from './conversationViewModel';

export interface ConnectionRow {
  id: string;
  originStepId: string;
  destinationStepId: string;
  originTitle: string;
  clientPhrase: string;
  destinationTitle: string;
}

function titleByStepId(vm: ConversationViewModel, stepId: string): string {
  const step = vm.steps.find(s => s.internalId === stepId);
  if (step?.title?.trim()) return step.title.trim();
  return humanizeNodeId(stepId);
}

export function responseClientPhrase(r: ConversationResponse): string {
  if (r.kind === 'exact' && r.values[0]?.trim()) {
    return `Dice exactamente: «${r.values[0].trim()}»`;
  }
  if (r.kind === 'anyOf' && r.values.length > 0) {
    const parts = r.values.map(v => `«${String(v).trim()}»`).filter(Boolean);
    return `Dice una de estas opciones: ${parts.join(', ')}`;
  }
  return 'En cualquier otro caso';
}

/**
 * Filas legibles para la tabla Conexiones (borrador actual del view model).
 */
export function buildConnectionRows(vm: ConversationViewModel): ConnectionRow[] {
  const rows: ConnectionRow[] = [];
  let rowSeq = 0;
  const push = (partial: Omit<ConnectionRow, 'id'>) => {
    rowSeq += 1;
    rows.push({ ...partial, id: `c-${rowSeq}` });
  };

  for (const step of vm.steps) {
    const originTitle = step.title?.trim() || humanizeNodeId(step.internalId);

    for (const r of step.responses) {
      push({
        originStepId: step.internalId,
        destinationStepId: r.destinationStepId,
        originTitle,
        clientPhrase: responseClientPhrase(r),
        destinationTitle: titleByStepId(vm, r.destinationStepId),
      });
    }

    const auto = step.metadata.messageAutoAdvanceNextNode;
    if (auto) {
      push({
        originStepId: step.internalId,
        destinationStepId: auto,
        originTitle,
        clientPhrase: 'Después del mensaje, sigue automáticamente',
        destinationTitle: titleByStepId(vm, auto),
      });
    }

    const parallel = step.metadata.parallelNextNode;
    if (parallel) {
      push({
        originStepId: step.internalId,
        destinationStepId: parallel,
        originTitle,
        clientPhrase: 'También puede enlazar a',
        destinationTitle: titleByStepId(vm, parallel),
      });
    }

    const preserved = step.metadata.preservedTransitions ?? [];
    for (let i = 0; i < preserved.length; i += 1) {
      const t = preserved[i];
      const next = t.nextNode;
      if (!next) continue;
      push({
        originStepId: step.internalId,
        destinationStepId: next,
        originTitle,
        clientPhrase: 'Otra respuesta definida fuera de esta vista',
        destinationTitle: titleByStepId(vm, next),
      });
    }
  }

  return rows;
}
