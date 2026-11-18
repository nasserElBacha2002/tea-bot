import { query } from '../db/index.js';
import { isPermanentInboundMediaFailure } from '../utils/inbound-media-policy.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    ordinal: row.ordinal,
    providerMediaIndex: row.provider_media_index,
    mimeType: row.mime_type,
    byteSize: row.byte_size != null ? Number(row.byte_size) : null,
    originalName: row.original_name,
    storageKey: row.storage_key,
    sourceUrl: row.source_url,
    status: row.status,
    failureReason: row.failure_reason,
    sha256: row.sha256,
    retryCount: row.retry_count != null ? Number(row.retry_count) : 0,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error) {
  const number = error?.number || error?.originalError?.info?.number;
  return number === 2627 || number === 2601;
}

class ConversationMessageAttachmentRepository {
  async findByMessageId(messageId, { transaction } = {}) {
    const { rows } = await query(
      `SELECT * FROM dbo.conversation_message_attachments
       WHERE message_id = $1
       ORDER BY ordinal ASC`,
      [messageId],
      { transaction },
    );
    return rows.map(mapRow);
  }

  async findByMessageIds(messageIds, { transaction } = {}) {
    const ids = [...new Set((messageIds || []).filter(Boolean))];
    if (!ids.length) return [];
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await query(
      `SELECT * FROM dbo.conversation_message_attachments
       WHERE message_id IN (${placeholders})
       ORDER BY message_id, ordinal ASC`,
      ids,
      { transaction },
    );
    return rows.map(mapRow);
  }

  async findById(id, { transaction } = {}) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_message_attachments WHERE id = $1`,
      [id],
      { transaction },
    );
    return mapRow(rows[0]);
  }

  async findByMessageIdAndOrdinal(messageId, ordinal, { transaction } = {}) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_message_attachments
       WHERE message_id = $1 AND ordinal = $2`,
      [messageId, ordinal],
      { transaction },
    );
    return mapRow(rows[0]);
  }

  async insertStored(data, { transaction } = {}) {
    const {
      messageId,
      conversationId,
      ordinal = 0,
      mimeType = null,
      byteSize = null,
      originalName = null,
      storageKey,
      sha256 = null,
      providerMediaIndex = -1,
    } = data;
    const { rows } = await query(
      `DECLARE @inserted TABLE (id UNIQUEIDENTIFIER);
       INSERT INTO dbo.conversation_message_attachments (
         message_id, conversation_id, ordinal, provider_media_index,
         mime_type, byte_size, original_name, storage_key, status, sha256
       )
       OUTPUT INSERTED.id INTO @inserted
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, N'stored', $9);
       SELECT a.* FROM dbo.conversation_message_attachments a
       INNER JOIN @inserted i ON i.id = a.id`,
      [
        messageId,
        conversationId,
        ordinal,
        providerMediaIndex,
        mimeType,
        byteSize,
        originalName,
        storageKey,
        sha256,
      ],
      { transaction },
    );
    return mapRow(rows[0]);
  }

  async upsertPending(data, { transaction } = {}) {
    const {
      messageId,
      conversationId,
      ordinal,
      providerMediaIndex,
      mimeType = null,
      originalName = null,
      sourceUrl = null,
    } = data;
    const existing = await this.findByMessageIdAndOrdinal(messageId, ordinal, { transaction });
    if (existing) return existing;
    try {
      const { rows } = await query(
        `DECLARE @inserted TABLE (id UNIQUEIDENTIFIER);
         INSERT INTO dbo.conversation_message_attachments (
          message_id, conversation_id, ordinal, provider_media_index,
          mime_type, original_name, source_url, status
        )
        OUTPUT INSERTED.id INTO @inserted
        VALUES ($1, $2, $3, $4, $5, $6, $7, N'pending');
         SELECT a.* FROM dbo.conversation_message_attachments a
         INNER JOIN @inserted i ON i.id = a.id`,
        [messageId, conversationId, ordinal, providerMediaIndex, mimeType, originalName, sourceUrl],
        { transaction },
      );
      return mapRow(rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return (await this.findByMessageIdAndOrdinal(messageId, ordinal, { transaction }));
    }
  }

  async tryAcquireForDownload(id, { expectedStatus, expectedRetryCount, transaction } = {}) {
    const { rows } = await query(
      `DECLARE @updated TABLE (id UNIQUEIDENTIFIER);
       UPDATE dbo.conversation_message_attachments
       SET status = N'downloading',
           retry_count = retry_count + 1,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.id INTO @updated
       WHERE id = $1
         AND status = $2
         AND retry_count = $3;
       SELECT a.* FROM dbo.conversation_message_attachments a
       INNER JOIN @updated u ON u.id = a.id`,
      [id, expectedStatus, expectedRetryCount],
      { transaction },
    );
    return mapRow(rows[0]);
  }

  async listRetryableBatch(limit, maxRetries, { transaction } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const { rows } = await query(
      `SELECT TOP (${safeLimit}) *
       FROM dbo.conversation_message_attachments WITH (READPAST)
       WHERE status IN (N'pending', N'failed')
         AND retry_count < $1
         AND (next_retry_at IS NULL OR next_retry_at <= SYSUTCDATETIME())
       ORDER BY created_at ASC`,
      [maxRetries],
      { transaction },
    );
    return rows
      .map(mapRow)
      .filter((row) => row.status !== 'stored' && row.status !== 'downloading')
      .filter((row) => !isPermanentInboundMediaFailure(row.failureReason));
  }

  async markStored(id, patch, { transaction } = {}) {
    await query(
      `UPDATE dbo.conversation_message_attachments
       SET status = N'stored',
           storage_key = $2,
           byte_size = $3,
           sha256 = $4,
           mime_type = COALESCE($5, mime_type),
           failure_reason = NULL,
           next_retry_at = NULL,
           updated_at = SYSUTCDATETIME()
       WHERE id = $1 AND status = N'downloading'`,
      [id, patch.storageKey, patch.byteSize, patch.sha256, patch.mimeType ?? null],
      { transaction },
    );
    return this.findById(id, { transaction });
  }

  async markFailed(id, reason, { transaction, retryAt = null } = {}) {
    await query(
      `UPDATE dbo.conversation_message_attachments
       SET status = N'failed',
           failure_reason = $2,
           next_retry_at = $3,
           updated_at = SYSUTCDATETIME()
       WHERE id = $1`,
      [id, reason?.slice(0, 128) || 'failed', retryAt],
      { transaction },
    );
    return this.findById(id, { transaction });
  }

  async resetStuckDownloading(olderThanSeconds = 300, { transaction } = {}) {
    const { rows } = await query(
      `DECLARE @updated TABLE (id UNIQUEIDENTIFIER);
       UPDATE dbo.conversation_message_attachments
       SET status = N'pending',
           failure_reason = N'download_interrupted',
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.id INTO @updated
       WHERE status = N'downloading'
         AND updated_at < DATEADD(second, -1 * $1, SYSUTCDATETIME());
       SELECT id FROM @updated`,
      [olderThanSeconds],
      { transaction },
    );
    return rows.map((row) => row.id);
  }

  async listStoredKeysByConversationIds(conversationIds, { transaction } = {}) {
    if (!conversationIds?.length) return [];
    const placeholders = conversationIds.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await query(
      `SELECT storage_key
       FROM dbo.conversation_message_attachments
       WHERE conversation_id IN (${placeholders})
         AND status = N'stored'
         AND storage_key IS NOT NULL
         AND storage_key <> N''`,
      conversationIds,
      { transaction },
    );
    return rows.map((row) => row.storage_key).filter(Boolean);
  }
}

const conversationMessageAttachmentRepository = new ConversationMessageAttachmentRepository();
export default conversationMessageAttachmentRepository;