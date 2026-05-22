export type FlowVersionStatus = 'draft' | 'published' | 'archived';

export interface FlowListItem {
  id: string;
  flowKey: string;
  name: string;
  description?: string | null;
  status: string;
  publishedVersion?: {
    id: string;
    versionNumber: number;
    versionLabel: string;
    publishedAt?: string;
  } | null;
  draftVersion?: {
    id: string;
    versionNumber: number;
    versionLabel: string;
    status: string;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FlowVersionSummary {
  id: string;
  flowId: string;
  versionNumber: number;
  versionLabel: string;
  status: FlowVersionStatus;
  entryNodeKey: string;
  fallbackNodeKey?: string | null;
  nodesCount: number;
  transitionsCount: number;
  publishedAt?: string | null;
  archivedAt?: string | null;
  createdAt?: string;
}

export interface FlowNodeRecord {
  id: string;
  flowVersionId: string;
  nodeKey: string;
  type: string;
  message?: string | null;
  title?: string | null;
  metadataJson?: Record<string, unknown> | null;
  positionX?: number | null;
  positionY?: number | null;
}

export interface FlowTransitionRecord {
  id: string;
  flowNodeId: string;
  type: string;
  value?: unknown;
  nextNodeKey: string;
  priority: number;
  sourceNodeKey?: string;
}

export interface FlowValidationIssue {
  code: string;
  message: string;
  nodeKey?: string;
  nextNodeKey?: string;
}

export interface FlowValidationResult {
  valid: boolean;
  errors: FlowValidationIssue[];
  warnings: FlowValidationIssue[];
}
