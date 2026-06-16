import express from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import {
  listConversations,
  getConversation,
  getConversationMessages,
  claimConversation,
  sendAgentMessage,
  closeConversation,
  updateConversationContact,
  returnConversationToBot,
} from '../controllers/conversations.controller.js';

const router = express.Router();

router.use(requireAuth);

router.get('/', listConversations);
router.post('/:conversationId/claim', claimConversation);
router.post('/:conversationId/close', closeConversation);
router.patch('/:conversationId/contact', updateConversationContact);
router.post('/:conversationId/return-to-bot', returnConversationToBot);
router.get('/:conversationId/messages', getConversationMessages);
router.post('/:conversationId/messages', sendAgentMessage);
router.get('/:conversationId', getConversation);

export default router;
