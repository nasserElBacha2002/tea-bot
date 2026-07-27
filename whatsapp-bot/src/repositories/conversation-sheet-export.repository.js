import { query, isConversationDbEnabled } from '../db/index.js';

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
       WHERE conversation_id = $1 AND sheet_tab_name = $2
       ORDER BY exported_at DESC, created_at DESC`,
      [conversationId, sheetTabName],
    );
    return mapExportRow(rows[0]);
  }

  async upsertExport(data) {
    const existing = await this.findByIdempotencyKey(data.idempotencyKey);
    if (existing) return existing;

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
