import { query, parseJsonColumn } from '../db/index.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    flowId: row.flow_id,
    flowVersion: row.flow_version,
    currentNodeKey: row.current_node_key,
    variablesJson: parseJsonColumn(row.variables_json, {}),
    historyJson: parseJsonColumn(row.history_json, []),
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    updatedAt: row.updated_at,
  };
}

function serializeJson(value) {
  return typeof value === 'string' ? value : JSON.stringify(value ?? {});
}

class ConversationSessionRepository {
  async findActiveByConversationId(conversationId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_sessions
       WHERE conversation_id = $1 AND status = N'active'
       ORDER BY started_at DESC`,
      [conversationId],
    );
    return mapRow(rows[0]);
  }

  async createSession(data) {
    const {
      conversationId,
      flowId,
      flowVersion = null,
      currentNodeKey = null,
      variablesJson = {},
      historyJson = [],
      status = 'active',
    } = data;

    const { rows } = await query(
      `INSERT INTO dbo.conversation_sessions (
        conversation_id, flow_id, flow_version, current_node_key,
        variables_json, history_json, status
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        conversationId,
        flowId,
        flowVersion,
        currentNodeKey,
        serializeJson(variablesJson),
        serializeJson(historyJson),
        status,
      ],
    );
    return mapRow(rows[0]);
  }

  async updateSession(id, patch) {
    const fields = [];
    const values = [];
    let i = 1;

    if (patch.flowId !== undefined) {
      fields.push(`flow_id = $${i++}`);
      values.push(patch.flowId);
    }
    if (patch.flowVersion !== undefined) {
      fields.push(`flow_version = $${i++}`);
      values.push(patch.flowVersion);
    }
    if (patch.currentNodeKey !== undefined) {
      fields.push(`current_node_key = $${i++}`);
      values.push(patch.currentNodeKey);
    }
    if (patch.variablesJson !== undefined) {
      fields.push(`variables_json = $${i++}`);
      values.push(serializeJson(patch.variablesJson));
    }
    if (patch.historyJson !== undefined) {
      fields.push(`history_json = $${i++}`);
      values.push(serializeJson(patch.historyJson));
    }
    if (patch.status !== undefined) {
      fields.push(`status = $${i++}`);
      values.push(patch.status);
    }
    if (patch.endedAt !== undefined) {
      fields.push(`ended_at = $${i++}`);
      values.push(patch.endedAt);
    }

    if (fields.length === 0) {
      const { rows } = await query(
        'SELECT TOP (1) * FROM dbo.conversation_sessions WHERE id = $1',
        [id],
      );
      return mapRow(rows[0]);
    }

    fields.push('updated_at = SYSUTCDATETIME()');
    values.push(id);

    const { rows } = await query(
      `UPDATE dbo.conversation_sessions SET ${fields.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}`,
      values,
    );
    return mapRow(rows[0]);
  }

  async endSession(id, endedAt = new Date()) {
    return this.updateSession(id, { status: 'ended', endedAt });
  }

  async endAllActiveForConversation(conversationId, endedAt = new Date()) {
    await query(
      `UPDATE dbo.conversation_sessions
       SET status = N'ended', ended_at = $2, updated_at = SYSUTCDATETIME()
       WHERE conversation_id = $1 AND status = N'active'`,
      [conversationId, endedAt],
    );
  }
}

const conversationSessionRepository = new ConversationSessionRepository();
export default conversationSessionRepository;
