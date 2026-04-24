import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
} from '@xyflow/react';
import type { NodeChange, EdgeChange, Connection, Node, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Box } from '@mui/material';
import type { Flow, FlowNodeDataType, FlowTransition, GraphEdgeSelection } from '../types/flow.types';
import {
  flowToGraph,
  applyNodePositions,
  selectionToEdgeId,
  parseEdgeId,
} from '../utils/flowGraph.mapper';
import { appendTransitionToNode } from '../utils/flowGraph.ops';
import { FlowGraphNode } from './FlowGraphNode';
import { FlowGraphToolbar } from './FlowGraphToolbar';
import {
  FlowConnectTransitionDialog,
  type PendingConnection,
} from './FlowConnectTransitionDialog';

const nodeTypes = { flowNode: FlowGraphNode };

function flowGraphSignature(flow: Flow): string {
  return JSON.stringify({
    id: flow.id,
    entryNode: flow.entryNode,
    fallbackNode: flow.fallbackNode,
    nodes: flow.nodes.map(n => ({
      id: n.id,
      type: n.type,
      message: n.message,
      nextNode: n.nextNode,
      variableName: n.variableName,
      transitions: n.transitions,
      ui: n.ui,
    })),
  });
}

interface FlowGraphCanvasProps {
  flow: Flow;
  selectedNodeId: string | null;
  selectedEdge: GraphEdgeSelection | null;
  /** Pass null to clear selection (e.g. pane click). */
  onNodeSelect: (nodeId: string | null) => void;
  onEdgeSelect: (sel: GraphEdgeSelection | null) => void;
  onFlowChange: (updatedFlow: Flow) => void;
  simulatorHighlightNodeId?: string | null;
  onQuickAddNode: (type: FlowNodeDataType) => void;
  onOrganizeLayout: () => void;
  /** Solo visualización: sin arrastre, conexiones ni cambios persistentes. */
  readOnly?: boolean;
}

export const FlowGraphCanvas: React.FC<FlowGraphCanvasProps> = ({
  flow,
  selectedNodeId,
  selectedEdge,
  onNodeSelect,
  onEdgeSelect,
  onFlowChange,
  simulatorHighlightNodeId = null,
  onQuickAddNode,
  onOrganizeLayout,
  readOnly = false,
}) => {
  const graphSignature = useMemo(() => flowGraphSignature(flow), [flow]);
  const selectedEdgeId = useMemo(
    () => selectionToEdgeId(selectedEdge, flow),
    [selectedEdge, flow]
  );

  const { nodes: derivedNodes, edges: derivedEdges } = useMemo(
    () =>
      flowToGraph(flow, {
        selectedEdgeId,
        simulatorNodeId: simulatorHighlightNodeId,
      }),
    // graphSignature ya refleja el contenido de `flow`
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graphSignature, selectedEdgeId, simulatorHighlightNodeId]
  );

  const [nodes, setNodes] = useNodesState(derivedNodes);
  const [edges, setEdges] = useEdgesState(derivedEdges);
  const [pendingConnect, setPendingConnect] = useState<PendingConnection | null>(null);
  const pendingConnectRef = useRef(pendingConnect);
  pendingConnectRef.current = pendingConnect;

  useEffect(() => {
    const { nodes: n, edges: e } = flowToGraph(flow, {
      selectedEdgeId,
      simulatorNodeId: simulatorHighlightNodeId,
    });
    setNodes(n);
    setEdges(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphSignature, selectedEdgeId, simulatorHighlightNodeId, setNodes, setEdges]);

  useEffect(() => {
    setNodes(prev =>
      prev.map(n => ({ ...n, selected: n.id === selectedNodeId }))
    );
  }, [selectedNodeId, setNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(prev => {
        const updated = applyNodeChanges(changes, prev);
        if (readOnly) return updated;
        const hasPositionChange = changes.some(
          c => c.type === 'position' && (c as { dragging?: boolean }).dragging === false
        );
        if (hasPositionChange) {
          const updatedFlow = applyNodePositions(flow, updated as Node[]);
          onFlowChange(updatedFlow);
        }
        return updated;
      });
    },
    [flow, onFlowChange, readOnly, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) {
        setEdges(prev => applyEdgeChanges(changes, prev));
        return;
      }
      setEdges(prev => {
        const updated = applyEdgeChanges(changes, prev);
        const removed = changes.filter(c => c.type === 'remove');
        if (removed.length > 0) {
          const removedIds = new Set(removed.map(c => (c as { id: string }).id));
          const updatedFlow: Flow = {
            ...flow,
            nodes: flow.nodes.map(node => {
              const filteredTransitions = (node.transitions ?? []).filter((_, idx) => {
                const edgeId = `${node.id}->${node.transitions?.[idx]?.nextNode}-t${idx}`;
                return !removedIds.has(edgeId);
              });
              const directEdgeId = `${node.id}->${node.nextNode}-direct`;
              return {
                ...node,
                transitions: filteredTransitions,
                nextNode: removedIds.has(directEdgeId) ? undefined : node.nextNode,
              };
            }),
          };
          onFlowChange(updatedFlow);
          onEdgeSelect(null);
        }
        return updated;
      });
    },
    [flow, onFlowChange, onEdgeSelect, readOnly, setEdges]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (readOnly) return;
      const { source, target } = params;
      if (!source || !target) return;
      setPendingConnect({ source, target });
    },
    [readOnly]
  );

  const handleConfirmConnect = useCallback(
    (t: FlowTransition) => {
      const p = pendingConnectRef.current;
      if (!p) return;
      const sourceNode = flow.nodes.find(n => n.id === p.source);
      const newIndex = sourceNode?.transitions?.length ?? 0;
      const next = appendTransitionToNode(flow, p.source, t);
      onFlowChange(next);
      onNodeSelect(null);
      onEdgeSelect({
        kind: 'transition',
        sourceNodeId: p.source,
        transitionIndex: newIndex,
      });
      setPendingConnect(null);
    },
    [flow, onFlowChange, onEdgeSelect, onNodeSelect]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onEdgeSelect(null);
      onNodeSelect(node.id);
    },
    [onNodeSelect, onEdgeSelect]
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const sel = parseEdgeId(edge.id);
      if (sel) {
        onEdgeSelect(sel);
        onNodeSelect(null);
      }
    },
    [onEdgeSelect, onNodeSelect]
  );

  const onPaneClick = useCallback(() => {
    onEdgeSelect(null);
    onNodeSelect(null);
  }, [onEdgeSelect, onNodeSelect]);

  const nodeIdList = useMemo(() => flow.nodes.map(n => n.id), [flow.nodes]);

  return (
    <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={readOnly ? undefined : onConnect}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.15}
        maxZoom={1.8}
        defaultEdgeOptions={{
          interactionWidth: 28,
        }}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        snapToGrid={false}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1.2} color="#cbd5e1" />
        <Controls showInteractive={false} aria-label="Controles del grafo" />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={3}
          maskColor="rgba(15, 23, 42, 0.12)"
          style={{ backgroundColor: '#f8fafc' }}
          nodeColor={node => {
            const d = node.data as { node?: { type?: string } };
            const colors: Record<string, string> = {
              message: '#2563eb',
              capture: '#7c3aed',
              redirect: '#d97706',
              end: '#dc2626',
            };
            return colors[d?.node?.type ?? ''] ?? '#94a3b8';
          }}
        />
        {!readOnly && (
          <FlowGraphToolbar
            selectedNodeId={selectedNodeId}
            onQuickAdd={onQuickAddNode}
            onOrganize={onOrganizeLayout}
          />
        )}
      </ReactFlow>

      <FlowConnectTransitionDialog
        open={!readOnly && Boolean(pendingConnect)}
        pending={pendingConnect}
        nodeIds={nodeIdList}
        onClose={() => setPendingConnect(null)}
        onConfirm={handleConfirmConnect}
      />
    </Box>
  );
};
