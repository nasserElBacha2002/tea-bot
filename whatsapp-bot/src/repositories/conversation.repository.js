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
    contactEmail: row.contact_email,
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

  async syncDisplayNameByPhoneAndChannel(phoneNumber, channel, displayName) {
    if (!phoneNumber || !channel || displayName == null) return;
    await query(
      `UPDATE dbo.conversations
       SET display_name = $1, updated_at = SYSUTCDATETIME()
       WHERE phone_number = $2 AND channel = $3`,
      [displayName, phoneNumber, channel],
    );
  }

  async syncContactEmailByPhoneAndChannel(phoneNumber, channel, contactEmail) {
    if (!phoneNumber || !channel || contactEmail == null) return;
    await query(
      `UPDATE dbo.conversations
       SET contact_email = $1, updated_at = SYSUTCDATETIME()
       WHERE phone_number = $2 AND channel = $3`,
      [contactEmail, phoneNumber, channel],
    );
  }

  async findContactEmailByPhoneAndChannel(phoneNumber, channel) {
    if (!phoneNumber || !channel) return null;
    const { rows } = await query(
      `SELECT TOP (1) contact_email
       FROM dbo.conversations
       WHERE phone_number = $1 AND channel = $2
         AND contact_email IS NOT NULL AND contact_email <> N''
       ORDER BY updated_at DESC`,
      [phoneNumber, channel],
    );
    const email = rows[0]?.contact_email;
    if (!email || typeof email !== 'string') return null;
    const trimmed = email.trim().toLowerCase();
    return trimmed || null;
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
      contactEmail: 'contact_email',
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

  /**
   * @param {object} filters
   * @param {string} [filters.status]
   * @param {string} [filters.channel]
   * @param {string} [filters.provider]
   * @param {string} [filters.search]
   * @param {number} [filters.limit]
   * @param {number} [filters.offset]
   * @param {string} [filters.sort]
   */
  _buildListWhere(filters, values) {
    const clauses = ['1 = 1'];
    let i = values.length + 1;

    if (filters.status) {
      clauses.push(`c.status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.channel) {
      clauses.push(`c.channel = $${i++}`);
      values.push(filters.channel);
    }
    if (filters.provider) {
      clauses.push(`c.provider = $${i++}`);
      values.push(filters.provider);
    }
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      clauses.push(`(
        c.phone_number LIKE $${i}
        OR c.display_name LIKE $${i}
        OR EXISTS (
          SELECT 1 FROM dbo.conversation_messages m
          WHERE m.conversation_id = c.id AND m.body LIKE $${i}
        )
      )`);
      values.push(pattern);
      i += 1;
    }

    return { whereSql: clauses.join(' AND '), nextIndex: i };
  }

  _sortClause(sort) {
    switch (sort) {
      case 'last_message_at_asc':
        return 'c.last_message_at ASC, c.started_at ASC';
      case 'started_at_desc':
        return 'c.started_at DESC';
      default:
        return 'c.last_message_at DESC, c.started_at DESC';
    }
  }

  async countConversations(filters = {}) {
    const values = [];
    const { whereSql } = this._buildListWhere(filters, values);
    const { rows } = await query(
      `SELECT COUNT(*) AS total FROM dbo.conversations c WHERE ${whereSql}`,
      values,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async listConversations(filters = {}) {
    const limit = Math.min(Math.max(Number(filters.limit) || 25, 1), 100);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const values = [];
    const { whereSql, nextIndex } = this._buildListWhere(filters, values);
    const orderBy = this._sortClause(filters.sort);

    values.push(limit, offset);
    const limitParam = nextIndex;
    const offsetParam = nextIndex + 1;

    const { rows } = await query(
      `SELECT c.* FROM dbo.conversations c
       WHERE ${whereSql}
       ORDER BY ${orderBy}
       OFFSET $${offsetParam} ROWS FETCH NEXT $${limitParam} ROWS ONLY`,
      values,
    );
    return rows.map(mapRow);
  }

  async getConversationById(id) {
    return this.findById(id);
  }
}

const conversationRepository = new ConversationRepository();
export default conversationRepository;
