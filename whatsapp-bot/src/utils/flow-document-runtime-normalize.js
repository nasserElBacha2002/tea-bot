import { coerceTransitionValueForDocument } from './flow-transition-value.js';

/**
 * Normalizes a published flow document for runtime loading.
 * Coerces legacy numeric/boolean transition values to strings without mutating DB history.
 */
export function normalizeFlowDocumentForRuntime(flow) {
  if (!flow || !Array.isArray(flow.nodes)) return flow;

  const flowKey = flow.id || 'unknown';
  const version = flow.version;

  const nodes = flow.nodes.map((node) => {
    if (!node || !Array.isArray(node.transitions)) return node;

    const transitions = node.transitions.map((transition, index) => {
      if (!transition || transition.value === undefined) return transition;
      const coerced = coerceTransitionValueForDocument(transition.value, {
        flowKey,
        version,
        nodeId: node.id,
        path: `nodes.${node.id}.transitions[${index}].value`,
      });
      if (coerced === transition.value) return transition;
      return { ...transition, value: coerced };
    });

    return transitions === node.transitions ? node : { ...node, transitions };
  });

  const changed = nodes.some((node, index) => node !== flow.nodes[index]);
  return changed ? { ...flow, nodes } : flow;
}
