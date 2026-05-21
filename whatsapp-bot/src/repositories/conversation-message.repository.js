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

  async listByConversationId(conversationId, limit = 100) {
    const { rows } = await query(
      `SELECT TOP ($2) * FROM dbo.conversation_messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [conversationId, limit],
    );
    return rows.map(mapRow);
  }
}

const conversationMessageRepository = new ConversationMessageRepository();
export default conversationMessageRepository;
