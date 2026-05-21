import { query, isConversationDbEnabled } from '../db/index.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    channel: row.channel,
    provider: row.provider,
    externalUserId: row.external_user_id,
    phoneNumber: row.phone_number,
    displayName: row.display_name,
    status: row.status,
    currentFlowId: row.current_flow_id,
    currentFlowVersion: row.current_flow_version,
    currentNodeKey: row.current_node_key,
    assignedAgentId: row.assigned_agent_id,
    lastMessageAt: row.last_message_at,
    startedAt: row.started_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ConversationRepository {
  isEnabled() {
    return isConversationDbEnabled();
  }

  async findByChannelAndExternalUserId(channel, externalUserId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversations
       WHERE channel = $1 AND external_user_id = $2`,
      [channel, externalUserId],
    );
    return mapRow(rows[0]);
  }

  async findByPhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversations
       WHERE phone_number = $1
       ORDER BY updated_at DESC`,
      [phoneNumber],
    );
    return mapRow(rows[0]);
  }

  async findById(id) {
    const { rows } = await query(
      'SELECT TOP (1) * FROM dbo.conversations WHERE id = $1',
      [id],
    );
    return mapRow(rows[0]);
  }

  async createConversation(data) {
    const {
      channel,
      provider,
      externalUserId,
      phoneNumber = null,
      displayName = null,
      status = 'bot',
      currentFlowId = null,
      currentFlowVersion = null,
      currentNodeKey = null,
    } = data;

    const { rows } = await query(
      `INSERT INTO dbo.conversations (
        channel, provider, external_user_id, phone_number, display_name,
        status, current_flow_id, current_flow_version, current_node_key,
        last_message_at, started_at
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, SYSUTCDATETIME(), SYSUTCDATETIME())`,
      [
        channel,
        provider,
        externalUserId,
        phoneNumber,
        displayName,
        status,
        currentFlowId,
        currentFlowVersion,
        currentNodeKey,
      ],
    );
    return mapRow(rows[0]);
  }

  async updateConversation(id, patch) {
    const fields = [];
    const values = [];
    let i = 1;

    const columnMap = {
      phoneNumber: 'phone_number',
      displayName: 'display_name',
      status: 'status',
      currentFlowId: 'current_flow_id',
      currentFlowVersion: 'current_flow_version',
      currentNodeKey: 'current_node_key',
      assignedAgentId: 'assigned_agent_id',
      lastMessageAt: 'last_message_at',
      closedAt: 'closed_at',
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
      `UPDATE dbo.conversations SET ${fields.join(', ')}
       OUTPUT INSERTED.*
       WHERE id = $${i}`,
      values,
    );
    return mapRow(rows[0]);
  }

  async touchLastMessage(id, date = new Date()) {
    return this.updateConversation(id, { lastMessageAt: date });
  }

  async updateCurrentNode(id, currentNodeKey) {
    return this.updateConversation(id, { currentNodeKey });
  }
}

const conversationRepository = new ConversationRepository();
export default conversationRepository;
