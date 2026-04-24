import type { Node, Edge } from '@xyflow/react';
import type { Flow, FlowTransition, FlowTransitionType, GraphEdgeSelection } from '../types/flow.types';
import { getNodeIssues } from './flowGraph.validation';
import { UI_TRANSITION_TYPE } from './flowUiLabels';

export const NODE_TYPE_COLORS: Record<string, string> = {
  message: '#2563eb',
  capture: '#7c3aed',
  redirect: '#d97706',
  end: '#dc2626',
};

export const NODE_TYPE_BG: Record<string, string> = {
  message: '#eff6ff',
  capture: '#f5f3ff',
  redirect: '#fffbeb',
  end: '#fef2f2',
};

export interface FlowToGraphOptions {
  selectedEdgeId?: string | null;
  simulatorNodeId?: string | null;
}

export function selectionToEdgeId(sel: GraphEdgeSelection | null, flow: Flow): string | null {
  if (!sel) return null;
  if (sel.kind === 'direct') {
    const n = flow.nodes.find(x => x.id === sel.sourceNodeId);
    if (!n?.nextNode) return null;
    return `${sel.sourceNodeId}->${n.nextNode}-direct`;
  }
  const n = flow.nodes.find(x => x.id === sel.sourceNodeId);
  const t = n?.transitions?.[sel.transitionIndex];
  if (!t?.nextNode) return null;
  return `${sel.sourceNodeId}->${t.nextNode}-t${sel.transitionIndex}`;
}

export function parseEdgeId(edgeId: string): GraphEdgeSelection | null {
  const direct = /^(.+)->(.+)-direct$/.exec(edgeId);
  if (direct) return { kind: 'direct', sourceNodeId: direct[1] };
  const tr = /^(.+)->(.+)-t(\d+)$/.exec(edgeId);
  if (tr) {
    return {
      kind: 'transition',
      sourceNodeId: tr[1],
      transitionIndex: parseInt(tr[3], 10),
    };
  }
  return null;
}

function transitionPairCounts(flow: Flow): Map<string, number> {
  const m = new Map<string, number>();
  for (const node of flow.nodes) {
    for (const t of node.transitions ?? []) {
      const k = `${node.id}:::${t.nextNode}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}

/** Maps a Flow to React Flow nodes and edges */
export function flowToGraph(flow: Flow, opts: FlowToGraphOptions = {}): { nodes: Node[]; edges: Edge[] } {
  const { selectedEdgeId = null, simulatorNodeId = null } = opts;
  const pairCount = transitionPairCounts(flow);
  const pairIndex = new Map<string, number>();

  const nodes: Node[] = flow.nodes.map((node, idx) => {
    const defaultPosition = getDefaultPosition(idx);
    const issues = getNodeIssues(flow, node);
    return {
      id: node.id,
      type: 'flowNode',
      position: node.ui?.position ?? defaultPosition,
      data: {
        node,
        isEntry: node.id === flow.entryNode,
        isFallback: node.id === flow.fallbackNode,
        issues,
        simActive: Boolean(simulatorNodeId && node.id === simulatorNodeId),
      },
    };
  });

  const edges: Edge[] = [];

  for (const node of flow.nodes) {
    if (node.transitions) {
      for (let i = 0; i < node.transitions.length; i++) {
        const t = node.transitions[i];
        const isPlaceholder = !t.type;
        const k = `${node.id}:::${t.nextNode}`;
        const idx = pairIndex.get(k) ?? 0;
        pairIndex.set(k, idx + 1);
        const total = pairCount.get(k) ?? 1;
        const parallelSuffix = total > 1 ? ` · ${idx + 1}/${total}` : '';

        const edgeId = `${node.id}->${t.nextNode}-t${i}`;
        const selected = edgeId === selectedEdgeId;

        edges.push({
          id: edgeId,
          source: node.id,
          target: t.nextNode,
          label: `${getTransitionLabel(t)}${parallelSuffix}`,
          style: {
            stroke: selected ? '#1d4ed8' : isPlaceholder ? '#d97706' : '#64748b',
            strokeWidth: selected ? 3 : total > 1 ? 2 : 1.5,
            strokeDasharray: isPlaceholder ? '6 4' : undefined,
          },
          labelStyle: {
            fontSize: 11,
            fill: selected ? '#1e40af' : '#334155',
            fontWeight: selected ? 700 : 500,
          },
          type: 'smoothstep',
          animated: isPlaceholder,
          selected,
          data: { transitionIndex: i, sourceNodeId: node.id, isDirect: false },
          zIndex: selected ? 10 : total > 1 ? 2 : 1,
        });
      }
    }
    if (node.nextNode && (!node.transitions || node.transitions.length === 0)) {
      const edgeId = `${node.id}->${node.nextNode}-direct`;
      const selected = edgeId === selectedEdgeId;
      edges.push({
        id: edgeId,
        source: node.id,
        target: node.nextNode,
        label: 'siguiente',
        style: {
          stroke: selected ? '#1d4ed8' : '#94a3b8',
          strokeWidth: selected ? 3 : 1.5,
        },
        labelStyle: { fontSize: 11, fill: selected ? '#1e40af' : '#64748b', fontWeight: selected ? 700 : 500 },
        type: 'smoothstep',
        selected,
        data: { isDirect: true, sourceNodeId: node.id },
        zIndex: selected ? 10 : 0,
      });
    }
  }

  return { nodes, edges };
}

function getTransitionLabel(t: FlowTransition): string {
  if (!t.type) return '⚠ configurar';
  if (t.type === 'default') return 'por defecto';
  if (t.type === 'match') return `= «${t.value}»`;
  if (t.type === 'matchAny')
    return `∈ [${Array.isArray(t.value) ? t.value.slice(0, 2).join(', ') : ''}…]`;
  if (t.type === 'matchIncludes') return `~ «${t.value}»`;
  if (t.type && t.type in UI_TRANSITION_TYPE) return UI_TRANSITION_TYPE[t.type as FlowTransitionType];
  return String(t.type ?? '');
}

export function getDefaultPosition(index: number): { x: number; y: number } {
  const cols = 3;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: 80 + col * 320,
    y: 80 + row * 200,
  };
}

export function applyNodePositions(flow: Flow, rfNodes: Node[]): Flow {
  const posMap = new Map(rfNodes.map(n => [n.id, n.position]));
  return {
    ...flow,
    nodes: flow.nodes.map(node => ({
      ...node,
      ui: {
        ...node.ui,
        position: posMap.get(node.id) ?? node.ui?.position ?? getDefaultPosition(0),
      },
    })),
  };
}

