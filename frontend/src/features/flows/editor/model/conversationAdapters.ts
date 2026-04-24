import type { Flow, FlowNode, FlowTransition } from '../../types/flow.types';
import type {
  ConversationResponse,
  ConversationStep,
  ConversationViewModel,
} from './conversationViewModel';
import { createResponseUiId } from './conversationViewModel';

export function humanizeNodeId(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim() || 'Paso';
}

function sortTransitionIndex(a: FlowTransition, b: FlowTransition, ai: number, bi: number): number {
  const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
  const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
  if (pa !== pb) return pa - pb;
  return ai - bi;
}

function mapTransitionToResponse(
  t: FlowTransition,
  stepInternalId: string,
  index: number
): { response: ConversationResponse | null; preserved: boolean } {
  const next = t.nextNode;
  if (!next) return { response: null, preserved: false };

  const uiId = createResponseUiId(stepInternalId, index);
  const displayOrder = index;
  const enginePriority = t.priority;

  if (t.type === 'match' && typeof t.value === 'string') {
    return {
      response: {
        uiId,
        kind: 'exact',
        values: [t.value],
        destinationStepId: next,
        displayOrder,
        enginePriority,
      },
      preserved: false,
    };
  }

  if (t.type === 'matchAny' && Array.isArray(t.value)) {
    return {
      response: {
        uiId,
        kind: 'anyOf',
        values: t.value.map(v => String(v)),
        destinationStepId: next,
        displayOrder,
        enginePriority,
      },
      preserved: false,
    };
  }

  if (t.type === 'default' || (t as FlowTransition & { default?: boolean }).default === true) {
    return {
      response: {
        uiId,
        kind: 'fallback',
        values: [],
        destinationStepId: next,
        displayOrder,
        enginePriority,
      },
      preserved: false,
    };
  }

  return { response: null, preserved: true };
}

function nodeToStep(node: FlowNode, nodeIndex: number): ConversationStep {
  const transitions = [...(node.transitions ?? [])];
  const indexed = transitions.map((t, i) => ({ t, i }));
  indexed.sort((a, b) => sortTransitionIndex(a.t, b.t, a.i, b.i));

  const responses: ConversationResponse[] = [];
  const preserved: FlowTransition[] = [];

  indexed.forEach(({ t }, order) => {
    const { response, preserved: pres } = mapTransitionToResponse(t, node.id, order);
    if (response) responses.push(response);
    else if (pres) {
      preserved.push(t);
    }
  });

  const hasTransitions = (node.transitions?.length ?? 0) > 0;
  const meta: ConversationStep['metadata'] = {
    nodeType: node.type,
    variableName: node.variableName,
    position: node.ui?.position ?? { x: 80 + (nodeIndex % 3) * 280, y: 80 + Math.floor(nodeIndex / 3) * 180 },
    collapsed: node.ui?.collapsed,
    layoutHint: node.ui?.layoutHint,
    preservedTransitions: preserved.length ? preserved : undefined,
  };

  if (node.type === 'redirect' && node.nextNode) {
    meta.parallelNextNode = node.nextNode;
  } else if (node.type === 'message' && node.nextNode && !hasTransitions) {
    meta.messageAutoAdvanceNextNode = node.nextNode;
  } else if (node.nextNode && hasTransitions) {
    meta.parallelNextNode = node.nextNode;
  }

  return {
    uiId: node.id,
    internalId: node.id,
    title: node.ui?.stepTitle?.trim() || humanizeNodeId(node.id),
    message: node.message ?? '',
    responses,
    metadata: meta,
  };
}

/**
 * Convierte el DTO técnico del backend al modelo de la UI de conversación.
 */
export function flowToConversationViewModel(flow: Flow): ConversationViewModel {
  const steps = flow.nodes.map((n, i) => nodeToStep(n, i));
  return {
    flowId: flow.id,
    flowName: flow.name,
    description: flow.description,
    version: flow.version,
    status: flow.status,
    entryStepId: flow.entryNode,
    fallbackStepId: flow.fallbackNode,
    steps,
    /** Reservado para futuras vistas avanzadas; el editor simple no muestra avisos aquí. */
    compatibilityWarnings: [],
  };
}

function sortResponsesForSerialize(responses: ConversationResponse[]): ConversationResponse[] {
  return [...responses].sort((a, b) => {
    const pa = a.enginePriority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.enginePriority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.displayOrder - b.displayOrder;
  });
}

function responseToTransition(r: ConversationResponse): FlowTransition {
  const prio = r.enginePriority !== undefined ? { priority: r.enginePriority } : {};
  if (r.kind === 'exact') {
    return { type: 'match', value: r.values[0] ?? '', nextNode: r.destinationStepId, ...prio };
  }
  if (r.kind === 'anyOf') {
    return {
      type: 'matchAny',
      value: r.values.length ? r.values : [],
      nextNode: r.destinationStepId,
      ...prio,
    };
  }
  return { type: 'default', nextNode: r.destinationStepId, ...prio };
}

/**
 * Serializa el modelo de conversación al DTO técnico.
 * `base` permite conservar campos de nivel flow no editados en el VM.
 */
function stepToFlowNode(step: ConversationStep): FlowNode {
  const sorted = sortResponsesForSerialize(step.responses);
  const fromRows: FlowTransition[] = sorted.map(responseToTransition);
  const preserved = step.metadata.preservedTransitions ?? [];
  const transitions = [...fromRows, ...preserved];

  const node: FlowNode = {
    id: step.internalId,
    type: step.metadata.nodeType,
    message: step.message || undefined,
    variableName: step.metadata.variableName,
    ui: {
      position: step.metadata.position,
      collapsed: step.metadata.collapsed,
      layoutHint: step.metadata.layoutHint,
      stepTitle: step.title !== humanizeNodeId(step.internalId) ? step.title : undefined,
    },
  };

  if (transitions.length > 0) {
    node.transitions = transitions;
  }

  const { nodeType, messageAutoAdvanceNextNode, parallelNextNode } = step.metadata;

  if (nodeType === 'redirect') {
    const dest =
      sorted[0]?.destinationStepId ||
      preserved.find(t => t.nextNode)?.nextNode ||
      parallelNextNode ||
      messageAutoAdvanceNextNode;
    if (dest) node.nextNode = dest;
    return node;
  }

  if (nodeType === 'message') {
    if (transitions.length === 0 && messageAutoAdvanceNextNode) {
      node.nextNode = messageAutoAdvanceNextNode;
    } else if (parallelNextNode) {
      node.nextNode = parallelNextNode;
    }
    return node;
  }

  if (nodeType === 'capture') {
    if (parallelNextNode) node.nextNode = parallelNextNode;
    return node;
  }

  if (parallelNextNode) node.nextNode = parallelNextNode;
  return node;
}

export function conversationViewModelToFlow(
  vm: ConversationViewModel,
  base?: Flow
): Flow {
  const nodes: FlowNode[] = vm.steps.map(stepToFlowNode);

  return {
    id: vm.flowId,
    name: vm.flowName,
    description: vm.description ?? base?.description,
    version: vm.version,
    status: vm.status,
    entryNode: vm.entryStepId,
    fallbackNode: vm.fallbackStepId,
    nodes,
    updatedAt: base?.updatedAt,
    publishedAt: base?.publishedAt,
  };
}

/**
 * Igualdad aproximada para tests: compara campos relevantes del flujo técnico.
 */
export function flowsEqualForRoundTrip(a: Flow, b: Flow): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.entryNode !== b.entryNode ||
    a.fallbackNode !== b.fallbackNode ||
    a.nodes.length !== b.nodes.length
  ) {
    return false;
  }
  const byId = new Map(b.nodes.map(n => [n.id, n]));
  for (const na of a.nodes) {
    const nb = byId.get(na.id);
    if (!nb) return false;
    if (na.type !== nb.type) return false;
    if ((na.message ?? '') !== (nb.message ?? '')) return false;
    if ((na.variableName ?? '') !== (nb.variableName ?? '')) return false;
    if ((na.nextNode ?? '') !== (nb.nextNode ?? '')) return false;
    const ta = JSON.stringify(na.transitions ?? []);
    const tb = JSON.stringify(nb.transitions ?? []);
    if (ta !== tb) return false;
    const ua = JSON.stringify({
      p: na.ui?.position,
      c: na.ui?.collapsed,
      l: na.ui?.layoutHint,
      s: na.ui?.stepTitle,
    });
    const ub = JSON.stringify({
      p: nb.ui?.position,
      c: nb.ui?.collapsed,
      l: nb.ui?.layoutHint,
      s: nb.ui?.stepTitle,
    });
    if (ua !== ub) return false;
  }
  return true;
}

