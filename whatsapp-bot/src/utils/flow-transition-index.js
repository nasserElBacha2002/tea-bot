import { includesAsTokens, transitionMatchKey } from './flow-match-text.js';
import { indexEnumeratedLabels } from './flow-menu-options.js';

const MIN_INCLUDE_LENGTH = 3;

function addExact(exact, ambiguousExact, key, transition) {
  if (!key) return;
  if (ambiguousExact.has(key)) return;
  const current = exact.get(key);
  if (!current) {
    exact.set(key, transition);
    return;
  }
  if (current.nextNode === transition.nextNode) return;
  exact.delete(key);
  ambiguousExact.add(key);
}

/**
 * Índice de matching de un nodo. La misma función la usan el compile y el motor.
 * @param {object} node
 * @param {{ strict?: boolean, flowKey?: string, version?: string }} [ctx]
 */
export function buildNodeTransitionIndex(node, ctx = {}) {
  const exact = new Map();
  const ambiguousExact = new Set();
  const includes = [];
  let defaultTransition = null;
  const transitions = Array.isArray(node?.transitions) ? node.transitions : [];
  const baseCtx = {
    strict: Boolean(ctx.strict),
    flowKey: ctx.flowKey,
    version: ctx.version,
    nodeId: node?.id,
  };

  for (const transition of transitions) {
    const type = transition?.type;
    if (type === 'match') {
      addExact(
        exact,
        ambiguousExact,
        transitionMatchKey(transition.value, {
          ...baseCtx,
          path: `nodes.${node?.id}.transitions[].value`,
        }),
        transition,
      );
      continue;
    }
    if (type === 'matchAny' && Array.isArray(transition.value)) {
      for (const rawValue of transition.value) {
        addExact(
          exact,
          ambiguousExact,
          transitionMatchKey(rawValue, {
            ...baseCtx,
            path: `nodes.${node?.id}.transitions[].value[]`,
          }),
          transition,
        );
      }
      continue;
    }
    if (type === 'matchIncludes') {
      const needle = transitionMatchKey(transition.value, {
        ...baseCtx,
        path: `nodes.${node?.id}.transitions[].value`,
      });
      if (needle.length >= MIN_INCLUDE_LENGTH) {
        includes.push({ needle, transition });
      }
      continue;
    }
    if (type === 'default' || transition?.default === true) {
      if (!defaultTransition) defaultTransition = transition;
    }
  }

  return {
    exact,
    ambiguousExact,
    includes,
    defaultTransition,
    enumerated: indexEnumeratedLabels(node, exact),
  };
}

/**
 * @param {object | null | undefined} node
 * @param {ReturnType<typeof buildNodeTransitionIndex> | null} index
 * @param {string} input texto ya normalizado
 * @param {string | null | undefined} fallbackNodeId
 */
export function resolveIndexedTransition(node, index, input, fallbackNodeId) {
  if (!node) {
    return {
      nextNodeId: fallbackNodeId,
      reason: 'node_missing',
      usedFallback: true,
      matchedTransition: null,
    };
  }
  if (!node.transitions || node.transitions.length === 0) {
    return {
      nextNodeId: node.nextNode || fallbackNodeId,
      reason: node.nextNode ? 'node_next' : 'fallback',
      usedFallback: !node.nextNode,
      matchedTransition: null,
    };
  }

  if (index.ambiguousExact.has(input)) {
    return stay(node, 'ambiguous_exact');
  }
  const exact = index.exact.get(input);
  if (exact) {
    const reason = exact.type === 'matchAny' ? 'matchAny' : 'match';
    return {
      nextNodeId: exact.nextNode,
      reason,
      usedFallback: false,
      matchedTransition: exact,
    };
  }
  if (index.enumerated.ambiguousLabels.has(input)) {
    return stay(node, 'ambiguous_label');
  }
  const labeled = index.enumerated.byLabel.get(input);
  if (labeled) {
    return {
      nextNodeId: labeled.transition.nextNode,
      reason: 'enumerated_label',
      usedFallback: false,
      matchedTransition: labeled.transition,
    };
  }

  const includeHits = index.includes.filter((rule) => includesAsTokens(input, rule.needle));
  const destinations = new Set(includeHits.map((hit) => hit.transition.nextNode));
  if (destinations.size > 1) return stay(node, 'ambiguous_include');
  if (destinations.size === 1) {
    return {
      nextNodeId: includeHits[0].transition.nextNode,
      reason: 'matchIncludes',
      usedFallback: false,
      matchedTransition: includeHits[0].transition,
    };
  }

  if (index.defaultTransition) {
    return {
      nextNodeId: index.defaultTransition.nextNode,
      reason: 'default',
      usedFallback: false,
      matchedTransition: index.defaultTransition,
    };
  }

  return {
    nextNodeId: fallbackNodeId || node.id,
    reason: fallbackNodeId ? 'fallback' : 'stay_on_node',
    usedFallback: Boolean(fallbackNodeId),
    matchedTransition: null,
  };
}

function stay(node, reason) {
  return {
    nextNodeId: node.id,
    reason,
    usedFallback: false,
    matchedTransition: null,
  };
}
