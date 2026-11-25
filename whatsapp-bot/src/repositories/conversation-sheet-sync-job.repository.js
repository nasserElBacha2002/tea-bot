import { query, isConversationDbEnabled } from '../db/index.js';

const SYNC_JOB_LEASE_SECONDS = 120;

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    syncKind: row.sync_kind,
    status: row.status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    payloadHash: row.payload_hash,
    workerOwner: row.worker_owner ?? null,
    workerLeaseUntil: row.worker_lease_until ?? null,
    jobGeneration: row.job_generation ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error) {
  const code = error?.number ?? error?.code;
  if (code === 2627 || code === 2601) return true;
  return /unique|duplicate|2627|2601/i.test(String(error?.message || ''));
}

const MAX_ATTEMPTS = 8;

class ConversationSheetSyncJobRepository {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async enqueue(conversationId, syncKind, payloadHash = null, options = {}) {
    if (!conversationId || !syncKind) return null;
    const tx = options.transaction || null;
    try {
      const { rows } = await query(
        `INSERT INTO dbo.conversation_sheet_sync_jobs (
          conversation_id, sync_kind, status, attempts, next_attempt_at, payload_hash, job_generation
        )
        OUTPUT INSERTED.*
        VALUES ($1, $2, N'pending', 0, SYSUTCDATETIME(), $3, 0)`,
        [conversationId, syncKind, payloadHash],
        { transaction: tx },
      );
      return mapRow(rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const { rows } = await query(
        `UPDATE dbo.conversation_sheet_sync_jobs
         SET
           status = CASE
             WHEN $3 IS NOT NULL AND payload_hash IS NOT NULL AND payload_hash = $3 AND status = N'completed'
               THEN N'completed'
             WHEN $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3)
               THEN N'pending'
             WHEN status = N'exhausted' AND $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3)
               THEN N'pending'
             WHEN status IN (N'pending', N'failed', N'processing') THEN N'pending'
             ELSE status
           END,
           attempts = CASE
             WHEN $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN 0
             WHEN status = N'exhausted' AND $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN 0
             ELSE attempts
           END,
           job_generation = CASE
             WHEN $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN job_generation + 1
             WHEN status = N'exhausted' AND $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN job_generation + 1
             ELSE job_generation
           END,
           payload_hash = COALESCE($3, payload_hash),
           next_attempt_at = CASE
             WHEN $3 IS NOT NULL AND payload_hash IS NOT NULL AND payload_hash = $3 AND status = N'completed'
               THEN next_attempt_at
             ELSE SYSUTCDATETIME()
           END,
           worker_owner = CASE
             WHEN $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN NULL
             WHEN status = N'exhausted' AND $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN NULL
             ELSE worker_owner
           END,
           worker_lease_until = CASE
             WHEN $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN NULL
             WHEN status = N'exhausted' AND $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN NULL
             ELSE worker_lease_until
           END,
           last_error = CASE
             WHEN $3 IS NOT NULL AND (payload_hash IS NULL OR payload_hash <> $3) THEN NULL
             ELSE last_error
           END,
           updated_at = SYSUTCDATETIME()
         OUTPUT INSERTED.*
         WHERE conversation_id = $1 AND sync_kind = $2`,
        [conversationId, syncKind, payloadHash],
        { transaction: tx },
      );
      return mapRow(rows[0]);
    }
  }

  async acquireDue(limit = 25, ownerPrefix, leaseSeconds = SYNC_JOB_LEASE_SECONDS) {
    const prefix = String(ownerPrefix || 'worker').slice(0, 64);
    const lease = Math.max(30, Number(leaseSeconds) || SYNC_JOB_LEASE_SECONDS);
    const cap = Math.min(100, Math.max(1, limit));
    const { rows } = await query(
      `UPDATE j
       SET status = N'processing',
           worker_owner = LEFT(CONCAT($2, N':', CONVERT(NVARCHAR(36), NEWID())), 128),
           worker_lease_until = DATEADD(second, $3, SYSUTCDATETIME()),
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       FROM (
         SELECT TOP (${cap}) id
         FROM dbo.conversation_sheet_sync_jobs WITH (UPDLOCK, READPAST)
         WHERE (
             status IN (N'pending', N'failed')
             OR (
               status = N'processing'
               AND (worker_lease_until IS NULL OR worker_lease_until < SYSUTCDATETIME())
             )
           )
           AND status <> N'completed'
           AND status <> N'exhausted'
           AND attempts < $1
           AND next_attempt_at <= SYSUTCDATETIME()
         ORDER BY next_attempt_at ASC
       ) AS pick
       INNER JOIN dbo.conversation_sheet_sync_jobs AS j ON j.id = pick.id
       WHERE (
           j.status IN (N'pending', N'failed')
           OR (
             j.status = N'processing'
             AND (j.worker_lease_until IS NULL OR j.worker_lease_until < SYSUTCDATETIME())
           )
         )
         AND j.attempts < $1`,
      [MAX_ATTEMPTS, prefix, lease],
    );
    return rows.map(mapRow);
  }

  async claimForInlineSync(conversationId, syncKind, { jobGeneration, payloadHash } = {}) {
    if (!conversationId || !syncKind) return null;
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_sync_jobs
       SET status = N'processing',
           worker_owner = LEFT(CONCAT(N'inline:', CONVERT(NVARCHAR(36), NEWID())), 128),
           worker_lease_until = DATEADD(second, 120, SYSUTCDATETIME()),
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE conversation_id = $1 AND sync_kind = $2
         AND job_generation = $3
         AND payload_hash = $4
         AND status IN (N'pending', N'failed')
         AND (
           worker_owner IS NULL
           OR worker_lease_until IS NULL
           OR worker_lease_until < SYSUTCDATETIME()
         )`,
      [conversationId, syncKind, Number(jobGeneration), payloadHash],
    );
    return mapRow(rows[0]);
  }

  async findJobFence(id) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_sheet_sync_jobs WHERE id = $1`,
      [id],
    );
    return mapRow(rows[0]);
  }

  async markCompleted(id, { ownerId, jobGeneration, payloadHash } = {}) {
    const values = [id];
    let where = 'WHERE id = $1';
    if (ownerId) {
      values.push(String(ownerId).slice(0, 128));
      where += ` AND worker_owner = $${values.length}`;
    }
    if (jobGeneration != null) {
      values.push(Number(jobGeneration));
      where += ` AND job_generation = $${values.length}`;
    }
    if (payloadHash) {
      values.push(String(payloadHash));
      where += ` AND payload_hash = $${values.length}`;
    }
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_sync_jobs
       SET status = N'completed',
           worker_owner = NULL,
           worker_lease_until = NULL,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       ${where}`,
      values,
    );
    return mapRow(rows[0]);
  }

  async markRetry(id, errorMessage, backoffSeconds, { ownerId, jobGeneration } = {}) {
    const backoff = Math.min(3600, Math.max(15, Number(backoffSeconds) || 60));
    const values = [id, backoff, String(errorMessage || 'error').slice(0, 512), MAX_ATTEMPTS];
    let where = 'WHERE id = $1';
    if (ownerId) {
      values.push(String(ownerId).slice(0, 128));
      where += ` AND worker_owner = $${values.length}`;
    }
    if (jobGeneration != null) {
      values.push(Number(jobGeneration));
      where += ` AND job_generation = $${values.length}`;
    }
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_sync_jobs
       SET status = CASE WHEN attempts + 1 >= $4 THEN N'exhausted' ELSE N'failed' END,
           attempts = attempts + 1,
           next_attempt_at = DATEADD(second, $2, SYSUTCDATETIME()),
           last_error = $3,
           worker_owner = NULL,
           worker_lease_until = NULL,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       ${where}`,
      values,
    );
    return mapRow(rows[0]);
  }

  async cancelForConversation(conversationId) {
    await query(
      `DELETE FROM dbo.conversation_sheet_sync_jobs WHERE conversation_id = $1`,
      [conversationId],
    );
  }

  async findByConversation(conversationId, syncKind = 'email') {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_sheet_sync_jobs
       WHERE conversation_id = $1 AND sync_kind = $2`,
      [conversationId, syncKind],
    );
    return mapRow(rows[0]);
  }
}

const conversationSheetSyncJobRepository = new ConversationSheetSyncJobRepository();
export default conversationSheetSyncJobRepository;
export { MAX_ATTEMPTS, SYNC_JOB_LEASE_SECONDS, mapRow };