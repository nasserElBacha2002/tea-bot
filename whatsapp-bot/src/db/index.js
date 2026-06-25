import sql from 'mssql';
import {
  isConversationDbEnabled,
  buildMssqlConfig,
  validateSqlServerEnv,
} from './connection-config.js';

export { isConversationDbEnabled, validateSqlServerEnv, getSqlServerEnv } from './connection-config.js';

/** @type {import('mssql').ConnectionPool | null} */
let pool = null;

export async function getPool() {
  if (!isConversationDbEnabled()) return null;
  if (pool) return pool;

  pool = await new sql.ConnectionPool(buildMssqlConfig()).connect();
  pool.on('error', (err) => {
    console.error('[DB] Unexpected pool error:', err.message);
  });

  return pool;
}

/**
 * Replaces $1…$N placeholders with @p0…@p(N-1).
 * Highest indices first so $1 does not corrupt $10, $11, etc.
 */
export function applyQueryPlaceholders(text, paramCount) {
  let sqlText = text;
  for (let index = paramCount - 1; index >= 0; index -= 1) {
    const key = `p${index}`;
    sqlText = sqlText.split(`$${index + 1}`).join(`@${key}`);
  }
  return sqlText;
}

/**
 * Ejecuta SQL con placeholders $1, $2… (se mapean a @p0, @p1 para mssql).
 * @returns {Promise<{ rows: object[] }>}
 */
export async function query(text, params = [], { transaction } = {}) {
  const p = await getPool();
  if (!p) {
    throw new Error('Database pool is not available');
  }

  const request = transaction ? new sql.Request(transaction) : p.request();

  params.forEach((value, index) => {
    request.input(`p${index}`, value);
  });

  const sqlText = applyQueryPlaceholders(text, params.length);
  const result = await request.query(sqlText);
  return { rows: result.recordset ?? [] };
}

/**
 * Ejecuta fn dentro de una transacción SQL Server.
 * @param {(transaction: import('mssql').Transaction) => Promise<T>} fn
 */
export async function withTransaction(fn) {
  const p = await getPool();
  if (!p) throw new Error('Database pool is not available');
  const transaction = new sql.Transaction(p);
  await transaction.begin();
  try {
    const result = await fn(transaction);
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore rollback errors */
    }
    throw err;
  }
}

export async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
  }
}

export async function pingDatabase() {
  if (!isConversationDbEnabled()) return { ok: false, reason: 'disabled' };
  const result = await query('SELECT 1 AS ok');
  return { ok: result.rows[0]?.ok === 1 };
}

export function parseJsonColumn(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    // Legacy rows may store plain scalars (e.g. transition match values) without JSON quotes.
    return value;
  }
}
