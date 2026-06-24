/**
 * Helpers for flow field type validation and error reporting.
 */

export class FlowFieldValidationError extends Error {
  /**
   * @param {object} params
   * @param {string} params.flowKey
   * @param {string} [params.version]
   * @param {string} [params.nodeId]
   * @param {string} params.path
   * @param {string} params.expectedType
   * @param {unknown} params.value
   */
  constructor({ flowKey, version, nodeId, path, expectedType, value }) {
    const versionPart = version ? ` ${version}` : '';
    const nodePart = nodeId ? ` (node ${nodeId})` : '';
    const actualType = describeValueType(value);
    super(
      `Invalid flow ${flowKey}${versionPart}: field ${path} must be a ${expectedType}, received ${actualType}${nodePart}`,
    );
    this.name = 'FlowFieldValidationError';
    this.flowKey = flowKey;
    this.version = version;
    this.nodeId = nodeId;
    this.path = path;
    this.expectedType = expectedType;
    this.actualType = actualType;
    this.value = value;
  }
}

/** @param {unknown} value */
export function describeValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * @param {unknown} value
 * @param {object} ctx
 */
export function assertStringField(value, ctx) {
  if (typeof value === 'string') return value;
  throw new FlowFieldValidationError({ ...ctx, expectedType: 'string', value });
}

/**
 * @param {unknown} value
 * @param {object} ctx
 */
export function assertStringArrayField(value, ctx) {
  if (!Array.isArray(value)) {
    throw new FlowFieldValidationError({ ...ctx, expectedType: 'array of strings', value });
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
  return value;
}
