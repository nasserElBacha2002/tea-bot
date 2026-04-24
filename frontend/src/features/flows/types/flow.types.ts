export type FlowNodeDataType = 'message' | 'capture' | 'redirect' | 'end';

export type FlowTransitionType = 'match' | 'matchAny' | 'matchIncludes' | 'default';

export interface FlowTransition {
  type?: FlowTransitionType;
  value?: string | string[];
  nextNode: string;
  /** Solo editor / documentación; el motor lo ignora. */
  priority?: number;
}

export interface FlowNode {
  id: string;
  type: FlowNodeDataType;
  message?: string;
  nextNode?: string;
  variableName?: string;
  transitions?: FlowTransition[];
  ui?: {
    position: { x: number; y: number };
    /** Metadata visual opcional; ignorada por runtime/backend operacional */
    collapsed?: boolean;
    layoutHint?: string;
    /** Título legible del paso en el editor de conversación (Nivel 1). */
    stepTitle?: string;
  };
}

/** Selección de arista en el canvas (transición o enlace next directo). */
export type GraphEdgeSelection =
  | { kind: 'transition'; sourceNodeId: string; transitionIndex: number }
  | { kind: 'direct'; sourceNodeId: string };

export interface Flow {
  id: string;
  name: string;
  description?: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  entryNode: string;
  fallbackNode: string;
  nodes: FlowNode[];
  updatedAt?: string;
  publishedAt?: string;
}

export interface FlowSummary {
  id: string;
  name: string;
  version: string;
  status: string;
  updatedAt: string;
}

export interface SimulatorSession {
  sessionId: string;
  flowId: string;
  currentNodeId: string;
  reply: string;
  variables: Record<string, unknown>;
}

export interface SimulatorResponse {
  sessionId: string;
  reply: string;
  flowId: string;
  currentNodeId: string;
  variables: Record<string, unknown>;
}

export interface PublishedVersionMeta {
  version: string;
  versionLabel: string;
  file: string;
  publishedAt: string;
  notes?: string;
  sourceDraftUpdatedAt?: string;
}

export interface PublishedVersionsSummary {
  flowId: string;
  activeVersion: string | null;
  lastPublishedAt?: string | null;
  updatedAt?: string | null;
  versions: PublishedVersionMeta[];
}

export interface PublishedVersionDetailResponse {
  version: string;
  publishedAt: string;
  isActive: boolean;
  activeVersion: string | null;
  flow: Flow;
}
