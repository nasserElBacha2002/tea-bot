import conversationRepository from '../repositories/conversation.repository.js';
import conversationMessageRepository from '../repositories/conversation-message.repository.js';
import attachmentRepository from '../repositories/conversation-message-attachment.repository.js';
import { notifyConversationMessageUpdated } from '../realtime/conversation-live.notify.js';

export async function publishInboundAttachmentMessageUpdate(messageId, conversationId) {
  if (!messageId || !conversationId) return;
  const [conversation, message, attachments] = await Promise.all([
    conversationRepository.getConversationById(conversationId),
    conversationMessageRepository.findById(messageId),
    attachmentRepository.findByMessageId(messageId),
  ]);
  if (!conversation || !message) return;
  notifyConversationMessageUpdated(conversation, message, { attachments });
}