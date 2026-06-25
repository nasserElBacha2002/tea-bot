import conversationRepository from '../repositories/conversation.repository.js';
import { validateContactEmail } from '../utils/contact-email.js';

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

/**
 * Persists email at contact level (synced across conversations with same phone + channel).
 * If the contact already has the same email, this is a no-op update.
 * If a different email is sent later, it updates to the latest valid value.
 */
export async function saveContactEmailForConversation(conversation, rawEmail) {
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
  const existing = await resolveContactEmail(conversation);
  if (existing === email) {
    return { email, updated: false };
  }

  if (conversation.phoneNumber && conversation.channel) {
    try {
      await conversationRepository.syncContactEmailByPhoneAndChannel(
        conversation.phoneNumber,
        conversation.channel,
        email,
      );
    } catch (error) {
      if (String(error?.message || '').includes('contact_email')) {
        await conversationRepository.updateConversation(conversation.id, { contactEmail: email });
      } else {
        throw error;
      }
    }
  } else {
    await conversationRepository.updateConversation(conversation.id, { contactEmail: email });
  }

  return { email, updated: true };
}
