import conversationRepository from '../repositories/conversation.repository.js';
import { validateContactEmail } from '../utils/contact-email.js';
import {
  enqueueEmailSheetSync,
  enqueueEmailSheetSyncForConversationIds,
  runCoordinatedEmailSheetSync,
} from './conversation-sheet-sync-recovery.service.js';
import { withTransaction } from '../db/index.js';
import { resolveContactEmailSourceEvent } from '../utils/contact-email-source-event.js';

/**
 * Returns stored email for a conversation row (already loaded).
 * @param {{ contactEmail?: string | null } | null | undefined} conversation
 */
export function getStoredContactEmail(conversation) {
  const email = conversation?.contactEmail;
  if (!email || typeof email !== 'string') return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

/**
 * Resolves email from conversation row or latest row for same phone/channel.
 */
export async function resolveContactEmail(conversation) {
  const direct = getStoredContactEmail(conversation);
  if (direct) return direct;
  if (!conversation?.phoneNumber || !conversation?.channel) return null;
  try {
    return await conversationRepository.findContactEmailByPhoneAndChannel(
      conversation.phoneNumber,
      conversation.channel,
    );
  } catch (error) {
    if (String(error?.message || '').includes('contact_email')) {
      return null;
    }
    throw error;
  }
}

async function persistContactEmailSql(conversation, email, eventAt, options = {}) {
  if (!eventAt) {
    return { updated: 0, skipped: true, reason: 'missing_event_at', conversationIds: [] };
  }
  if (conversation.phoneNumber && conversation.channel) {
    try {
      return await conversationRepository.syncContactEmailByPhoneAndChannel(
        conversation.phoneNumber,
        conversation.channel,
        email,
        eventAt,
        options,
      );
    } catch (error) {
      if (String(error?.message || '').includes('contact_email')) {
        return conversationRepository.syncContactEmailForConversationId(
          conversation.id,
          email,
          eventAt,
          options,
        );
      }
      throw error;
    }
  }
  return conversationRepository.syncContactEmailForConversationId(
    conversation.id,
    email,
    eventAt,
    options,
  );
}

/**
 * Persists email at contact level (synced across conversations with same phone + channel).
 */
export async function saveContactEmailForConversation(conversation, rawEmail, options = {}) {
  if (!conversation?.id) {
    throw new Error('No se puede guardar el email sin una conversación asociada.');
  }

  const validation = validateContactEmail(rawEmail);
  if (!validation.valid) {
    const err = new Error(validation.message);
    err.code = 'INVALID_CONTACT_EMAIL';
    err.httpStatus = 400;
    throw err;
  }

  const email = validation.normalized;
  const source = resolveContactEmailSourceEvent(options);
  const existing = await resolveContactEmail(conversation);

  if (existing === email) {
    let sqlResult = { updated: 0, skipped: true, conversationIds: [] };
    let sheetJobEnqueued = false;

    if (source.allowSqlWrite && source.eventAt) {
      await withTransaction(async (transaction) => {
        sqlResult = await persistContactEmailSql(conversation, email, source.eventAt, { transaction });
        if (!sqlResult.skipped && sqlResult.updated > 0) {
          const targets = sqlResult.conversationIds?.length
            ? sqlResult.conversationIds
            : [conversation.id];
          await enqueueEmailSheetSyncForConversationIds(targets, email, { transaction });
          sheetJobEnqueued = true;
        }
      });
    }

    if (!sheetJobEnqueued) {
      await enqueueEmailSheetSync(conversation.id, email);
    }

    const sync = await runCoordinatedEmailSheetSync(conversation.id, email);
    if (sync.skipped && sync.pendingRecovery) {
      return {
        email,
        updated: sqlResult.updated > 0,
        sheetPending: true,
        evidenceAdvanced: sqlResult.updated > 0,
      };
    }

    return {
      email,
      updated: sqlResult.updated > 0,
      evidenceAdvanced: sqlResult.updated > 0,
      sheetSync: sync,
    };
  }

  if (!source.allowSqlWrite) {
    const err = new Error('Falta timestamp confiable del evento de captura.');
    err.code = 'MISSING_SOURCE_EVENT_AT';
    err.httpStatus = 409;
    throw err;
  }

  let sqlResult = { updated: 0, skipped: true, conversationIds: [] };
  if (!conversationRepository.isEnabled()) {
    throw new Error('Conversation DB disabled');
  }

  await withTransaction(async (transaction) => {
    sqlResult = await persistContactEmailSql(conversation, email, source.eventAt, { transaction });
    if (sqlResult.skipped) return;
    if (sqlResult.updated > 0) {
      const targets = sqlResult.conversationIds?.length
        ? sqlResult.conversationIds
        : [conversation.id];
      await enqueueEmailSheetSyncForConversationIds(targets, email, { transaction });
    }
  });

  if (sqlResult.skipped) {
    return { email: existing || email, updated: false, precedenceRejected: true };
  }

  const sync = await runCoordinatedEmailSheetSync(conversation.id, email);
  if (sync.skipped && sync.pendingRecovery) {
    return { email, updated: true, sheetPending: true };
  }

  return { email, updated: true, sheetSync: sync };
}