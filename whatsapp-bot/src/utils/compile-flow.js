import { normalizeGlobalCommandInput } from './global-commands.js';

function normalizeMessage(text) {
  return (text || '').trim().toLowerCase();
}

export function compileFlow(flow) {
  if (!flow || !Array.isArray(flow.nodes)) {
    throw new Error('No se puede compilar flujo: estructura inválida de nodes.');
  }

  const nodesById = new Map();
  const transitionsByNodeId = new Map();
  const exactMatchByNodeId = new Map();
  const includesRulesByNodeId = new Map();
  const defaultTransitionByNodeId = new Map();
  const duplicateNodeIds = [];
  const commandTransitionsByNodeId = new Map();
  const globalCommandEntryByType = new Map();

  let transitionCount = 0;
  let exactValueCount = 0;
  let includesRuleCount = 0;

  for (const node of flow.nodes) {
    if (nodesById.has(node.id)) {
      duplicateNodeIds.push(node.id);
    }
    nodesById.set(node.id, node);
  }

  for (const node of flow.nodes) {
    const transitions = Array.isArray(node.transitions) ? node.transitions : [];
    transitionsByNodeId.set(node.id, transitions);
    transitionCount += transitions.length;

    const exactMap = new Map();
    const includesRules = [];
    let defaultTransition = null;
    const commandTransitions = new Map();

    for (const transition of transitions) {
      const type = transition?.type;
      if (type === 'match') {
        const key = normalizeMessage(transition.value);
        if (key && !exactMap.has(key)) {
          exactMap.set(key, transition);
          exactValueCount += 1;
        }
        continue;
      }
      if (type === 'matchAny' && Array.isArray(transition.value)) {
        for (const rawValue of transition.value) {
          const key = normalizeMessage(rawValue);
          if (key && !exactMap.has(key)) {
            exactMap.set(key, transition);
            exactValueCount += 1;
          }
        }
        continue;
      }
      if (type === 'matchIncludes') {
        const needle = normalizeMessage(transition.value);
        if (needle) {
          includesRules.push({ needle, transition });
          includesRuleCount += 1;
        }
        continue;
      }
      if (type === 'default' || transition?.default === true) {
        if (!defaultTransition) defaultTransition = transition;
      }
    }

    // Detect legacy global command transitions for compatibility metadata
    for (const transition of transitions) {
      const values = Array.isArray(transition?.value) ? transition.value : [transition?.value];
      for (const value of values) {
        const normalized = normalizeGlobalCommandInput(value);
        if (!normalized) continue;
        if (normalized === 'menu' || normalized === 'inicio' || normalized === 'volver al menu') {
          if (!commandTransitions.has('menu')) commandTransitions.set('menu', transition);
        }
        if (normalized === 'atras' || normalized === 'volver atras') {
          if (!commandTransitions.has('back')) commandTransitions.set('back', transition);
        }
        if (normalized === 'humano' || normalized === 'persona' || normalized === 'asesor' || normalized === 'asesora' || normalized === 'representante') {
          if (!commandTransitions.has('human')) commandTransitions.set('human', transition);
        }
      }
    }

    exactMatchByNodeId.set(node.id, exactMap);
    includesRulesByNodeId.set(node.id, includesRules);
    if (defaultTransition) defaultTransitionByNodeId.set(node.id, defaultTransition);
    commandTransitionsByNodeId.set(node.id, commandTransitions);
  }

  const humanNodeIdCandidates = ['human_handoff', 'humano', 'asesor', 'representante'];
  for (const candidate of humanNodeIdCandidates) {
    if (nodesById.has(candidate)) {
      globalCommandEntryByType.set('human', candidate);
      break;
    }
  }

  return {
    rawFlow: flow,
    flowId: flow.id,
    version: flow.version,
    entryNodeId: flow.entryNode,
    fallbackNodeId: flow.fallbackNode,
    nodesById,
    transitionsByNodeId,
    exactMatchByNodeId,
    includesRulesByNodeId,
    defaultTransitionByNodeId,
    commandTransitionsByNodeId,
    globalCommandEntryByType,
    stats: {
      nodeCount: nodesById.size,
      transitionCount,
      exactValueCount,
      includesRuleCount,
      duplicateNodeIds,
    },
  };
}
