import conversationSearchRepository from '../repositories/conversation-search.repository.js';
import { ensureConversationDbReady } from '../db/conversation-db-health.js';
import {
  buildLikePattern,
  buildSnippet,
  decodeSearchCursor,
  encodeSearchCursor,
  isUuid,
  parseSearchGroups,
  parseSearchLimit,
  validateSearchQuery,
} from '../utils/conversation-search.js';

function appError(code, message, httpStatus = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.httpStatus = httpStatus;
  err.apiError = code;
  err.apiMessage = message;
  if (details) err.details = details;
  return err;
}

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return String(value);
  return new Date(parsed).toISOString();
}

function mapContactItem(row) {
  return {
    conversationId: row.id,
    displayName: row.displayName ?? null,
    phoneNumber: row.phoneNumber ?? null,
    matchKind: row.matchKind,
    lastMessageAt: toIso(row.lastMessageAt),
  };
}

function mapMessageHit(row, searchTerm) {
  const { snippet, highlightStart, highlightEnd } = buildSnippet(row.body, searchTerm);
  return {
    conversationId: row.conversationId,
    messageId: row.id,
    displayName: row.displayName ?? null,
    phoneNumber: row.phoneNumber ?? null,
    direction: row.direction,
    senderType: row.senderType,
    createdAt: toIso(row.createdAt),
    snippet,
    highlightStart,
    highlightEnd,
  };
}

class ConversationSearchService {
  async ensureReady() {
    const ready = await ensureConversationDbReady();
    if (!ready.ok) {
      throw appError('CONVERSATION_PERSISTENCE_UNAVAILABLE', ready.message, 503, ready);
    }
  }

  parseCursors({ q, cursorContact, cursorMessage, conversationId = null }) {
    const contactCtx = { scope: 'contact', q, conversationId: null };
    const contact = cursorContact ? decodeSearchCursor(cursorContact, contactCtx) : null;
    if (cursorContact && !contact) {
      throw appError('VALIDATION', 'cursorContact inválido', 400);
    }
    const messageCtx = { scope: 'message_global', q, conversationId: null };
    const message = cursorMessage ? decodeSearchCursor(cursorMessage, messageCtx) : null;
    if (cursorMessage && !message) {
      throw appError('VALIDATION', 'cursorMessage inválido', 400);
    }
    return { contact, message };
  }

  async searchGlobal(body = {}) {
    await this.ensureReady();
    const validated = validateSearchQuery(body.q);
    if (!validated.ok) {
      throw appError('VALIDATION', validated.message, 400);
    }
    const limitParsed = parseSearchLimit(body.limit);
    if (!limitParsed.ok) {
      throw appError('VALIDATION', limitParsed.message, 400);
    }
    const groupsParsed = parseSearchGroups(body.groups);
    if (!groupsParsed.ok) {
      throw appError('VALIDATION', groupsParsed.message, 400);
    }
  const limit = limitParsed.limit;
    const pattern = buildLikePattern(validated.term);
    const { contact: contactCursor, message: messageCursor } = this.parseCursors({
      ...body,
      q: validated.term,
    });

    const runContacts = groupsParsed.groups === 'both' || groupsParsed.groups === 'contacts';
    const runMessages = groupsParsed.groups === 'both' || groupsParsed.groups === 'messages';

    if (groupsParsed.groups === 'contacts' && body.cursorMessage) {
      throw appError('VALIDATION', 'cursorMessage no aplica con groups=contacts', 400);
    }
    if (groupsParsed.groups === 'messages' && body.cursorContact) {
      throw appError('VALIDATION', 'cursorContact no aplica con groups=messages', 400);
    }

    const settled = await Promise.allSettled([
      runContacts
        ? conversationSearchRepository.searchContacts({
          pattern,
          limit,
          cursor: contactCursor,
        })
        : Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
      runMessages
        ? conversationSearchRepository.searchMessagesGlobal({
          pattern,
          limit,
          cursor: messageCursor,
        })
        : Promise.resolve({ items: [], hasMore: false, nextCursor: null }),
    ]);
    const failures = settled.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      throw failures[0].reason;
    }
    const contacts = settled[0].value;
    const messages = settled[1].value;

    return {
      groups: groupsParsed.groups,
      contacts: {
        items: contacts.items.map(mapContactItem),
        nextCursor: contacts.nextCursor
          ? encodeSearchCursor(contacts.nextCursor, { scope: 'contact', q: validated.term })
          : null,
      },
      messages: {
        items: messages.items.map((row) => mapMessageHit(row, validated.term)),
        nextCursor: messages.nextCursor
          ? encodeSearchCursor(messages.nextCursor, { scope: 'message_global', q: validated.term })
          : null,
      },
    };
  }

  async searchMessagesInConversation(conversationId, body = {}) {
    await this.ensureReady();
    if (!isUuid(conversationId)) {
      throw appError('VALIDATION', 'Identificador de conversación inválido', 400);
    }
    const conversation = await conversationSearchRepository.getConversationById(conversationId);
    if (!conversation) {
      throw appError('NOT_FOUND', 'Conversación no encontrada', 404);
    }

    const validated = validateSearchQuery(body.q);
    if (!validated.ok) {
      throw appError('VALIDATION', validated.message, 400);
    }
    const limitParsed = parseSearchLimit(body.limit);
    if (!limitParsed.ok) {
      throw appError('VALIDATION', limitParsed.message, 400);
    }
    const limit = limitParsed.limit;
    const pattern = buildLikePattern(validated.term);
    const cursorRaw = body.cursor;
    const cursor = cursorRaw
      ? decodeSearchCursor(cursorRaw, {
        scope: 'message_in_conversation',
        q: validated.term,
        conversationId,
      })
      : null;
    if (cursorRaw && !cursor) {
      throw appError('VALIDATION', 'cursor inválido', 400);
    }

    const result = await conversationSearchRepository.searchMessagesInConversation(
      conversationId,
      { pattern, limit, cursor },
    );

    return {
      items: result.items.map((row) => ({
        ...mapMessageHit(
          {
            ...row,
            displayName: conversation.displayName,
            phoneNumber: conversation.phoneNumber,
          },
          validated.term,
        ),
      })),
      nextCursor: result.nextCursor
        ? encodeSearchCursor(result.nextCursor, {
          scope: 'message_in_conversation',
          q: validated.term,
          conversationId,
        })
        : null,
    };
  }
}

const conversationSearchService = new ConversationSearchService();
export default conversationSearchService;