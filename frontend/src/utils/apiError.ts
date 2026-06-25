import axios from 'axios';

const ERROR_MESSAGES: Record<string, string> = {
  CONVERSATION_PERSISTENCE_UNAVAILABLE:
    'No se pudo cargar la bandeja de conversaciones. La persistencia de conversaciones no está disponible. Verificá que la base de datos esté levantada y que las migraciones estén aplicadas.',
  DB_CONNECTION_FAILED:
    'No se pudo conectar con la base de datos de conversaciones. Verificá que SQL Server esté levantado y que las migraciones hayan sido aplicadas.',
  DB_ENV_MISSING:
    'Falta configuración de la base de datos en el backend (variables DB_* o CONVERSATION_DB_ENABLED).',
  CONVERSATION_DB_DISABLED:
    'La persistencia de conversaciones está desactivada en el backend.',
  TWILIO_NOT_CONFIGURED:
    'Twilio no está configurado en el servidor. No se pueden enviar mensajes manuales.',
  TWILIO_SEND_FAILED:
    'No se pudo enviar el mensaje. Verificá la configuración de Twilio o intentá nuevamente.',
  CONVERSATION_CLOSED: 'No se puede responder una conversación cerrada.',
  CONVERSATION_BOT_ACTIVE:
    'El bot está activo. Para responder, primero tomá la conversación.',
  EMPTY_BODY: 'Escribí un mensaje antes de enviar.',
  REQUEST_FAILED: 'No se pudo completar la solicitud. Intentá nuevamente.',
  UNKNOWN_ERROR: 'Ocurrió un error inesperado. Intentá nuevamente.',
  FLOW_NOT_FOUND: 'Flujo no encontrado.',
  FLOW_VERSION_NOT_FOUND: 'Versión de flujo no encontrada.',
  FLOW_DRAFT_ALREADY_EXISTS:
    'Ya existe un borrador activo para este flujo. Publicalo o descartalo antes de crear otro.',
  FLOW_VERSION_NOT_DRAFT: 'Solo se pueden editar versiones en estado borrador.',
  FLOW_PUBLISH_VALIDATION_FAILED:
    'No se puede publicar el borrador porque tiene errores de validación.',
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

export interface FlowValidationErrorDetail {
  code: string;
  message: string;
  nodeKey?: string | null;
  field?: string;
  path?: string;
  expectedType?: string;
  receivedType?: string;
  receivedValue?: unknown;
  transitionType?: string | null;
  priority?: number | null;
  transitionIndex?: number | null;
}

export interface FlowValidationDetails {
  valid?: boolean;
  errors?: FlowValidationErrorDetail[];
  warnings?: FlowValidationErrorDetail[];
}

type ApiErrorBody = {
  error?: string;
  message?: string;
  details?: FlowValidationDetails & { cause?: string };
};

export function mapApiErrorCode(code: string | undefined, fallback?: string): string {
  if (!code) return fallback || ERROR_MESSAGES.UNKNOWN_ERROR;
  return ERROR_MESSAGES[code] || fallback || code;
}

export function formatFlowValidationErrors(details?: FlowValidationDetails): string | null {
  const errors = details?.errors;
  if (!errors?.length) return null;
  const lines = errors.map(e => e.message).filter(Boolean);
  return lines.length ? lines.join('\n') : null;
}

export function extractApiError(error: unknown): {
  code: string;
  message: string;
  status?: number;
  details?: FlowValidationDetails;
} {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as ApiErrorBody | undefined;
    const code =
      data?.error
      || data?.details?.cause
      || (status === 503 ? 'CONVERSATION_PERSISTENCE_UNAVAILABLE' : 'REQUEST_FAILED');
    const validationLines = formatFlowValidationErrors(data?.details);
    const message =
      validationLines
      || data?.message
      || mapApiErrorCode(code, typeof data?.error === 'string' ? data.error : undefined);
    return { code, message, status, details: data?.details };
  }
  if (error instanceof Error) {
    return { code: 'UNKNOWN_ERROR', message: error.message };
  }
  return { code: 'UNKNOWN_ERROR', message: ERROR_MESSAGES.UNKNOWN_ERROR };
}

export function toUserFacingError(error: unknown): Error {
  const { message } = extractApiError(error);
  return new Error(message);
}
