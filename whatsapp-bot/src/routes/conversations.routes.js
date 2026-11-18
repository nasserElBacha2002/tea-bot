import express from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import { requireConversationsInbox } from '../middleware/require-conversations-inbox.middleware.js';
import {
  listConversations,
  getConversation,
  getConversationMessages,
  getMessageAttachmentContent,
  claimConversation,
  takeoverConversation,
  transferConversation,
  sendAgentMessage,
  closeConversation,
  updateConversationContact,
  returnConversationToBot,
} from '../controllers/conversations.controller.js';

const router = express.Router();

router.use(requireAuth);
router.use(requireConversationsInbox);

router.get('/', listConversations);
router.post('/:conversationId/claim', claimConversation);
router.post('/:conversationId/takeover', takeoverConversation);
router.post('/:conversationId/transfer', transferConversation);
router.post('/:conversationId/close', closeConversation);
router.patch('/:conversationId/contact', updateConversationContact);
router.post('/:conversationId/return-to-bot', returnConversationToBot);
router.get('/:conversationId/messages', getConversationMessages);
router.get(
  '/:conversationId/messages/:messageId/attachments/:attachmentId/content',
  getMessageAttachmentContent,
);
router.post('/:conversationId/messages', sendAgentMessage);
router.get('/:conversationId', getConversation);

export default router;
