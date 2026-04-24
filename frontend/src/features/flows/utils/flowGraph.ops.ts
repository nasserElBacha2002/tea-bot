import type { Flow, FlowTransition } from '../types/flow.types';

export function appendTransitionToNode(
  flow: Flow,
  sourceNodeId: string,
  transition: FlowTransition
): Flow {
  return {
    ...flow,
    nodes: flow.nodes.map(n =>
      n.id === sourceNodeId
        ? { ...n, transitions: [...(n.transitions ?? []), transition] }
        : n
    ),
  };
}
