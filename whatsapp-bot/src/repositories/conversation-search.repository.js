import { query } from '../db/index.js';
import conversationRepository from './conversation.repository.js';
import { sqlCollateSuffix } from '../utils/conversation-search.js';
import { mapMessageRecord } from './conversation-message.repository.js';

const COLLATE = sqlCollateSuffix();
const CONTACT_NULL_SORT = '0001-01-01T00:00:00.0000000';
const CONTACT_SORT_TS = `COALESCE(c.last_message_at, CAST('${CONTACT_NULL_SORT}' AS DATETIME2(7)))`;
const MSG_TS_KEYSET = 'CONVERT(VARCHAR(27), m.created_at, 127)';
const CONTACT_TS_KEYSET = 'CONVERT(VARCHAR(27), c.last_message_at, 127)';

/** Pasa timestamps de cursor como literal ISO/param sin perder el valor del cursor decodificado. */
function cursorDateParam(createdAt) {
  if (createdAt == null || createdAt === '') return null;
  if (createdAt instanceof Date) {
    return createdAt.toISOString();
  }
  const text = String(createdAt).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(text)) return text;
  if (Number.isNaN(Date.parse(text))) return text;
  return new Date(text).toISOString();
}

function sqlKeysetTimestamp(value, keysetField) {
  if (keysetField != null && String(keysetField).trim() !== '') {
    return String(keysetField).trim();
  }
  return cursorDateParam(value);
}

function mapMessageRow(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction,
    senderType: row.sender_type,
    body: row.body,
    createdAt: row.created_at,
    createdAtKeyset: row.created_at_keyset ?? null,
    displayName: row.display_name ?? null,
    phoneNumber: row.phone_number ?? null,
  };
}

function mapContactRow(row) {
  return {
    id: row.id,
    displayName: row.display_name ?? null,
    phoneNumber: row.phone_number ?? null,
    lastMessageAt: row.last_message_at ?? null,
    lastMessageAtKeyset: row.last_message_at_keyset ?? null,
    matchKind: row.match_kind,
  };
}

class ConversationSearchRepository {
  async searchContacts({ pattern, limit, cursor }) {
    const values = [pattern];
    let cursorClause = '';
    if (cursor?.id) {
      const sortTs = cursor.createdAt != null && cursor.createdAt !== ''
        ? cursorDateParam(cursor.createdAt)
        : CONTACT_NULL_SORT;
      cursorClause = `AND (
        ${CONTACT_SORT_TS} < $2
        OR (${CONTACT_SORT_TS} = $2 AND c.id < $3)
      )`;
      values.push(sortTs, cursor.id);
    }

    const { rows } = await query(
      `SELECT TOP (${limit + 1}) c.id, c.display_name, c.phone_number, c.last_message_at,
        ${CONTACT_TS_KEYSET} AS last_message_at_keyset,
        CASE
          WHEN c.phone_number COLLATE ${COLLATE} LIKE $1 COLLATE ${COLLATE} ESCAPE '\\' THEN N'phone'
          ELSE N'name'
        END AS match_kind
      FROM dbo.conversations c
      WHERE (
        c.phone_number COLLATE ${COLLATE} LIKE $1 COLLATE ${COLLATE} ESCAPE '\\'
        OR c.display_name COLLATE ${COLLATE} LIKE $1 COLLATE ${COLLATE} ESCAPE '\\'
      )
      ${cursorClause}
      ORDER BY ${CONTACT_SORT_TS} DESC, c.id DESC`,
      values,
    );

    const items = rows.slice(0, limit).map(mapContactRow);
    const hasMore = rows.length > limit;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? {
        createdAt: last.lastMessageAt == null
          ? null
          : sqlKeysetTimestamp(last.lastMessageAt, last.lastMessageAtKeyset),
        id: last.id,
      }
      : null;
    return { items, hasMore, nextCursor };
  }

  async searchMessagesGlobal({ pattern, limit, cursor }) {
    const values = [pattern];
    let cursorClause = '';
    if (cursor?.id && cursor?.createdAt) {
      cursorClause = `AND (
        m.created_at < $2
        OR (m.created_at = $2 AND m.id < $3)
      )`;
      values.push(cursorDateParam(cursor.createdAt), cursor.id);
    }

    const { rows } = await query(
      `SELECT TOP (${limit + 1})
        m.id, m.conversation_id, m.direction, m.sender_type, m.body, m.created_at,
        ${MSG_TS_KEYSET} AS created_at_keyset,
        c.display_name, c.phone_number
      FROM dbo.conversation_messages m
      INNER JOIN dbo.conversations c ON c.id = m.conversation_id
      WHERE m.body COLLATE ${COLLATE} LIKE $1 COLLATE ${COLLATE} ESCAPE '\\'
        AND m.sender_type IN (N'user', N'bot', N'agent', N'system')
        AND LEN(LTRIM(RTRIM(m.body))) > 0
        ${cursorClause}
      ORDER BY m.created_at DESC, m.id DESC`,
      values,
    );

    const items = rows.slice(0, limit).map(mapMessageRow);
    const hasMore = rows.length > limit;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? { createdAt: sqlKeysetTimestamp(last.createdAt, last.createdAtKeyset), id: last.id }
      : null;
    return { items, hasMore, nextCursor };
  }

  async searchMessagesInConversation(conversationId, { pattern, limit, cursor }) {
    const values = [conversationId, pattern];
    let cursorClause = '';
    if (cursor?.id && cursor?.createdAt) {
      cursorClause = `AND (
        m.created_at < $3
        OR (m.created_at = $3 AND m.id < $4)
      )`;
      values.push(cursorDateParam(cursor.createdAt), cursor.id);
    }

    const { rows } = await query(
      `SELECT TOP (${limit + 1}) m.id, m.conversation_id, m.direction, m.sender_type, m.body, m.created_at,
        ${MSG_TS_KEYSET} AS created_at_keyset
      FROM dbo.conversation_messages m
      WHERE m.conversation_id = $1
        AND m.body COLLATE ${COLLATE} LIKE $2 COLLATE ${COLLATE} ESCAPE '\\'
        AND m.sender_type IN (N'user', N'bot', N'agent', N'system')
        AND LEN(LTRIM(RTRIM(m.body))) > 0
        ${cursorClause}
      ORDER BY m.created_at DESC, m.id DESC`,
      values,
    );

    const items = rows.slice(0, limit).map((row) => mapMessageRow(row));
    const hasMore = rows.length > limit;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last
      ? { createdAt: sqlKeysetTimestamp(last.createdAt, last.createdAtKeyset), id: last.id }
      : null;
    return { items, hasMore, nextCursor };
  }

  async findMessageInConversation(conversationId, messageId) {
    const { rows } = await query(
      `SELECT TOP (1) id, conversation_id, created_at,
        CONVERT(VARCHAR(27), created_at, 127) AS created_at_keyset
       FROM dbo.conversation_messages
       WHERE id = $1 AND conversation_id = $2`,
      [messageId, conversationId],
    );
    return rows[0] || null;
  }

  /**
   * Ventana count-based con keyset (sin COUNT(*) total).
   */
  async listAroundMessage(conversationId, messageId, { before = 40, after = 40 } = {}) {
    const anchor = await this.findMessageInConversation(conversationId, messageId);
    if (!anchor) return null;

    const beforeLimit = before + 1;
    const afterLimit = after + 1;
    const createdAt = sqlKeysetTimestamp(anchor.created_at, anchor.created_at_keyset);
    const id = anchor.id;

    const [beforeRows, afterRows, focusRows] = await Promise.all([
      query(
        `SELECT TOP (${beforeLimit}) m.*
         FROM dbo.conversation_messages m
         WHERE m.conversation_id = $1
           AND (
             m.created_at < $2
             OR (m.created_at = $2 AND m.id < $3)
           )
         ORDER BY m.created_at DESC, m.id DESC`,
        [conversationId, createdAt, id],
      ),
      query(
        `SELECT TOP (${afterLimit}) m.*
         FROM dbo.conversation_messages m
         WHERE m.conversation_id = $1
           AND (
             m.created_at > $2
             OR (m.created_at = $2 AND m.id > $3)
           )
         ORDER BY m.created_at ASC, m.id ASC`,
        [conversationId, createdAt, id],
      ),
      query(
        `SELECT TOP (1) m.* FROM dbo.conversation_messages m WHERE m.id = $1`,
        [messageId],
      ),
    ]);

    const hasMoreBefore = (beforeRows.rows?.length ?? 0) > before;
    const hasMoreAfter = (afterRows.rows?.length ?? 0) > after;
    const beforeItems = (beforeRows.rows ?? []).slice(0, before).reverse();
    const afterItems = (afterRows.rows ?? []).slice(0, after);
    const focus = focusRows.rows?.[0];
    const merged = [...beforeItems, ...(focus ? [focus] : []), ...afterItems];
    const items = merged.map(mapMessageRecord).filter(Boolean);
    if (!items.some((m) => m.id === messageId)) {
      return null;
    }

    return {
      items,
      focusMessageId: messageId,
      hasMoreBefore,
      hasMoreAfter,
    };
  }

  async listBeforeMessage(conversationId, messageId, limit = 50) {
    const anchor = await this.findMessageInConversation(conversationId, messageId);
    if (!anchor) return null;
    const { rows } = await query(
      `SELECT TOP (${limit + 1}) m.*
       FROM dbo.conversation_messages m
       WHERE m.conversation_id = $1
         AND (
           m.created_at < $2
           OR (m.created_at = $2 AND m.id < $3)
         )
       ORDER BY m.created_at DESC, m.id DESC`,
      [conversationId, sqlKeysetTimestamp(anchor.created_at, anchor.created_at_keyset), anchor.id],
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).reverse().map(mapMessageRecord).filter(Boolean);
    return { items, hasMoreBefore: hasMore, anchorMessageId: messageId };
  }

  async listAfterMessage(conversationId, messageId, limit = 50) {
    const anchor = await this.findMessageInConversation(conversationId, messageId);
    if (!anchor) return null;
    const { rows } = await query(
      `SELECT TOP (${limit + 1}) m.*
       FROM dbo.conversation_messages m
       WHERE m.conversation_id = $1
         AND (
           m.created_at > $2
           OR (m.created_at = $2 AND m.id > $3)
         )
       ORDER BY m.created_at ASC, m.id ASC`,
      [conversationId, sqlKeysetTimestamp(anchor.created_at, anchor.created_at_keyset), anchor.id],
    );
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapMessageRecord).filter(Boolean);
    return { items, hasMoreAfter: hasMore, anchorMessageId: messageId };
  }

  async getConversationById(id) {
    return conversationRepository.getConversationById(id);
  }
}

const conversationSearchRepository = new ConversationSearchRepository();
export default conversationSearchRepository;