/**
 * Configuración SQL Server desde variables de entorno (sin connection string en código).
 */
export function isConversationDbEnabled() {
  const explicit = String(process.env.CONVERSATION_DB_ENABLED || '').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(explicit)) {
    return false;
  }
  if (['1', 'true', 'yes', 'on'].includes(explicit)) {
    return true;
  }
  // Auto-habilitar si las variables SQL están completas (dev local sin flag explícito).
  return validateSqlServerEnv().ok;
}

export function getSqlServerEnv() {
  return {
    server: (process.env.DB_SERVER || '').trim(),
    port: Number(process.env.DB_PORT || 1433),
    database: (process.env.DB_NAME || 'tea_bot').trim(),
    user: (process.env.DB_USER || '').trim(),
    password: process.env.DB_PASSWORD || '',
    encrypt: ['1', 'true', 'yes', 'on'].includes(
      String(process.env.DB_ENCRYPT || '').trim().toLowerCase(),
    ),
    trustServerCertificate: !['0', 'false', 'no', 'off'].includes(
      String(process.env.DB_TRUST_SERVER_CERTIFICATE ?? 'true').trim().toLowerCase(),
    ),
    poolMax: Number(process.env.DATABASE_POOL_MAX || 10),
    connectTimeoutMs: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 15000),
    requestTimeoutMs: Number(process.env.DATABASE_REQUEST_TIMEOUT_MS || 30000),
  };
}

export function validateSqlServerEnv() {
  const env = getSqlServerEnv();
  const missing = [];
  if (!env.server) missing.push('DB_SERVER');
  if (!env.database) missing.push('DB_NAME');
  if (!env.user) missing.push('DB_USER');
  if (!env.password) missing.push('DB_PASSWORD');
  return { ok: missing.length === 0, missing, env };
}

/** @returns {import('mssql').config} */
export function buildMssqlConfig() {
  const { ok, missing, env } = validateSqlServerEnv();
  if (!ok) {
    throw new Error(
      `Faltan variables de SQL Server: ${missing.join(', ')}`,
    );
  }

  return {
    server: env.server,
    port: env.port,
    database: env.database,
    user: env.user,
    password: env.password,
    options: {
      encrypt: env.encrypt,
      trustServerCertificate: env.trustServerCertificate,
      enableArithAbort: true,
    },
    pool: {
      max: env.poolMax,
      min: 0,
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS || 30000),
    },
    connectionTimeout: env.connectTimeoutMs,
    requestTimeout: env.requestTimeoutMs,
  };
}
