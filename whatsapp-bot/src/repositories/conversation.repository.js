import { query, isConversationDbEnabled, parseJsonColumn } from '../db/index.js';
import { clampRetentionBatchSize } from '../utils/conversation-retention.js';
import { isManualTakeoverEnabled } from '../utils/manual-takeover-flag.js';

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
    reentryJson: parseJsonColumn(row.reentry_json, null),
    assignedAgentId: row.assigned_agent_id,
    statusVersion: row.status_version == null ? null : Number(row.status_version),
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

  async findById(id, { transaction } = {}) {
    const { rows } = await query(
      'SELECT TOP (1) * FROM dbo.conversations WHERE id = $1',
      [id],
      { transaction },
    );
    return mapRow(rows[0]);
  }

  async findByIdForUpdate(id, { transaction } = {}) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversations WITH (UPDLOCK, ROWLOCK)
       WHERE id = $1`,
      [id],
      { transaction },
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

  async updateConversation(id, patch, { transaction } = {}) {
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

    if (patch.reentryJson !== undefined) {
      fields.push(`reentry_json = $${i++}`);
      values.push(patch.reentryJson == null ? null : JSON.stringify(patch.reentryJson));
    }

    if (patch.incrementStatusVersion) {
      if (await this.hasStatusVersionColumn()) {
        fields.push('status_version = status_version + 1');
      } else if (isManualTakeoverEnabled()) {
        const error = new Error('La migración 009 es obligatoria mientras la toma manual está activa.');
        error.code = 'TAKEOVER_SCHEMA_REQUIRED';
        error.httpStatus = 503;
        throw error;
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
      { transaction },
    );
    return mapRow(rows[0]);
  }

  /**
   * Un resultado positivo se cachea. Un resultado negativo no:
   * aplicar 009 sin reiniciar el proceso debe verse en el próximo intento.
   * Con la toma apagada, la ausencia de la columna no bloquea el bot.
   */
  async describeStatusVersionColumn() {
    const { rows } = await query(
      `SELECT TYPE_NAME(c.user_type_id) AS type_name, c.is_nullable
       FROM sys.columns c
       WHERE c.object_id = OBJECT_ID(N'dbo.conversations')
         AND c.name = N'status_version'`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      typeName: String(row.type_name || '').toLowerCase(),
      nullable: row.is_nullable === true || row.is_nullable === 1,
    };
  }

  async hasStatusVersionColumn() {
    if (this._statusVersionColumn === true) return true;
    const column = await this.describeStatusVersionColumn();
    const ready = Boolean(column && column.typeName === 'int' && !column.nullable);
    if (ready) this._statusVersionColumn = true;
    return ready;
  }

  async assertTakeoverSchema() {
    const column = await this.describeStatusVersionColumn();
    if (!column || column.typeName !== 'int' || column.nullable) {
      const error = new Error('La migración 009 no está aplicada: status_version debe ser INT NOT NULL.');
      error.code = 'TAKEOVER_SCHEMA_REQUIRED';
      error.httpStatus = 503;
      throw error;
    }
    const { rows } = await query(
      `SELECT OBJECT_ID(N'dbo.conversation_operation_requests', N'U') AS object_id`,
    );
    if (!rows[0]?.object_id) {
      const error = new Error('La migración 009 no está aplicada: falta conversation_operation_requests.');
      error.code = 'TAKEOVER_SCHEMA_REQUIRED';
      error.httpStatus = 503;
      throw error;
    }
    this._statusVersionColumn = true;
  }

  async touchLastMessage(id, date = new Date()) {
    return this.updateConversation(id, { lastMessageAt: date });
  }

  async updateCurrentNode(id, currentNodeKey) {
    return this.updateConversation(id, { currentNodeKey });
  }

  /**
   * Escribe el cursor del motor solo si el cierre no armó una reentrada
   * y la conversación sigue en bot. Devuelve null si el UPDATE no matchea.
   */
  async updateFlowPositionIfNoReentry(id, patch, { transaction } = {}) {
    const { rows } = await query(
      `UPDATE dbo.conversations
       SET current_flow_id = $2,
           current_flow_version = $3,
           current_node_key = $4,
           last_message_at = $5,
           updated_at = SYSUTCDATETIME()
       OUTPUT INSERTED.*
       WHERE id = $1
         AND reentry_json IS NULL
         AND status = N'bot'`,
      [
        id,
        patch.currentFlowId ?? null,
        patch.currentFlowVersion ?? null,
        patch.currentNodeKey ?? null,
        patch.lastMessageAt ?? new Date(),
      ],
      { transaction },
    );
    return mapRow(rows[0]);
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

  /**
   * Selecciona y borra un batch de inactivas en un solo statement.
   * El DELETE revalida el cutoff para no borrar actividad nueva (cierra TOCTOU).
   * UPDLOCK + READPAST: no espera filas que inbound está actualizando.
   */
  async deleteInactiveBatchBefore(cutoff, { limit = 100, transaction } = {}) {
    const safeLimit = clampRetentionBatchSize(limit);
    const { rows } = await query(
      `WITH stale AS (
         SELECT TOP ($2) id
         FROM dbo.conversations WITH (UPDLOCK, READPAST, ROWLOCK)
         WHERE (last_message_at IS NOT NULL AND last_message_at < $1)
            OR (last_message_at IS NULL AND started_at < $1)
         ORDER BY COALESCE(last_message_at, started_at) ASC
       )
       DELETE c
       OUTPUT DELETED.id, DELETED.external_user_id
       FROM dbo.conversations AS c
       INNER JOIN stale AS s ON s.id = c.id
       WHERE (c.last_message_at IS NOT NULL AND c.last_message_at < $1)
          OR (c.last_message_at IS NULL AND c.started_at < $1)`,
      [cutoff, safeLimit],
      { transaction },
    );
    return (rows || []).map((row) => ({
      id: row.id,
      externalUserId: row.external_user_id,
    }));
  }

  /**
   * DELETE explícito por id (cleanup de tests / seed). No usar para retención.
   * Dependientes cascadian; audit_logs no tiene FK y se conservan.
   */
  async deleteByIds(ids, { transaction } = {}) {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (uniqueIds.length === 0) return [];

    const placeholders = uniqueIds.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await query(
      `DELETE FROM dbo.conversations
       OUTPUT DELETED.id, DELETED.external_user_id
       WHERE id IN (${placeholders})`,
      uniqueIds,
      { transaction },
    );
    return rows.map((row) => ({
      id: row.id,
      externalUserId: row.external_user_id,
    }));
  }

  async countConversationsWithContactEmail() {
    const { rows } = await query(
      `SELECT COUNT(*) AS total FROM dbo.conversations
       WHERE contact_email IS NOT NULL AND LTRIM(RTRIM(contact_email)) <> N''`,
    );
    return Number(rows[0]?.total ?? 0);
  }

  async listConversationsWithContactEmail({ limit = 100, offset = 0 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const { rows } = await query(
      `SELECT * FROM dbo.conversations
       WHERE contact_email IS NOT NULL AND LTRIM(RTRIM(contact_email)) <> N''
       ORDER BY started_at DESC
       OFFSET $1 ROWS FETCH NEXT $2 ROWS ONLY`,
      [safeOffset, safeLimit],
    );
    return rows.map(mapRow);
  }
}

const conversationRepository = new ConversationRepository();
export default conversationRepository;
