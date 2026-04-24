import type { FlowNodeDataType, FlowTransition } from '../../types/flow.types';

/** Respuesta del cliente en la UI simple (sin exponer tipos del motor). */
export type ConversationResponseKind = 'exact' | 'anyOf' | 'fallback';

export interface ConversationResponse {
  uiId: string;
  kind: ConversationResponseKind;
  values: string[];
  /** id técnico del nodo destino (= FlowNode.id) */
  destinationStepId: string;
  displayOrder: number;
  /** Prioridad del motor al re-serializar (menor = antes). */
  enginePriority?: number;
}

export interface ConversationStepMetadata {
  nodeType: FlowNodeDataType;
  variableName?: string;
  /**
   * Mensaje con `nextNode` y sin transiciones: el motor avanza la sesión tras mostrar el mensaje.
   */
  messageAutoAdvanceNextNode?: string;
  /**
   * Transiciones que no se mapean a exact/anyOf/fallback (p. ej. matchIncludes).
   */
  preservedTransitions?: FlowTransition[];
  position: { x: number; y: number };
  collapsed?: boolean;
  layoutHint?: string;
  /**
   * `nextNode` en nodos donde también hay transiciones (caso raro; se preserva tal cual).
   */
  parallelNextNode?: string;
}

export interface ConversationStep {
  /** id estable para React; por defecto = internalId */
  uiId: string;
  /** FlowNode.id */
  internalId: string;
  title: string;
  message: string;
  responses: ConversationResponse[];
  metadata: ConversationStepMetadata;
}

export interface ConversationViewModel {
  flowId: string;
  flowName: string;
  description?: string;
  version: string;
  status: 'draft' | 'published' | 'archived';
  /** Flow.entryNode */
  entryStepId: string;
  /** Flow.fallbackNode */
  fallbackStepId: string;
  steps: ConversationStep[];
  /** Avisos no bloqueantes (p. ej. transiciones avanzadas preservadas). */
  compatibilityWarnings: string[];
}

export function createResponseUiId(stepInternalId: string, index: number): string {
  return `${stepInternalId}__r${index}`;
}
