import flowRepository from '../repositories/flow.repository.js';
import { sendSuccess, sendError, HTTP_STATUS } from '../utils/http-errors.js';

function isNotFoundMessage(msg) {
  return (
    msg.includes('no encontrada') ||
    msg.includes('No hay versiones') ||
    msg.includes('Versión inválida') ||
    msg.includes('no resuelve')
  );
}

/**
 * GET /:flowId/versions
 */
export const listPublishedVersions = async (req, res) => {
  const { flowId } = req.params;
  try {
    const summary = await flowRepository.listVersionSummary(flowId);
    if (!summary) {
      return sendSuccess(res, {
        flowId,
        activeVersion: null,
        lastPublishedAt: null,
        updatedAt: null,
        versions: []
      });
    }
    return sendSuccess(res, summary);
  } catch (error) {
    if (error.message.includes('corrupta')) {
      return sendError(res, error.message, HTTP_STATUS.INTERNAL_ERROR);
    }
    return sendError(res, error.message, HTTP_STATUS.INTERNAL_ERROR);
  }
};

/**
 * GET /:flowId/versions/:version
 */
export const getPublishedVersionDetail = async (req, res) => {
  const { flowId, version } = req.params;
  try {
    const doc = await flowRepository.getPublishedVersionDocument(flowId, version);
    return sendSuccess(res, {
      version: doc.normalizedVersion,
      publishedAt: doc.entry.publishedAt,
      isActive: doc.isActive,
      activeVersion: doc.meta.activeVersion,
      flow: doc.flow
    });
  } catch (error) {
    if (isNotFoundMessage(error.message)) {
      return sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
    return sendError(res, error.message, HTTP_STATUS.INTERNAL_ERROR);
  }
};

/**
 * POST /:flowId/versions/:version/duplicate-to-draft
 * Body: { overwriteDraft?: boolean }
 */
export const duplicatePublishedVersionToDraft = async (req, res) => {
  const { flowId, version } = req.params;
  const overwriteDraft = Boolean(req.body?.overwriteDraft);

  try {
    const draft = await flowRepository.duplicatePublishedVersionToDraft(flowId, version, {
      overwriteDraft
    });
    return sendSuccess(res, draft);
  } catch (error) {
    if (error.code === 'CONFLICT') {
      return sendError(res, error.message, HTTP_STATUS.CONFLICT);
    }
    if (isNotFoundMessage(error.message)) {
      return sendError(res, error.message, HTTP_STATUS.NOT_FOUND);
    }
    if (error.message.includes('corrupta')) {
      return sendError(res, error.message, HTTP_STATUS.INTERNAL_ERROR);
    }
    return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
  }
};
