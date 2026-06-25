import { FlowFieldValidationError } from './flow-field-validation.js';

/**
 * @param {string | undefined} type
 */
export function transitionTypeRequiresValue(type) {
  return type === 'match' || type === 'matchIncludes' || type === 'matchAny';
}

/**
 * @param {Error} err
 * @param {object} ctx
 * @param {string} [ctx.nodeKey]
 * @param {string} [ctx.transitionType]
 * @param {number | null} [ctx.priority]
 * @param {number | null} [ctx.transitionIndex]
 */
export function toFlowValidationErrorDetail(err, ctx = {}) {
  const { nodeKey, transitionType, priority, transitionIndex } = ctx;

  if (err instanceof FlowFieldValidationError) {
    const field = err.path.split('.').pop() || 'value';
    const priorityPart =
      priority != null
        ? `, transition priority ${priority}`
        : transitionIndex != null
          ? `, transition index ${transitionIndex}`
          : '';
    const typePart = transitionType ? ` for transition type \`${transitionType}\`` : '';
    const humanMessage = `Node \`${nodeKey || err.nodeId || 'unknown'}\`${priorityPart}: \`${field}\` is required${typePart} (expected ${err.expectedType}, received ${err.actualType}).`;

    return {
      code: 'FLOW_TRANSITION_VALUE_INVALID',
      message: humanMessage,
      technicalMessage: err.message,
      nodeKey: nodeKey || err.nodeId || null,
      field,
      path: err.path,
      expectedType: err.expectedType,
      receivedType: err.actualType,
      receivedValue: err.value,
      transitionType: transitionType || null,
      priority: priority ?? null,
      transitionIndex: transitionIndex ?? null,
    };
  }

  return {
    code: 'FLOW_VALIDATION_ENGINE',
    message: err.message,
    nodeKey: nodeKey || null,
    transitionType: transitionType || null,
    priority: priority ?? null,
    transitionIndex: transitionIndex ?? null,
  };
}
