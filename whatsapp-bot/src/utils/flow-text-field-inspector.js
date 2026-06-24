import { describeValueType } from './flow-field-validation.js';

const TEXT_FIELD_NAMES = ['text', 'message'];

function inspectScalarTextField(flowKey, version, nodeId, path, value, issues) {
  if (value == null) return;
  if (typeof value !== 'string') {
    issues.push({
      flowKey,
      version,
      nodeId,
      path,
      expectedType: 'string',
      actualType: describeValueType(value),
      value,
    });
  }
}

function inspectTransitionValue(flowKey, version, nodeId, path, type, value, issues) {
  if (value == null) return;
  if (type === 'matchAny') {
    if (!Array.isArray(value)) {
      issues.push({
        flowKey,
        version,
        nodeId,
        path,
        expectedType: 'array of strings',
        actualType: describeValueType(value),
        value,
      });
      return;
    }
    value.forEach((item, index) => {
      if (typeof item !== 'string') {
        issues.push({
          flowKey,
          version,
          nodeId,
          path: `${path}[${index}]`,
          expectedType: 'string',
          actualType: describeValueType(item),
          value: item,
        });
      }
    });
    return;
  }

  if (type === 'match' || type === 'matchIncludes') {
    inspectScalarTextField(flowKey, version, nodeId, path, value, issues);
  }
}

/**
 * Read-only scan for text/message/value fields that are not strings where required.
 * @param {object} flow
 * @param {{ flowKey?: string, version?: string }} [meta]
 */
export function inspectFlowTextFields(flow, meta = {}) {
  const flowKey = meta.flowKey || flow?.id || 'unknown';
  const version = meta.version || flow?.version;
  /** @type {Array<object>} */
  const issues = [];

  if (!flow || !Array.isArray(flow.nodes)) {
    issues.push({
      flowKey,
      version,
      path: 'nodes',
      expectedType: 'array',
      actualType: describeValueType(flow?.nodes),
      value: flow?.nodes,
    });
    return issues;
  }

  for (const node of flow.nodes) {
    const nodeId = node?.id || 'unknown';
    inspectScalarTextField(flowKey, version, nodeId, `nodes.${nodeId}.message`, node.message, issues);

    for (const fieldName of TEXT_FIELD_NAMES) {
      if (fieldName === 'message') continue;
      if (Object.prototype.hasOwnProperty.call(node, fieldName)) {
        inspectScalarTextField(
          flowKey,
          version,
          nodeId,
          `nodes.${nodeId}.${fieldName}`,
          node[fieldName],
          issues,
        );
      }
    }

    const transitions = Array.isArray(node.transitions) ? node.transitions : [];
    transitions.forEach((transition, index) => {
      const basePath = `nodes.${nodeId}.transitions[${index}]`;
      for (const fieldName of TEXT_FIELD_NAMES) {
        if (Object.prototype.hasOwnProperty.call(transition, fieldName)) {
          inspectScalarTextField(
            flowKey,
            version,
            nodeId,
            `${basePath}.${fieldName}`,
            transition[fieldName],
            issues,
          );
        }
      }
      if (transition?.value !== undefined) {
        inspectTransitionValue(
          flowKey,
          version,
          nodeId,
          `${basePath}.value`,
          transition.type,
          transition.value,
          issues,
        );
      }
    });
  }

  return issues;
}

export function formatFlowTextFieldIssue(issue) {
  const versionPart = issue.version ? ` ${issue.version}` : '';
  const nodePart = issue.nodeId ? ` (node ${issue.nodeId})` : '';
  return `Invalid flow ${issue.flowKey}${versionPart}: field ${issue.path} must be a ${issue.expectedType}, received ${issue.actualType}${nodePart}`;
}
