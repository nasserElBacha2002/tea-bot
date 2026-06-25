/**
 * Mirrors `whatsapp-bot/src/utils/flow-transition-value.js` for editor-side checks.
 */

import type { FlowTransition } from '../../types/flow.types';
import type { ConversationValidationIssue } from './conversationValidation';

function describeValueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function coerceTransitionValue(value: unknown): string | string[] | null | undefined {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return item;
      if (typeof item === 'number' || typeof item === 'boolean') return String(item);
      throw new Error('non-string array item');
    });
  }
  if (typeof value === 'object' && typeof (value as { text?: string }).text === 'string') {
    return (value as { text: string }).text;
  }
  throw new Error('non-coercible value');
}

function transitionRequiresValue(type: string | undefined): boolean {
  return type === 'match' || type === 'matchIncludes' || type === 'matchAny';
}

function validateCoercedTransitionValue(
  type: string | undefined,
  value: unknown,
  ctx: { nodeId: string; index: number; priority?: number }
): ConversationValidationIssue | null {
  const { nodeId, index, priority } = ctx;
  const priorityPart = priority != null ? `, prioridad ${priority}` : `, índice ${index}`;
  const responseUiId = `t-${index}`;

  if (!transitionRequiresValue(type)) return null;

  if (value === undefined || value === null || value === '') {
    return {
      code: 'PAYLOAD_TRANSITION_VALUE_REQUIRED',
      message: `El paso «${nodeId}»${priorityPart}: falta el valor para la respuesta tipo «${type}».`,
      stepInternalId: nodeId,
      responseUiId,
    };
  }

  let coerced: string | string[];
  try {
    coerced = coerceTransitionValue(value) as string | string[];
  } catch {
    return {
      code: 'PAYLOAD_TRANSITION_VALUE_INVALID',
      message: `El paso «${nodeId}»${priorityPart}: el valor debe ser texto (recibido ${describeValueType(value)}).`,
      stepInternalId: nodeId,
      responseUiId,
    };
  }

  if (type === 'matchAny') {
    if (!Array.isArray(coerced) || coerced.length === 0) {
      return {
        code: 'PAYLOAD_TRANSITION_VALUE_INVALID',
        message: `El paso «${nodeId}»${priorityPart}: «matchAny» requiere una lista no vacía de textos.`,
        stepInternalId: nodeId,
        responseUiId,
      };
    }
    return null;
  }

  if ((type === 'match' || type === 'matchIncludes') && typeof coerced !== 'string') {
    return {
      code: 'PAYLOAD_TRANSITION_VALUE_INVALID',
      message: `El paso «${nodeId}»${priorityPart}: el valor debe ser texto (recibido ${describeValueType(coerced)}).`,
      stepInternalId: nodeId,
      responseUiId,
    };
  }

  return null;
}

export function validateFlowTransitionValue(
  nodeId: string,
  trans: FlowTransition,
  index: number
): ConversationValidationIssue | null {
  return validateCoercedTransitionValue(trans.type, trans.value, {
    nodeId,
    index,
    priority: trans.priority,
  });
}

export function validateFlowTransitions(
  nodeId: string,
  transitions: FlowTransition[] | undefined
): ConversationValidationIssue[] {
  if (!transitions?.length) return [];
  const issues: ConversationValidationIssue[] = [];
  transitions.forEach((trans, index) => {
    const issue = validateFlowTransitionValue(nodeId, trans, index);
    if (issue) issues.push(issue);
  });
  return issues;
}
