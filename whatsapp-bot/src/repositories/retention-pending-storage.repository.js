import { query } from '../db/index.js';
import { absoluteStoragePath, resolveInboundMediaRoot } from '../utils/inbound-media-storage.js';

function normalizeStorageKey(key) {
  const safe = String(key || '').replace(/[/\\]/g, '').trim();
  if (!safe || safe.length > 512) return null;
  return safe;
}

export async function enqueuePendingStorageDeletes(storageKeys, { transaction } = {}) {
  const keys = [...new Set((storageKeys || []).map(normalizeStorageKey).filter(Boolean))];
  if (keys.length === 0) return 0;
  let inserted = 0;
  for (const key of keys) {
    const { rows } = await query(
      `INSERT INTO dbo.retention_pending_storage_deletes (storage_key)
       SELECT $1
       WHERE NOT EXISTS (
         SELECT 1 FROM dbo.retention_pending_storage_deletes WHERE storage_key = $1
       );
       SELECT @@ROWCOUNT AS affected;`,
      [key],
      { transaction },
    );
    const affected = Number(rows?.[0]?.affected ?? 0);
    if (affected > 0) inserted += 1;
  }
  return inserted;
}

export async function listPendingStorageDeletes({ limit = 500, transaction } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const { rows } = await query(
    `SELECT TOP ($1) storage_key
     FROM dbo.retention_pending_storage_deletes
     ORDER BY enqueued_at ASC`,
    [safeLimit],
    { transaction },
  );
  return (rows || []).map((row) => row.storage_key).filter(Boolean);
}

export async function ackPendingStorageDelete(storageKey, { transaction } = {}) {
  const key = normalizeStorageKey(storageKey);
  if (!key) return;
  await query(
    `DELETE FROM dbo.retention_pending_storage_deletes WHERE storage_key = $1`,
    [key],
    { transaction },
  );
}

export async function countPendingStorageDeletes({ transaction } = {}) {
  const { rows } = await query(
    `SELECT COUNT(*) AS total FROM dbo.retention_pending_storage_deletes`,
    [],
    { transaction },
  );
  return Number(rows[0]?.total ?? 0);
}

export function isStorageKeyEligibleForDelete(storageKey) {
  try {
    const root = resolveInboundMediaRoot();
    const absolute = absoluteStoragePath(root, storageKey);
    const rootResolved = root.replace(/\\/g, '/');
    const absResolved = absolute.replace(/\\/g, '/');
    return absResolved.startsWith(rootResolved);
  } catch {
    return false;
  }
}