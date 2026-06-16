import conversationInboxService from '../services/conversation-inbox.service.js';
import { resolveAgentIdFromRequest } from '../utils/agent-identity.js';
import { sendSuccess, sendApiError, HTTP_STATUS } from '../utils/http-errors.js';

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
    });
  }

  console.error('[ConversationsAPI] unexpected:', error.message);
  return sendApiError(res, {
    error: 'INTERNAL_ERROR',
    message: 'Error interno del servidor',
    status: HTTP_STATUS.INTERNAL_ERROR,
  });
}

export const listConversations = async (req, res) => {
  try {
    const data = await conversationInboxService.listInboxConversations(req.query);
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const getConversation = async (req, res) => {
  try {
    const data = await conversationInboxService.getConversationDetail(
      req.params.conversationId,
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

export const claimConversation = async (req, res) => {
  try {
    const agentId = resolveAgentIdFromRequest(req);
    const data = await conversationInboxService.claimConversation(
      req.params.conversationId,
      agentId,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const sendAgentMessage = async (req, res) => {
  try {
    const agentId = resolveAgentIdFromRequest(req);
    const data = await conversationInboxService.sendAgentMessage(
      req.params.conversationId,
      req.body?.body,
      agentId,
    );
    return sendSuccess(res, data, HTTP_STATUS.CREATED);
  } catch (error) {
    return handleServiceError(res, error);
  }
};

export const closeConversation = async (req, res) => {
  try {
    const data = await conversationInboxService.closeConversation(
      req.params.conversationId,
      req.body?.resolutionNote,
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

export const returnConversationToBot = async (req, res) => {
  try {
    const data = await conversationInboxService.returnConversationToBot(
      req.params.conversationId,
    );
    return sendSuccess(res, data);
  } catch (error) {
    return handleServiceError(res, error);
  }
};
