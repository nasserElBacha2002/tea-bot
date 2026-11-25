import conversationInboxService from '../services/conversation-inbox.service.js';
import conversationSearchService from '../services/conversation-search.service.js';
import conversationTakeoverService, {
  actorFromAdminUser,
} from '../services/conversation-takeover.service.js';
import { canTakeoverConversation } from '../auth/roles.js';
import { sendSuccess, sendApiError, HTTP_STATUS } from '../utils/http-errors.js';
import { finishConversationSearchRequest } from '../middleware/conversation-search-rate-limit.middleware.js';

function requireConversationOperator(req) {
  const actor = actorFromAdminUser(req.adminUser);
  if (!actor || !canTakeoverConversation(actor.role)) {
    const error = new Error('No tenés permiso para operar esta conversación.');
    error.code = 'FORBIDDEN';
    error.httpStatus = 403;
    error.apiError = 'FORBIDDEN';
    error.apiMessage = error.message;
    throw error;
  }
  return actor;
}

function handleServiceError(res, error) {
  if (error.code === 'CONVERSATION_PERSISTENCE_UNAVAILABLE') {
    return sendApiError(res, {
      error: error.apiError || error.code,
      message: error.apiMessage || error.message,
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      details: error.details,
    });
  }

  if (error.apiError || error.code) {
    const status = error.httpStatus || HTTP_STATUS.INTERNAL_ERROR;
    return sendApiError(res, {
      error: error.apiError || error.code,
      message: error.apiMessage || error.message,
      status,
      details: error.details,
    });
  }

  console.error('[ConversationsAPI] unexpected:', error.message);
  return sendApiError(res, {
    error: 'INTERNAL_ERROR',
    message: 'Error interno del servidor',
    status: HTTP_STATUS.INTERNAL_ERROR,
  });
}

function setSearchResponseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('Pragma', 'no-cache');
}

export const searchConversations = async (req, res) => {
  try {
    setSearchResponseHeaders(res);
    const data = await conversationSearchService.searchGlobal(req.body ?? {});
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  } finally {
    finishConversationSearchRequest(req);
  }
};

export const searchConversationMessages = async (req, res) => {
  try {
    setSearchResponseHeaders(res);
    const data = await conversationSearchService.searchMessagesInConversation(
      req.params.conversationId,
      req.body ?? {},
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  } finally {
    finishConversationSearchRequest(req);
  }
};

export const listConversations = async (req, res) => {
  try {
    const data = await conversationInboxService.listInboxConversations(req.query, req.adminUser);
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const getConversation = async (req, res) => {
  try {
    const data = await conversationInboxService.getConversationDetail(
      req.params.conversationId,
      req.adminUser,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const getConversationMessages = async (req, res) => {
  try {
    const data = await conversationInboxService.getConversationMessages(
      req.params.conversationId,
      req.query,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const getMessageAttachmentContent = async (req, res) => {
  try {
    const download = String(req.query.download || '') === '1' || req.query.download === 'true';
    await conversationInboxService.streamMessageAttachmentContent(
      req.params.conversationId,
      req.params.messageId,
      req.params.attachmentId,
      res,
      { download },
    );
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const claimConversation = async (req, res) => {
  try {
    const actor = requireConversationOperator(req);
    const data = await conversationInboxService.claimConversation(
      req.params.conversationId,
      actor.agentId,
      req.adminUser,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const sendAgentMessage = async (req, res) => {
  try {
    const actor = requireConversationOperator(req);
    const data = await conversationInboxService.sendAgentMessage(
      req.params.conversationId,
      req.body?.body,
      actor.agentId,
      req.adminUser,
      {
        attachment: req.body?.attachment,
        attachments: req.body?.attachments,
        clientRequestId: req.body?.clientRequestId,
        batchClientRequestId: req.body?.batchClientRequestId,
      },
    );
    const isBatch = Array.isArray(req.body?.attachments) && req.body.attachments.length > 0;
    const status = isBatch
      ? HTTP_STATUS.OK
      : HTTP_STATUS.CREATED;
    return sendSuccess(res, data, status);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const closeConversation = async (req, res) => {
  try {
    const actor = requireConversationOperator(req);
    const data = await conversationInboxService.closeConversation(
      req.params.conversationId,
      req.body?.resolutionNote,
      actor,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const updateConversationContact = async (req, res) => {
  try {
    const data = await conversationInboxService.updateConversationContact(
      req.params.conversationId,
      req.body?.name,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const takeoverConversation = async (req, res) => {
  try {
    const actor = actorFromAdminUser(req.adminUser);
    const data = await conversationTakeoverService.takeover({
      conversationId: req.params.conversationId,
      actor,
      reason: req.body?.reason,
      expectedVersion: req.body?.expectedVersion,
      clientRequestId: req.body?.clientRequestId,
    });
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const transferConversation = async (req, res) => {
  try {
    const actor = actorFromAdminUser(req.adminUser);
    const data = await conversationTakeoverService.reassign({
      conversationId: req.params.conversationId,
      actor,
      targetUsername: req.body?.targetUsername,
      reason: req.body?.reason,
    });
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const returnConversationToBot = async (req, res) => {
  try {
    const actor = requireConversationOperator(req);
    const data = await conversationInboxService.returnConversationToBot(
      req.params.conversationId,
      actor,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};
