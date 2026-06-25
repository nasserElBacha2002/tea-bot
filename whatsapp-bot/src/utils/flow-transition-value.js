import { FlowFieldValidationError } from './flow-field-validation.js';
import { transitionTypeRequiresValue } from './flow-validation-errors.js';

/**
 * Safe coercion for values stored in DB/import paths.
 * Numbers and booleans become strings; objects with a string `text` use that field.
 * Other objects are rejected.
 *
 * @param {unknown} value
 * @param {{ path: string, flowKey?: string, version?: string, nodeId?: string }} ctx
 * @returns {string | string[] | null | undefined}
 */
export function coerceTransitionValueForDocument(value, ctx) {
  if (value == null) return value;

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const coerced = coerceTransitionValueForDocument(item, {
        ...ctx,
        path: `${ctx.path}[${index}]`,
      });
      if (typeof coerced !== 'string') {
        throw new FlowFieldValidationError({
          flowKey: ctx.flowKey || 'unknown',
          version: ctx.version,
          nodeId: ctx.nodeId,
          path: `${ctx.path}[${index}]`,
          expectedType: 'string',
          value: item,
        });
      }
      return coerced;
    });
  }

  if (typeof value === 'object' && typeof value.text === 'string') {
    return value.text;
  }

  throw new FlowFieldValidationError({
    flowKey: ctx.flowKey || 'unknown',
    version: ctx.version,
    nodeId: ctx.nodeId,
    path: ctx.path,
    expectedType: 'string',
    value,
  });
}

/**
 * @param {string | undefined} type
 * @param {unknown} value
 * @param {object} ctx
 */
export function validateTransitionValueForPublish(type, value, ctx) {
  if (!type || type === 'default' || type === 'implicit_next') return;
  if (value == null || value === '') {
    throw new FlowFieldValidationError({
      ...ctx,
      expectedType: type === 'matchAny' ? 'array of strings' : 'string',
      value,
    });
  }

  if (type === 'matchAny') {
    if (!Array.isArray(value)) {
      throw new FlowFieldValidationError({
        ...ctx,
        expectedType: 'array of strings',
        value,
      });
    }
    if (value.length === 0) {
      throw new FlowFieldValidationError({
        ...ctx,
        expectedType: 'non-empty array of strings',
        value,
      });
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string') {
        throw new FlowFieldValidationError({
          ...ctx,
          path: `${ctx.path}[${index}]`,
          expectedType: 'string',
          value: item,
        });
      }
    });
    return;
  }

  if (type === 'match' || type === 'matchIncludes') {
    if (typeof value !== 'string') {
      throw new FlowFieldValidationError({
        ...ctx,
        expectedType: 'string',
        value,
      });
    }
  }
}

/**
 * Coerces legacy DB/import values, then validates publish rules.
 * Mirrors `buildFlowDocumentFromTables` + `flowValidator` for transition values.
 *
 * @param {string | undefined} type
 * @param {unknown} rawValue
 * @param {object} ctx
 */
export function validateTransitionValueAtPublish(type, rawValue, ctx) {
  if (!transitionTypeRequiresValue(type)) return;

  if (rawValue === undefined || rawValue === null || rawValue === '') {
    validateTransitionValueForPublish(type, rawValue, ctx);
    return;
  }

  const coerced = coerceTransitionValueForDocument(rawValue, ctx);
  validateTransitionValueForPublish(type, coerced, ctx);
}
