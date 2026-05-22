import flowManagementService from '../services/flow-management.service.js';
import { sendSuccess, sendApiError, HTTP_STATUS } from '../utils/http-errors.js';
import { FLOW_ERROR_MESSAGES } from '../utils/flow-management-errors.js';

function handleError(res, error) {
  if (error.code && FLOW_ERROR_MESSAGES[error.code]) {
    return sendApiError(res, {
      error: error.code,
      message: error.apiMessage || error.message,
      status: error.httpStatus || HTTP_STATUS.BAD_REQUEST,
      details: error.details,
    });
  }
  console.error('[FlowManagementAPI]', error.message);
  return sendApiError(res, {
    error: 'INTERNAL_ERROR',
    message: 'Error interno del servidor',
    status: HTTP_STATUS.INTERNAL_ERROR,
  });
}

export const listFlows = async (req, res) => {
  try {
    const data = await flowManagementService.listFlows();
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getFlowDetail = async (req, res) => {
  try {
    const data = await flowManagementService.getFlowDetail(req.params.flowId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const listFlowVersions = async (req, res) => {
  try {
    const data = await flowManagementService.listFlowVersions(req.params.flowId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getVersionDetail = async (req, res) => {
  try {
    const data = await flowManagementService.getVersionDetail(req.params.versionId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const getVersionSnapshot = async (req, res) => {
  try {
    const data = await flowManagementService.getVersionSnapshot(req.params.versionId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const createDraft = async (req, res) => {
  try {
    const { baseVersionId } = req.body || {};
    if (!baseVersionId) {
      return sendApiError(res, {
        error: 'BAD_REQUEST',
        message: 'baseVersionId es obligatorio.',
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }
    const draft = await flowManagementService.createDraft(req.params.flowId, baseVersionId);
    return sendSuccess(res, { version: draft }, HTTP_STATUS.CREATED);
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateVersion = async (req, res) => {
  try {
    const version = await flowManagementService.updateVersionMetadata(
      req.params.versionId,
      req.body || {},
    );
    return sendSuccess(res, { version });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createNode = async (req, res) => {
  try {
    const node = await flowManagementService.createNode(req.params.versionId, req.body || {});
    return sendSuccess(res, { node }, HTTP_STATUS.CREATED);
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateNode = async (req, res) => {
  try {
    const node = await flowManagementService.updateNode(req.params.nodeId, req.body || {});
    return sendSuccess(res, { node });
  } catch (error) {
    return handleError(res, error);
  }
};

export const deleteNode = async (req, res) => {
  try {
    await flowManagementService.deleteNode(req.params.nodeId);
    return sendSuccess(res, { discarded: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const createTransition = async (req, res) => {
  try {
    const transition = await flowManagementService.createTransition(
      req.params.nodeId,
      req.body || {},
    );
    return sendSuccess(res, { transition }, HTTP_STATUS.CREATED);
  } catch (error) {
    return handleError(res, error);
  }
};

export const updateTransition = async (req, res) => {
  try {
    const transition = await flowManagementService.updateTransition(
      req.params.transitionId,
      req.body || {},
    );
    return sendSuccess(res, { transition });
  } catch (error) {
    return handleError(res, error);
  }
};

export const deleteTransition = async (req, res) => {
  try {
    await flowManagementService.deleteTransition(req.params.transitionId);
    return sendSuccess(res, { deleted: true });
  } catch (error) {
    return handleError(res, error);
  }
};

export const validateVersion = async (req, res) => {
  try {
    const data = await flowManagementService.validateVersion(req.params.versionId);
    return sendSuccess(res, data);
  } catch (error) {
    return handleError(res, error);
  }
};

export const publishVersion = async (req, res) => {
  try {
    const result = await flowManagementService.publishDraft(req.params.versionId);
    return sendSuccess(res, result);
  } catch (error) {
    return handleError(res, error);
  }
};

export const rollbackVersion = async (req, res) => {
  try {
    const publishImmediately = Boolean(req.body?.publishImmediately);
    const result = await flowManagementService.rollback(req.params.versionId, {
      publishImmediately,
    });
    return sendSuccess(res, result, HTTP_STATUS.CREATED);
  } catch (error) {
    return handleError(res, error);
  }
};

export const discardDraft = async (req, res) => {
  try {
    await flowManagementService.discardDraft(req.params.versionId);
    return sendSuccess(res, { discarded: true });
  } catch (error) {
    return handleError(res, error);
  }
};
