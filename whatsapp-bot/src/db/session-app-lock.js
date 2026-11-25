import sql from 'mssql';
import { buildMssqlConfig, isConversationDbEnabled } from './connection-config.js';

export const RETENTION_SWEEP_LOCK_RESOURCE = 'tea_bot:conversation_retention';

/** @type {import('mssql').ConnectionPool | null} */
let dedicatedPool = null;
/** @type {import('mssql').Connection | null} */
let lockSession = null;
/** @type {string | null} */
let heldLockResource = null;

async function getDedicatedPool() {
  if (!dedicatedPool) {
    dedicatedPool = await new sql.ConnectionPool(buildMssqlConfig()).connect();
    dedicatedPool.on('error', (err) => {
      console.error('[DB] Session lock pool error:', err.message);
    });
  }
  return dedicatedPool;
}

async function getLockSession() {
  if (!lockSession) {
    const pool = await getDedicatedPool();
    lockSession = await pool.connect();
    lockSession.on('error', (err) => {
      console.error('[DB] Session lock connection error:', err.message);
      lockSession = null;
      heldLockResource = null;
    });
  }
  return lockSession;
}

/**
 * Exclusive applock at Session scope on one dedicated SQL session (same connection for release).
 *
 * @returns {Promise<{ acquired: boolean, returnCode?: number, reason?: string }>}
 */
export async function tryAcquireSessionAppLock(resource, timeoutMs = 0) {
  if (!isConversationDbEnabled()) {
    return { acquired: true, returnCode: 0, reason: 'db_disabled' };
  }
  if (heldLockResource && heldLockResource !== resource) {
    return { acquired: false, returnCode: -3, reason: 'local_lock_mismatch' };
  }
  const connection = await getLockSession();
  const request = connection.request();
  request.input('resource', sql.NVarChar(255), resource);
  request.input('timeout', sql.Int, Math.max(0, Number(timeoutMs) || 0));
  try {
    const result = await request.query(
      `DECLARE @r INT;
       EXEC @r = sp_getapplock
         @Resource = @resource,
         @LockMode = N'Exclusive',
         @LockOwner = N'Session',
         @LockTimeout = @timeout;
       SELECT @r AS return_code;`,
    );
    const returnCode = Number(result.recordset?.[0]?.return_code);
    if (!Number.isFinite(returnCode)) {
      return { acquired: false, returnCode: -999, reason: 'invalid_return' };
    }
    if (returnCode < 0) {
      return { acquired: false, returnCode, reason: returnCode === -1 ? 'timeout' : 'lock_error' };
    }
    heldLockResource = resource;
    return { acquired: true, returnCode };
  } catch (error) {
    lockSession = null;
    heldLockResource = null;
    return { acquired: false, returnCode: -999, reason: 'connection_error' };
  }
}

export async function releaseSessionAppLock(resource) {
  if (!lockSession) {
    heldLockResource = null;
    return;
  }
  try {
    const request = lockSession.request();
    request.input('resource', sql.NVarChar(255), resource);
    await request.query(
      `EXEC sp_releaseapplock @Resource = @resource, @LockOwner = N'Session';`,
    );
  } catch (error) {
    console.error(`[DB] releaseSessionAppLock failed: ${error.message}`);
  } finally {
    if (heldLockResource === resource) {
      heldLockResource = null;
    }
  }
}

export async function closeSessionAppLockPool() {
  try {
    if (heldLockResource) {
      await releaseSessionAppLock(heldLockResource);
    }
    if (lockSession) {
      await lockSession.close();
    }
    if (dedicatedPool) {
      await dedicatedPool.close();
    }
  } catch (error) {
    console.error(`[DB] closeSessionAppLockPool failed: ${error.message}`);
  } finally {
    lockSession = null;
    dedicatedPool = null;
    heldLockResource = null;
  }
}

export function resetSessionAppLockPoolForTests() {
  lockSession = null;
  dedicatedPool = null;
  heldLockResource = null;
}