export const FLOW_ERROR_MESSAGES = {
  FLOW_NOT_FOUND: 'Flujo no encontrado.',
  FLOW_VERSION_NOT_FOUND: 'Versión de flujo no encontrada.',
  FLOW_DRAFT_ALREADY_EXISTS:
    'Ya existe un borrador activo para este flujo. Publicalo o descartalo antes de crear otro.',
  FLOW_VERSION_NOT_DRAFT: 'Solo se pueden editar versiones en estado borrador.',
  FLOW_PUBLISH_VALIDATION_FAILED:
    'No se puede publicar el borrador porque tiene errores de validación.',
  FLOW_VALIDATION_FAILED: 'El flujo tiene errores de validación.',
  FLOW_ENTRY_NODE_MISSING: 'El nodo de entrada no existe.',
  FLOW_FALLBACK_NODE_MISSING: 'El nodo fallback no existe.',
  FLOW_TRANSITION_TARGET_MISSING: 'Una transición apunta a un nodo que no existe.',
  FLOW_NODE_KEY_DUPLICATED: 'Ya existe un nodo con esa clave en la versión.',
  FLOW_NODE_REFERENCED_BY_TRANSITIONS:
    'El nodo está referenciado por transiciones. Eliminá las transiciones primero.',
  FLOW_SNAPSHOT_GENERATION_FAILED: 'No se pudo generar el snapshot del flujo.',
  FLOW_DB_UNAVAILABLE: 'No se pudo acceder a la base de datos de flujos.',
  FLOW_CANNOT_DELETE_ENTRY: 'No se puede eliminar el nodo de entrada.',
  FLOW_CANNOT_DELETE_FALLBACK: 'No se puede eliminar el nodo fallback.',
  FLOW_NODE_NOT_FOUND: 'Nodo no encontrado.',
  FLOW_TRANSITION_NOT_FOUND: 'Transición no encontrada.',
};

export function flowAppError(code, message, httpStatus = 400, details = undefined) {
  const err = new Error(message || FLOW_ERROR_MESSAGES[code] || code);
  err.code = code;
  err.httpStatus = httpStatus;
  err.apiError = code;
  err.apiMessage = err.message;
  if (details !== undefined) err.details = details;
  return err;
}
