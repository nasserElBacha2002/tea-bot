import type { ConversationStep, ConversationViewModel } from './conversationViewModel';

/** Código estable para reglas de validación del editor de conversación. */
export type ConversationValidationCode =
  | 'STEP_MESSAGE_EMPTY'
  | 'STEP_NEEDS_RESPONSE'
  | 'RESPONSE_EXACT_EMPTY'
  | 'RESPONSE_ANYOF_EMPTY'
  | 'RESPONSE_DESTINATION_MISSING'
  | 'RESPONSE_DESTINATION_UNKNOWN'
  | 'MULTIPLE_FALLBACK'
  | 'ENTRY_STEP_MISSING'
  | 'FALLBACK_STEP_MISSING'
  | 'PAYLOAD_FLOW_ID_MISSING'
  | 'PAYLOAD_NODES_INVALID'
  | 'PAYLOAD_NODES_EMPTY'
  | 'PAYLOAD_SCHEMA_INVALID'
  | 'PAYLOAD_DUPLICATE_NODE_ID'
  | 'PAYLOAD_NODE_ID_MISSING'
  | 'PAYLOAD_NODE_TYPE_INVALID'
  | 'PAYLOAD_TRANSITIONS_INVALID'
  | 'PAYLOAD_TRANSITION_NEXT_MISSING'
  | 'PAYLOAD_TRANSITION_NEXT_UNKNOWN'
  | 'PAYLOAD_TRANSITION_TYPE_INVALID'
  | 'PAYLOAD_NEXT_NODE_UNKNOWN';

export interface ConversationValidationIssue {
  code: ConversationValidationCode;
  message: string;
  stepInternalId: string;
  responseUiId?: string;
}

function stepNeedsClientResponses(step: ConversationStep): boolean {
  if (step.metadata.messageAutoAdvanceNextNode) return false;
  if (step.metadata.preservedTransitions?.length) return false;
  const t = step.metadata.nodeType;
  if (t === 'redirect' || t === 'end') return false;
  return t === 'message' || t === 'capture';
}

/** Alineado con `flow-validator.js`: todo nodo debe tener `message` string no vacío (incl. redirect). */
function messageRequired(step: ConversationStep): boolean {
  const t = step.metadata.nodeType;
  return t === 'message' || t === 'capture' || t === 'redirect' || t === 'end';
}

/**
 * Valida el modelo de conversación para la UI simple (mensajes en español, sin jerga técnica).
 */
export function validateConversationViewModel(vm: ConversationViewModel): ConversationValidationIssue[] {
  const issues: ConversationValidationIssue[] = [];
  if (!vm.flowId) return issues;

  const stepIds = new Set(vm.steps.map(s => s.internalId));

  if (!stepIds.has(vm.entryStepId)) {
    issues.push({
      code: 'ENTRY_STEP_MISSING',
      message: 'Falta el inicio de la conversación. Revisa la configuración en la vista clásica.',
      stepInternalId: vm.entryStepId,
    });
  }
  if (!stepIds.has(vm.fallbackStepId)) {
    issues.push({
      code: 'FALLBACK_STEP_MISSING',
      message: 'Falta el paso de respaldo. Revisa la configuración en la vista clásica.',
      stepInternalId: vm.fallbackStepId,
    });
  }

  for (const step of vm.steps) {
    if (messageRequired(step) && !step.message.trim()) {
      issues.push({
        code: 'STEP_MESSAGE_EMPTY',
        message: 'Escribí el mensaje que verá el cliente en este paso.',
        stepInternalId: step.internalId,
      });
    }

    if (stepNeedsClientResponses(step) && step.responses.length === 0) {
      issues.push({
        code: 'STEP_NEEDS_RESPONSE',
        message: 'Añadí al menos una respuesta posible o revisá este paso en la vista clásica.',
        stepInternalId: step.internalId,
      });
    }

    const fallbacks = step.responses.filter(r => r.kind === 'fallback');
    if (fallbacks.length > 1) {
      fallbacks.slice(1).forEach(r => {
        issues.push({
          code: 'MULTIPLE_FALLBACK',
          message: 'Solo puede haber una fila «en cualquier otro caso». Elimina esta duplicada.',
          stepInternalId: step.internalId,
          responseUiId: r.uiId,
        });
      });
    }

    for (const r of step.responses) {
      if (!r.destinationStepId?.trim()) {
        issues.push({
          code: 'RESPONSE_DESTINATION_MISSING',
          message: 'Elige a qué parte de la conversación va después.',
          stepInternalId: step.internalId,
          responseUiId: r.uiId,
        });
      } else if (!stepIds.has(r.destinationStepId)) {
        issues.push({
          code: 'RESPONSE_DESTINATION_UNKNOWN',
          message: 'El destino elegido ya no existe. Elige otro paso.',
          stepInternalId: step.internalId,
          responseUiId: r.uiId,
        });
      }

      if (r.kind === 'exact') {
        const v = (r.values[0] ?? '').trim();
        if (!v) {
          issues.push({
            code: 'RESPONSE_EXACT_EMPTY',
            message: 'Indica qué debe decir exactamente el cliente.',
            stepInternalId: step.internalId,
            responseUiId: r.uiId,
          });
        }
      }
      if (r.kind === 'anyOf') {
        const vals = r.values.map(x => x.trim()).filter(Boolean);
        if (vals.length === 0) {
          issues.push({
            code: 'RESPONSE_ANYOF_EMPTY',
            message: 'Añade al menos una palabra o frase que valga.',
            stepInternalId: step.internalId,
            responseUiId: r.uiId,
          });
        }
      }
    }
  }

  return issues;
}

export function issuesForStep(stepInternalId: string, issues: ConversationValidationIssue[]): ConversationValidationIssue[] {
  return issues.filter(i => i.stepInternalId === stepInternalId && !i.responseUiId);
}

export function issuesForResponse(
  stepInternalId: string,
  responseUiId: string,
  issues: ConversationValidationIssue[]
): ConversationValidationIssue[] {
  return issues.filter(i => i.stepInternalId === stepInternalId && i.responseUiId === responseUiId);
}

function stepIssueLabel(step: ConversationStep | undefined): string {
  const t = step?.title?.trim();
  return t ? `"${t}"` : 'Un paso sin nombre';
}

function describeIssuesForStep(stepIssues: ConversationValidationIssue[]): string {
  const codes = new Set(stepIssues.map(i => i.code));
  const bits: string[] = [];
  if (codes.has('STEP_MESSAGE_EMPTY')) bits.push('no tiene mensaje del bot');
  if (codes.has('STEP_NEEDS_RESPONSE')) bits.push('no tiene respuestas configuradas');
  const rowLevel = [...codes].some(
    c =>
      c === 'RESPONSE_DESTINATION_MISSING' ||
      c === 'RESPONSE_DESTINATION_UNKNOWN' ||
      c === 'RESPONSE_EXACT_EMPTY' ||
      c === 'RESPONSE_ANYOF_EMPTY' ||
      c === 'MULTIPLE_FALLBACK' ||
      c.startsWith('PAYLOAD_')
  );
  if (rowLevel) bits.push('tiene respuestas o destinos incompletos');
  return bits.join(' y ');
}

/**
 * Resumen legible para el encabezado del editor (sin ids internos).
 */
export function buildConversationValidationSummary(
  vm: ConversationViewModel,
  issues: ConversationValidationIssue[]
): string {
  if (issues.length === 0) return '';
  const n = issues.length;
  const header = n === 1 ? 'Hay 1 aviso.' : `Hay ${n} avisos.`;

  const globals = issues.filter(i => i.code === 'ENTRY_STEP_MISSING' || i.code === 'FALLBACK_STEP_MISSING');
  const rest = issues.filter(i => i.code !== 'ENTRY_STEP_MISSING' && i.code !== 'FALLBACK_STEP_MISSING');

  const globalParts = globals.map(g => g.message);

  const stepOrder = new Map(vm.steps.map((s, i) => [s.internalId, i]));
  const byStep = new Map<string, ConversationValidationIssue[]>();
  for (const issue of rest) {
    const arr = byStep.get(issue.stepInternalId) ?? [];
    arr.push(issue);
    byStep.set(issue.stepInternalId, arr);
  }

  const sortedIds = [...byStep.keys()].sort(
    (a, b) => (stepOrder.get(a) ?? 9999) - (stepOrder.get(b) ?? 9999)
  );

  const stepParts = sortedIds.map(id => {
    const step = vm.steps.find(s => s.internalId === id);
    const label = stepIssueLabel(step);
    const merged = byStep.get(id) ?? [];
    let body = describeIssuesForStep(merged);
    if (!body) {
      const uniq = [...new Set(merged.map(m => m.message))];
      body = uniq.join(' ');
    }
    return body ? `El paso ${label} ${body}.` : '';
  }).filter(Boolean);

  return [header, ...globalParts, ...stepParts].join(' ').trim();
}

/**
 * Primer paso con problemas, en el orden del índice (para foco y scroll).
 */
export function firstInvalidStepIdInDisplayOrder(
  vm: ConversationViewModel,
  issues: ConversationValidationIssue[]
): string | null {
  const affected = new Set(issues.map(i => i.stepInternalId));
  for (const s of vm.steps) {
    if (affected.has(s.internalId)) return s.internalId;
  }
  return issues[0]?.stepInternalId ?? null;
}

const issueDedupeKey = (i: ConversationValidationIssue): string =>
  `${i.code}:${i.stepInternalId}:${i.responseUiId ?? ''}`;

/**
 * Combina validación del modelo de conversación y del JSON listo para el backend, sin duplicar el mismo aviso.
 */
export function mergeValidationIssues(
  vmIssues: ConversationValidationIssue[],
  payloadIssues: ConversationValidationIssue[]
): ConversationValidationIssue[] {
  const map = new Map<string, ConversationValidationIssue>();
  for (const i of vmIssues) {
    map.set(issueDedupeKey(i), i);
  }
  for (const i of payloadIssues) {
    const k = issueDedupeKey(i);
    if (!map.has(k)) map.set(k, i);
  }
  return [...map.values()];
}
