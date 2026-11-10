import { query } from '../db/index.js';

function canonicalAgentId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.toLowerCase() : null;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    requestedBy: row.requested_by,
    reason: row.reason,
    status: row.status,
    assignedAgentId: canonicalAgentId(row.assigned_agent_id),
    requestedAt: row.requested_at,
    assignedAt: row.assigned_at,
    resolvedAt: row.resolved_at,
    resolutionNote: row.resolution_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class HumanHandoffRepository {
  async createHandoff(data, { transaction } = {}) {
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
      { transaction },
    );
    return mapRow(rows[0]);
  }

  async findActiveByConversationIdForUpdate(conversationId, { transaction } = {}) {
    const { rows } = await query(
      `SELECT * FROM dbo.human_handoffs WITH (UPDLOCK, ROWLOCK)
       WHERE conversation_id = $1 AND status IN (N'pending', N'assigned')
       ORDER BY requested_at DESC`,
      [conversationId],
      { transaction },
    );
    return rows.map(mapRow);
  }

  /**
   * Resuelve todos los handoffs activos de una conversación dentro de una transacción.
   * @returns {Promise<string[]>} ids resueltos
   */
  async resolveActiveHandoffs(conversationId, patch = {}, { transaction } = {}) {
    const resolvedAt = patch.resolvedAt ?? new Date();
    const resolutionNote = patch.resolutionNote ?? null;
    const { rows } = await query(
      `UPDATE dbo.human_handoffs
       SET status = N'resolved',
           resolved_at = $2,
           resolution_note = $3,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.id
       WHERE conversation_id = $1 AND status IN (N'pending', N'assigned')`,
      [conversationId, resolvedAt, resolutionNote],
      { transaction },
    );
    return rows.map((row) => row.id);
  }

  /**
   * Garantiza un único handoff pending bajo lock de filas activas.
   * @returns {Promise<{ handoff: object, created: boolean }>}
   */
  async ensurePendingHandoffAtomic(conversationId, data, { transaction } = {}) {
    const active = await this.findActiveByConversationIdForUpdate(conversationId, { transaction });
    if (active.length > 0) {
      const pending = active.find((row) => row.status === 'pending');
      return { handoff: pending || active[0], created: false };
    }

    const handoff = await this.createHandoff(
      {
        conversationId,
        requestedBy: data.requestedBy || 'bot',
        reason: data.reason ?? null,
        status: 'pending',
        assignedAgentId: null,
      },
      { transaction },
    );
    return { handoff, created: true };
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

  /** Handoffs activos (pending o assigned), más reciente primero. */
  async findActiveByConversationId(conversationId) {
    const { rows } = await query(
      `SELECT * FROM dbo.human_handoffs
       WHERE conversation_id = $1 AND status IN (N'pending', N'assigned')
       ORDER BY requested_at DESC`,
      [conversationId],
    );
    return rows.map(mapRow);
  }

  /** Handoff activo más reciente, si existe. */
  async findLatestActiveByConversationId(conversationId) {
    const active = await this.findActiveByConversationId(conversationId);
    return active[0] || null;
  }

  async findById(id) {
    const { rows } = await query(
      'SELECT TOP (1) * FROM dbo.human_handoffs WHERE id = $1',
      [id],
    );
    return mapRow(rows[0]);
  }

  async updateHandoff(id, patch, { transaction } = {}) {
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
      { transaction },
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
