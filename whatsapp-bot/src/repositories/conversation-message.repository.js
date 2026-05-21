import { query, parseJsonColumn } from '../db/index.js';

function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    senderType: row.sender_type,
    body: row.body,
    provider: row.provider,
    providerMessageId: row.provider_message_id,
    rawPayloadJson: parseJsonColumn(row.raw_payload_json, null),
    metadataJson: parseJsonColumn(row.metadata_json, null),
    createdAt: row.created_at,
  };
}

function serializeJson(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

class ConversationMessageRepository {
  async createMessage(data) {
    const {
      conversationId,
      direction,
      senderType,
      body = '',
      provider,
      providerMessageId = null,
      rawPayloadJson = null,
      metadataJson = null,
    } = data;

    if (providerMessageId) {
      const existing = await this.findByProviderMessageId(provider, providerMessageId);
      if (existing) return existing;
    }

    const { rows } = await query(
      `INSERT INTO dbo.conversation_messages (
        conversation_id, direction, sender_type, body, provider,
        provider_message_id, raw_payload_json, metadata_json
      )
      OUTPUT INSERTED.*
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        conversationId,
        direction,
        senderType,
        body,
        provider,
        providerMessageId,
        serializeJson(rawPayloadJson),
        serializeJson(metadataJson),
      ],
    );
    return mapRow(rows[0]);
  }

  async findByProviderMessageId(provider, providerMessageId) {
    const { rows } = await query(
      `SELECT TOP (1) * FROM dbo.conversation_messages
       WHERE provider = $1 AND provider_message_id = $2`,
      [provider, providerMessageId],
    );
    return mapRow(rows[0]);
  }

  async listByConversationId(conversationId, options = {}) {
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
    const offset = Math.max(Number(options.offset) || 0, 0);
    const order = String(options.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const { rows } = await query(
      `SELECT * FROM dbo.conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at ${order}
       OFFSET $3 ROWS FETCH NEXT $2 ROWS ONLY`,
      [conversationId, limit, offset],
    );
    return rows.map(mapRow);
  }

  async countByConversationId(conversationId) {
    const { rows } = await query(
      `SELECT COUNT(*) AS total FROM dbo.conversation_messages WHERE conversation_id = $1`,
      [conversationId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /**
   * Último mensaje por conversación (evita N+1 en listado).
   * @param {string[]} conversationIds
   */
  async getLastMessageByConversationIds(conversationIds) {
    if (!conversationIds?.length) return new Map();

    const placeholders = conversationIds.map((_, idx) => `$${idx + 1}`).join(', ');
    const { rows } = await query(
      `WITH ranked AS (
        SELECT m.*,
          ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC) AS rn
        FROM dbo.conversation_messages m
        WHERE m.conversation_id IN (${placeholders})
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

const conversationMessageRepository = new ConversationMessageRepository();
export default conversationMessageRepository;
