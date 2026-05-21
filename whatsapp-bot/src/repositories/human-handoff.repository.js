import { query } from '../db/index.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    status: row.status,
    assignedAgentId: row.assigned_agent_id,
    requestedAt: row.requested_at,
    assignedAt: row.assigned_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class HumanHandoffRepository {
  async createHandoff(data) {
    const {
      conversationId,
      requestedBy,
      reason = null,
      status = 'pending',
      assignedAgentId = null,
    } = data;

    const { rows } = await query(
      `INSERT INTO dbo.human_handoffs (
        conversation_id, requested_by, reason, status, assigned_agent_id
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5)`,
      [conversationId, requestedBy, reason, status, assignedAgentId],
    );
    return mapRow(rows[0]);
  }

  async findPendingByConversationId(conversationId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.human_handoffs
       WHERE conversation_id = $1 AND status = N'pending'
       ORDER BY requested_at DESC`,
      [conversationId],
    );
    return mapRow(rows[0]);
  }

  async findLatestByConversationId(conversationId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.human_handoffs
       WHERE conversation_id = $1
       ORDER BY requested_at DESC`,
      [conversationId],
    );
    return mapRow(rows[0]);
  }

  async findById(id) {
    const { rows } = await query(
      'SELECT TOP (1) * FROM dbo.human_handoffs WHERE id = $1',
      [id],
    );
    return mapRow(rows[0]);
  }

  async updateHandoff(id, patch) {
    const fields = [];
    const values = [];
    let i = 1;

    const columnMap = {
      reason: 'reason',
      status: 'status',
      assignedAgentId: 'assigned_agent_id',
      assignedAt: 'assigned_at',
      resolvedAt: 'resolved_at',
      resolutionNote: 'resolution_note',
    };

    for (const [key, column] of Object.entries(columnMap)) {
      if (patch[key] !== undefined) {
        fields.push(`${column} = $${i++}`);
        values.push(patch[key]);
      }
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    fields.push('updated_at = SYSUTCDATETIME()');
    values.push(id);

    const { rows } = await query(
      `UPDATE dbo.human_handoffs SET ${fields.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}`,
      values,
    );
    return mapRow(rows[0]);
  }

  async listPending(limit = 50, offset = 0) {
    const { rows } = await query(
      `SELECT * FROM dbo.human_handoffs
       WHERE status = N'pending'
       ORDER BY requested_at ASC
       OFFSET $2 ROWS FETCH NEXT $1 ROWS ONLY`,
      [limit, offset],
    );
    return rows.map(mapRow);
  }

  /**
   * Handoff más relevante por conversación (pending primero, luego el más reciente).
   * @param {string[]} conversationIds
   */
  async listLatestByConversationIds(conversationIds) {
    if (!conversationIds?.length) return new Map();

    const placeholders = conversationIds.map((_, idx) => `$${idx + 1}`).join(', ');
    const { rows } = await query(
      `WITH ranked AS (
        SELECT h.*,
          ROW_NUMBER() OVER (
            PARTITION BY h.conversation_id
            ORDER BY
              CASE WHEN h.status = N'pending' THEN 0 ELSE 1 END,
              h.requested_at DESC
          ) AS rn
        FROM dbo.human_handoffs h
        WHERE h.conversation_id IN (${placeholders})
      )
      SELECT * FROM ranked WHERE rn = 1`,
      conversationIds,
    );

    const map = new Map();
    for (const row of rows) {
      const mapped = mapRow(row);
      map.set(mapped.conversationId, mapped);
    }
    return map;
  }
}

const humanHandoffRepository = new HumanHandoffRepository();
export default humanHandoffRepository;
