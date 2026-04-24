import type { FlowNodeDataType, FlowTransitionType } from '../types/flow.types';

/** Etiquetas en español para tipos de transición (valores JSON sin cambiar). */
export const UI_TRANSITION_TYPE: Record<FlowTransitionType, string> = {
  match: 'Coincidencia exacta',
  matchAny: 'Cualquiera de la lista',
  matchIncludes: 'Contiene texto',
  default: 'Por defecto',
};

/** Etiquetas en español para tipos de nodo. */
export const UI_NODE_TYPE: Record<FlowNodeDataType, string> = {
  message: 'Mensaje',
  capture: 'Captura',
  redirect: 'Redirección',
  end: 'Fin',
};

export const UI_FLOW_STATUS: Record<string, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

export function flowStatusLabel(status: string): string {
  return UI_FLOW_STATUS[status] ?? status;
}
