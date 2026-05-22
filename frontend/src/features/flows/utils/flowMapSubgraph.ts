import type { Flow, FlowNode, FlowTransition } from '../types/flow.types';

export type MapDepthOption = 1 | 2 | 3 | 'all';

export function resolveMapFocusNodeId(flow: Flow, selectedNodeId: string | null): string {
  if (selectedNodeId && flow.nodes.some((n) => n.id === selectedNodeId)) {
    return selectedNodeId;
  }
  if (flow.entryNode && flow.nodes.some((n) => n.id === flow.entryNode)) {
    return flow.entryNode;
  }
  return flow.nodes[0]?.id ?? '';
}

/** BFS: nodos hasta `depth` saltos desde el foco (inclusive). */
export function collectNodesWithinDepth(
  flow: Flow,
  startId: string,
  depth: MapDepthOption,
): Set<string> {
  if (!startId || depth === 'all') {
    return new Set(flow.nodes.map((n) => n.id));
  }

  const maxHops = depth;
  const adj = buildAdjacency(flow);
  const visited = new Set<string>();
  const queue: Array<{ id: string; hop: number }> = [{ id: startId, hop: 0 }];
  visited.add(startId);

  while (queue.length > 0) {
    const { id, hop } = queue.shift()!;
    if (hop >= maxHops) continue;
    for (const next of adj.get(id) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push({ id: next, hop: hop + 1 });
      }
    }
  }

  return visited;
}

function buildAdjacency(flow: Flow): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    if (!to) return;
    const list = adj.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    adj.set(from, list);
  };

  for (const node of flow.nodes) {
    if (!adj.has(node.id)) adj.set(node.id, []);
    for (const t of node.transitions ?? []) {
      add(node.id, t.nextNode);
    }
    if (node.nextNode) add(node.id, node.nextNode);
  }
  return adj;
}

export function filterFlowToNodes(flow: Flow, nodeIds: Set<string>): Flow {
  const nodes: FlowNode[] = flow.nodes
    .filter((n) => nodeIds.has(n.id))
    .map((n) => {
      const transitions = (n.transitions ?? []).filter((t) => nodeIds.has(t.nextNode));
      const nextNode = n.nextNode && nodeIds.has(n.nextNode) ? n.nextNode : undefined;
      return { ...n, transitions, nextNode };
    });

  return {
    ...flow,
    nodes,
    entryNode: nodeIds.has(flow.entryNode) ? flow.entryNode : nodes[0]?.id ?? flow.entryNode,
    fallbackNode:
      flow.fallbackNode && nodeIds.has(flow.fallbackNode) ? flow.fallbackNode : flow.fallbackNode,
  };
}

export function searchFlowNodes(
  flow: Flow,
  query: string,
): Array<{ id: string; title: string; snippet: string }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  return flow.nodes
    .map((node) => {
      const title = node.ui?.stepTitle?.trim() || node.id;
      const message = node.message ?? '';
      const haystack = `${node.id} ${title} ${message}`.toLowerCase();
      if (!haystack.includes(q)) return null;
      return {
        id: node.id,
        title,
        snippet: truncateText(message || node.type, 72),
      };
    })
    .filter((x): x is { id: string; title: string; snippet: string } => x !== null)
    .slice(0, 24);
}

export function truncateText(text: string, maxLen: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

export function summarizeOutgoingTransitions(
  transitions: FlowTransition[],
  targetNodeId: string,
): { shortLabel: string; tooltip: string } {
  if (transitions.length === 0) {
    return { shortLabel: `→ ${targetNodeId}`, tooltip: `→ ${targetNodeId}` };
  }
  if (transitions.length === 1) {
    const t = transitions[0]!;
    const value =
      t.value != null
        ? Array.isArray(t.value)
          ? t.value.join(', ')
          : String(t.value)
        : '';
    const short = value ? `${value} → ${targetNodeId}` : `→ ${targetNodeId}`;
    return { shortLabel: truncateText(short, 40), tooltip: short };
  }
  const parts = transitions.map((t) => {
    const v =
      t.value != null
        ? Array.isArray(t.value)
          ? t.value.join(', ')
          : String(t.value)
        : t.type ?? 'respuesta';
    return String(v);
  });
  return {
    shortLabel: `${transitions.length} respuestas → ${targetNodeId}`,
    tooltip: parts.join('\n'),
  };
}
