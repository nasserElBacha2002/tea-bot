import type { ConversationViewModel } from './conversationViewModel';
import type { ConversationValidationIssue } from './conversationValidation';

export type PublishWarningSeverity = 'blocking' | 'nonBlocking';

export interface PublishWarningItem {
  id: string;
  message: string;
  severity: PublishWarningSeverity;
}

function stepDisplayTitle(vm: ConversationViewModel, stepInternalId: string): string {
  const s = vm.steps.find(x => x.internalId === stepInternalId);
  return (s?.title ?? '').trim() || 'este paso';
}

/**
 * Mensajes pensados para publicación (sin jerga del motor).
 * No usa `compatibilityWarnings` del VM (metadatos avanzados no generan avisos intrusivos en L1).
 */
export function validationIssueToPublishMessage(vm: ConversationViewModel, issue: ConversationValidationIssue): string {
  const st = stepDisplayTitle(vm, issue.stepInternalId);
  switch (issue.code) {
    case 'ENTRY_STEP_MISSING':
      return 'Falta definir correctamente el inicio de la conversación. Revisalo en la vista clásica antes de publicar.';
    case 'FALLBACK_STEP_MISSING':
      return 'Falta el paso de respaldo cuando ninguna opción coincide. Revisalo en la vista clásica antes de publicar.';
    case 'STEP_MESSAGE_EMPTY':
      return `El paso «${st}» no tiene el mensaje que verá el cliente.`;
    case 'STEP_NEEDS_RESPONSE':
      return `El paso «${st}» no tiene definido qué pasa cuando el cliente responde (por ejemplo, si no coincide con ninguna opción).`;
    case 'RESPONSE_EXACT_EMPTY':
      return `Hay una respuesta sin texto definido en el paso «${st}».`;
    case 'RESPONSE_ANYOF_EMPTY':
      return `Hay una respuesta sin opciones válidas en el paso «${st}».`;
    case 'RESPONSE_DESTINATION_MISSING':
      return `Hay una respuesta sin destino en el paso «${st}».`;
    case 'RESPONSE_DESTINATION_UNKNOWN':
      return `Hay una respuesta con un destino que ya no existe en el paso «${st}».`;
    case 'MULTIPLE_FALLBACK':
      return `El paso «${st}» tiene más de una opción «en cualquier otro caso». Dejá solo una.`;
    default:
      return issue.message;
  }
}

export function buildPublishWarnings(
  vm: ConversationViewModel,
  validationIssues: ConversationValidationIssue[],
  opts: { hasUnsavedChanges: boolean; isFirstPublish: boolean }
): { blocking: PublishWarningItem[]; nonBlocking: PublishWarningItem[] } {
  const blocking: PublishWarningItem[] = validationIssues.map((issue, idx) => ({
    id: `val-${issue.code}-${issue.stepInternalId}-${issue.responseUiId ?? idx}`,
    message: validationIssueToPublishMessage(vm, issue),
    severity: 'blocking' as const,
  }));

  const nonBlocking: PublishWarningItem[] = [];

  if (opts.hasUnsavedChanges) {
    nonBlocking.push({
      id: 'autosave',
      message: 'Al confirmar, primero se guardarán automáticamente los cambios pendientes del borrador.',
      severity: 'nonBlocking',
    });
  }

  if (opts.isFirstPublish) {
    nonBlocking.push({
      id: 'first-publish',
      message: 'Será la primera versión en vivo de esta conversación.',
      severity: 'nonBlocking',
    });
  }

  return { blocking, nonBlocking };
}
