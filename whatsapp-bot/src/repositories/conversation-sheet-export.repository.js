import { query, isConversationDbEnabled } from '../db/index.js';

const COORDINATOR_LEASE_SECONDS = 120;

function isUniqueViolation(error) {
  const code = error?.number ?? error?.code;
  if (code === 2627 || code === 2601) return true;
  return /unique|duplicate|2627|2601/i.test(String(error?.message || ''));
}

function mapExportRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sheetTabName: row.sheet_tab_name,
    sheetRowNumber: row.sheet_row_number,
    exportStatus: row.export_status,
    finalStatus: row.final_status,
    idempotencyKey: row.idempotency_key,
    exportedAt: row.exported_at,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    coordinatorState: row.coordinator_state ?? null,
    coordinatorOwner: row.coordinator_owner ?? null,
    coordinatorLeaseUntil: row.coordinator_lease_until ?? null,
    rawExportStatus: row.raw_export_status ?? null,
    rawExportKey: row.raw_export_key ?? null,
  };
}

class ConversationSheetExportRepository {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async findByIdempotencyKey(idempotencyKey) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_sheet_exports WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    return mapExportRow(rows[0]);
  }

  async findLatestByConversationAndTab(conversationId, sheetTabName) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_sheet_exports
       WHERE conversation_id = $1 AND sheet_tab_name = $2`,
      [conversationId, sheetTabName],
    );
    return mapExportRow(rows[0]);
  }

  /**
   * Adquiere coordinación durable antes de lectura/escritura externa.
   * @returns {Promise<{ acquired: boolean, record: object | null, reason: string }>}
   */
  async acquireCoordinator({
    conversationId,
    sheetTabName,
    idempotencyKey,
    ownerId,
    leaseSeconds = COORDINATOR_LEASE_SECONDS,
  }) {
    if (!conversationId || !sheetTabName) {
      return { acquired: false, record: null, reason: 'missing_identity' };
    }
    const owner = String(ownerId || 'worker').slice(0, 128);
    const lease = Math.max(30, Number(leaseSeconds) || COORDINATOR_LEASE_SECONDS);

    await query(
      `UPDATE dbo.conversation_sheet_exports
       SET coordinator_state = N'ambiguous',
           export_status = N'ambiguous',
           coordinator_lease_until = NULL,
           updated_at = SYSUTCDATETIME()
       WHERE conversation_id = $1 AND sheet_tab_name = $2
         AND coordinator_state = N'in_progress'
         AND sheet_row_number IS NULL
         AND (coordinator_lease_until IS NULL OR coordinator_lease_until < SYSUTCDATETIME())`,
      [conversationId, sheetTabName],
    );

    const claim = await query(
      `UPDATE dbo.conversation_sheet_exports
       SET coordinator_state = N'acquired',
           coordinator_owner = $4,
           coordinator_lease_until = DATEADD(second, $5, SYSUTCDATETIME()),
           export_status = CASE
             WHEN export_status IN (N'appended', N'updated', N'reconciled', N'confirmed') THEN export_status
             ELSE N'coordinating'
           END,
           idempotency_key = $3,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE conversation_id = $1 AND sheet_tab_name = $2
         AND (
           coordinator_state IS NULL
           OR coordinator_state IN (N'confirmed', N'failed', N'aborted')
           OR (
             coordinator_state = N'acquired'
             AND (coordinator_lease_until IS NULL OR coordinator_lease_until < SYSUTCDATETIME())
           )
         )`,
      [conversationId, sheetTabName, idempotencyKey, owner, lease],
    );
    if (claim.rows[0]) {
      return { acquired: true, record: mapExportRow(claim.rows[0]), reason: 'claimed_existing' };
    }

    try {
      const { rows } = await query(
        `INSERT INTO dbo.conversation_sheet_exports (
          conversation_id, sheet_tab_name, sheet_row_number, export_status,
          final_status, idempotency_key, coordinator_state, coordinator_owner, coordinator_lease_until
        )
        OUTPUT INSERTED.*
        VALUES ($1, $2, NULL, N'coordinating', NULL, $3, N'acquired', $4,
                DATEADD(second, $5, SYSUTCDATETIME()))`,
        [conversationId, sheetTabName, idempotencyKey, owner, lease],
      );
      return { acquired: true, record: mapExportRow(rows[0]), reason: 'inserted' };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }

    const blocked = await this.findLatestByConversationAndTab(conversationId, sheetTabName);
    if (!blocked) {
      return { acquired: false, record: null, reason: 'race_lost' };
    }
    const leaseActive = blocked.coordinatorLeaseUntil
      && new Date(blocked.coordinatorLeaseUntil).getTime() > Date.now();
    if (leaseActive && ['acquired', 'in_progress'].includes(blocked.coordinatorState)) {
      return { acquired: false, record: blocked, reason: 'in_progress' };
    }
    if (blocked.coordinatorState === 'ambiguous') {
      return { acquired: false, record: blocked, reason: 'ambiguous' };
    }
  if (blocked.sheetRowNumber) {
    return { acquired: false, record: blocked, reason: 'already_confirmed' };
    }
    return { acquired: false, record: blocked, reason: 'contention' };
  }

  async markCoordinatorInProgress(exportId, ownerId) {
    const owner = String(ownerId || 'worker').slice(0, 128);
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports
       SET coordinator_state = N'in_progress',
           coordinator_owner = $2,
           coordinator_lease_until = DATEADD(second, $3, SYSUTCDATETIME()),
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE id = $1
         AND coordinator_state = N'acquired'
         AND coordinator_owner = $2`,
      [exportId, owner, COORDINATOR_LEASE_SECONDS],
    );
    return mapExportRow(rows[0]);
  }

  async confirmCoordinator(exportId, patch = {}, ownerId = null) {
    const fields = [
      ['coordinator_state', 'N\'confirmed\''],
      ['coordinator_lease_until', 'NULL'],
    ];
    const values = [];
    let i = 1;
    const sets = ['coordinator_state = N\'confirmed\'', 'coordinator_lease_until = NULL'];
    for (const [key, column] of [
      ['sheetRowNumber', 'sheet_row_number'],
      ['exportStatus', 'export_status'],
      ['finalStatus', 'final_status'],
      ['exportedAt', 'exported_at'],
      ['lastSyncAt', 'last_sync_at'],
    ]) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        values.push(patch[key]);
      }
    }
    sets.push('updated_at = SYSUTCDATETIME()');
    values.push(exportId);
    if (ownerId) {
      values.push(String(ownerId).slice(0, 128));
      const { rows } = await query(
        `UPDATE dbo.conversation_sheet_exports SET ${sets.join(', ')}
         OUTPUT INSERTED.*
         WHERE id = $${i} AND coordinator_owner = $${i + 1}`,
        values,
      );
      return mapExportRow(rows[0]);
    }
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports SET ${sets.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}`,
      values,
    );
    return mapExportRow(rows[0]);
  }

  /**
   * Confirma ledger ambiguo cuando la fila física ya existe (sin append ciego).
   */
  async reconcileAmbiguousCoordinator(exportId, patch = {}) {
    const sets = [
      "coordinator_state = N'confirmed'",
      'coordinator_lease_until = NULL',
    ];
    const values = [];
    let i = 1;
    for (const [key, column] of [
      ['sheetRowNumber', 'sheet_row_number'],
      ['exportStatus', 'export_status'],
      ['finalStatus', 'final_status'],
      ['exportedAt', 'exported_at'],
      ['lastSyncAt', 'last_sync_at'],
    ]) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        values.push(patch[key]);
      }
    }
    sets.push('updated_at = SYSUTCDATETIME()');
    values.push(exportId);
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports SET ${sets.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}
         AND coordinator_state = N'ambiguous'`,
      values,
    );
    return mapExportRow(rows[0]);
  }

  async markCoordinatorAmbiguous(exportId, ownerId = null) {
    const values = [exportId];
    let where = 'WHERE id = $1';
    if (ownerId) {
      values.push(String(ownerId).slice(0, 128));
      where += ' AND coordinator_owner = $2';
    }
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports
       SET coordinator_state = N'ambiguous',
           export_status = N'ambiguous',
           coordinator_lease_until = NULL,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       ${where}`,
      values,
    );
    return mapExportRow(rows[0]);
  }

  async updateRawExportState(exportId, { rawExportStatus, rawExportKey } = {}) {
    const fields = [];
    const values = [];
    let i = 1;
    if (rawExportStatus !== undefined) {
      fields.push(`raw_export_status = $${i++}`);
      values.push(rawExportStatus);
    }
    if (rawExportKey !== undefined) {
      fields.push(`raw_export_key = $${i++}`);
      values.push(rawExportKey);
    }
    if (fields.length === 0) return null;
    fields.push('updated_at = SYSUTCDATETIME()');
    values.push(exportId);
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports SET ${fields.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}`,
      values,
    );
    return mapExportRow(rows[0]);
  }

  async releaseCoordinator(exportId, ownerId) {
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports
       SET coordinator_state = N'failed',
           coordinator_lease_until = NULL,
           export_status = CASE WHEN sheet_row_number IS NULL THEN N'failed' ELSE export_status END,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE id = $1 AND coordinator_owner = $2`,
      [exportId, String(ownerId || 'worker').slice(0, 128)],
    );
    return mapExportRow(rows[0]);
  }

  async upsertExport(data) {
    const byTab = data.conversationId && data.sheetTabName
      ? await this.findLatestByConversationAndTab(data.conversationId, data.sheetTabName)
      : null;
    if (byTab) {
      return this.updateExport(byTab.id, {
        sheetRowNumber: data.sheetRowNumber,
        exportStatus: data.exportStatus,
        finalStatus: data.finalStatus,
        exportedAt: data.exportedAt,
        lastSyncAt: data.lastSyncAt,
      });
    }

    const existing = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return existing;

    try {
      const { rows } = await query(
        `INSERT INTO dbo.conversation_sheet_exports (
          conversation_id, sheet_tab_name, sheet_row_number, export_status,
          final_status, idempotency_key, exported_at, last_sync_at
        )
        OUTPUT INSERTED.*
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          data.conversationId,
          data.sheetTabName,
          data.sheetRowNumber || null,
          data.exportStatus,
          data.finalStatus || null,
          data.idempotencyKey,
          data.exportedAt || new Date(),
          data.lastSyncAt || new Date(),
        ],
      );
      return mapExportRow(rows[0]);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const fallback = await this.findLatestByConversationAndTab(data.conversationId, data.sheetTabName);
      if (fallback) {
        return this.updateExport(fallback.id, {
          sheetRowNumber: data.sheetRowNumber,
          exportStatus: data.exportStatus,
          finalStatus: data.finalStatus,
          exportedAt: data.exportedAt,
          lastSyncAt: data.lastSyncAt,
        });
      }
      throw error;
    }
  }

  async updateExport(id, patch) {
    const fields = [];
    const values = [];
    let i = 1;
    for (const [key, column] of [
      ['sheetRowNumber', 'sheet_row_number'],
      ['exportStatus', 'export_status'],
      ['finalStatus', 'final_status'],
      ['exportedAt', 'exported_at'],
      ['lastSyncAt', 'last_sync_at'],
    ]) {
      if (patch[key] !== undefined) {
        fields.push(`${column} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (fields.length === 0) return null;
    fields.push('updated_at = SYSUTCDATETIME()');
    values.push(id);
    const { rows } = await query(
      `UPDATE dbo.conversation_sheet_exports SET ${fields.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}`,
      values,
    );
    return mapExportRow(rows[0]);
  }
}

const conversationSheetExportRepository = new ConversationSheetExportRepository();
export default conversationSheetExportRepository;
export { COORDINATOR_LEASE_SECONDS, mapExportRow };