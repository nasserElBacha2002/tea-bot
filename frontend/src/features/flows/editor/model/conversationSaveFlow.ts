import type { ConversationViewModel } from './conversationViewModel';
import type { ConversationValidationIssue } from './conversationValidation';
import {
  buildConversationValidationSummary,
  firstInvalidStepIdInDisplayOrder,
} from './conversationValidation';

export type SaveFlowPhase = 'idle' | 'validating' | 'saving';

export type LocalValidationResult =
  | { ok: true }
  | { ok: false; message: string; focusStepId?: string };

export function runLocalValidationBeforeSave(
  viewModel: ConversationViewModel,
  issues: ConversationValidationIssue[],
): LocalValidationResult {
  if (issues.length === 0) return { ok: true };

  const summary =
    buildConversationValidationSummary(viewModel, issues) ||
    'No se pudo guardar porque el flujo tiene errores de validación.';
  const focusStepId = firstInvalidStepIdInDisplayOrder(viewModel, issues);
  return { ok: false, message: summary, focusStepId };
}

export const SAVE_MESSAGES = {
  success: 'Cambios guardados correctamente.',
  validationFailed: 'No se pudo guardar porque el flujo tiene errores de validación.',
  persistenceFailed: 'El flujo es válido, pero no se pudieron guardar los cambios.',
  serverValidationFailed: 'No se pudo guardar porque el flujo tiene errores de validación.',
} as const;
