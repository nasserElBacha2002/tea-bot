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
  | 'FALLBACK_STEP_MISSING';

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

function messageRequired(step: ConversationStep): boolean {
  const t = step.metadata.nodeType;
  return t === 'message' || t === 'capture' || t === 'end';
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
        message: 'Escribe el mensaje que verá el cliente.',
        stepInternalId: step.internalId,
      });
    }

    if (stepNeedsClientResponses(step) && step.responses.length === 0) {
      issues.push({
        code: 'STEP_NEEDS_RESPONSE',
        message: 'Añade al menos una respuesta posible o revisa este paso en la vista clásica.',
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
