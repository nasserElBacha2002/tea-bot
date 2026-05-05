import flowRepository from '../repositories/flow.repository.js';
import flowLoader from '../utils/flow-loader.js';
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

/**
 * POST /:flowId/versions/import-json
 * Body: { flow: object, publish?: boolean }
 */
export const importJsonAsNewVersion = async (req, res) => {
  const { flowId } = req.params;
  const payloadFlow = req.body?.flow;
  const publish = Boolean(req.body?.publish);

  if (!payloadFlow || typeof payloadFlow !== 'object' || Array.isArray(payloadFlow)) {
    return sendError(res, 'El body debe incluir "flow" como objeto JSON válido.', HTTP_STATUS.BAD_REQUEST);
  }

  const bodyFlowId = typeof payloadFlow.id === 'string' ? payloadFlow.id.trim() : null;
  if (bodyFlowId && bodyFlowId !== flowId) {
    return sendError(
      res,
      `El id del JSON ("${bodyFlowId}") no coincide con el flowId de la URL ("${flowId}").`,
      HTTP_STATUS.BAD_REQUEST
    );
  }

  try {
    const imported = await flowRepository.importPublishedVersionFromJson(flowId, payloadFlow, { publish });
    if (imported.wasActivated) {
      try {
        await flowLoader.reloadFlow(flowId);
      } catch (reloadErr) {
        return sendError(
          res,
          `Importación creada (${imported.createdVersion}) pero falló el refresco del runtime: ${reloadErr.message}`,
          HTTP_STATUS.INTERNAL_ERROR
        );
      }
    }
    return sendSuccess(
      res,
      {
        flowId,
        version: imported.createdVersion,
        activeVersion: imported.activeVersion,
        activated: imported.wasActivated,
        publishedAt: imported.flow.publishedAt,
        flow: imported.flow
      },
      HTTP_STATUS.CREATED
    );
  } catch (error) {
    return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
  }
};
