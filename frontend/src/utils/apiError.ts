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
};

export function mapApiErrorCode(code: string | undefined, fallback?: string): string {
  if (!code) return fallback || ERROR_MESSAGES.UNKNOWN_ERROR;
  return ERROR_MESSAGES[code] || fallback || code;
}

export function extractApiError(error: unknown): {
  code: string;
  message: string;
  status?: number;
} {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as
      | { error?: string; message?: string; details?: { cause?: string } }
      | undefined;
    const code =
      data?.error
      || data?.details?.cause
      || (status === 503 ? 'CONVERSATION_PERSISTENCE_UNAVAILABLE' : 'REQUEST_FAILED');
    const message =
      data?.message
      || mapApiErrorCode(code, typeof data?.error === 'string' ? data.error : undefined);
    return { code, message, status };
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
