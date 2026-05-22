import {
  isConversationDbEnabled,
  validateSqlServerEnv,
  pingDatabase,
} from './index.js';

const PERSISTENCE_MESSAGE =
  'No se pudo conectar con la base de datos de conversaciones. Verificá que SQL Server esté levantado y que las migraciones hayan sido aplicadas.';

export function createPersistenceError(code, cause, message = PERSISTENCE_MESSAGE) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = 503;
  err.apiError = code;
  err.apiMessage = message;
  err.details = { cause };
  return err;
}

/**
 * Verifica flag/env, configuración y conectividad antes de operaciones de inbox.
 */
export async function ensureConversationDbReady() {
  if (!isConversationDbEnabled()) {
    const explicitOff = ['0', 'false', 'no', 'off'].includes(
      String(process.env.CONVERSATION_DB_ENABLED || '').trim().toLowerCase(),
    );
    const { missing } = validateSqlServerEnv();
    const cause = explicitOff
      ? 'CONVERSATION_DB_DISABLED'
      : missing.length > 0
        ? 'DB_ENV_MISSING'
        : 'CONVERSATION_DB_DISABLED';
    const hint =
      cause === 'DB_ENV_MISSING'
        ? `Faltan variables: ${missing.join(', ')}. Configurá CONVERSATION_DB_ENABLED=true y las variables DB_* en .env.`
        : 'Activá CONVERSATION_DB_ENABLED=true o completá DB_SERVER, DB_USER, DB_PASSWORD y DB_NAME.';
    console.error(`[ConversationDB] Persistencia no disponible (${cause}). ${hint}`);
    throw createPersistenceError('CONVERSATION_PERSISTENCE_UNAVAILABLE', cause);
  }

  const { ok, missing } = validateSqlServerEnv();
  if (!ok) {
    console.error(
      `[ConversationDB] Variables SQL incompletas: ${missing.join(', ')}`,
    );
    throw createPersistenceError(
      'CONVERSATION_PERSISTENCE_UNAVAILABLE',
      'DB_ENV_MISSING',
    );
  }

  try {
    const ping = await pingDatabase();
    if (!ping.ok) {
      console.error(
        `[ConversationDB] Ping falló (reason=${ping.reason || 'unknown'})`,
      );
      throw createPersistenceError(
        'CONVERSATION_PERSISTENCE_UNAVAILABLE',
        'DB_CONNECTION_FAILED',
      );
    }
  } catch (error) {
    if (error.code === 'CONVERSATION_PERSISTENCE_UNAVAILABLE') {
      throw error;
    }
    console.error('[ConversationDB] Error de conexión:', error.message);
    throw createPersistenceError(
      'CONVERSATION_PERSISTENCE_UNAVAILABLE',
      'DB_CONNECTION_FAILED',
    );
  }

  return { ok: true };
}
