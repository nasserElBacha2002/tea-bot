import flowDocumentService from '../services/flow-document.service.js';
import flowValidator from '../utils/flow-validator.js';
import flowLoader from '../utils/flow-loader.js';
import { FlowFieldValidationError } from '../utils/flow-field-validation.js';
import { toFlowValidationErrorDetail } from '../utils/flow-validation-errors.js';
import { sendSuccess, sendError, sendApiError, HTTP_STATUS } from '../utils/http-errors.js';
import { FLOW_ERROR_MESSAGES } from '../utils/flow-management-errors.js';

function handleFlowError(res, error, fallbackStatus = HTTP_STATUS.BAD_REQUEST) {
  if (error.code && FLOW_ERROR_MESSAGES[error.code]) {
    return sendApiError(res, {
      error: error.code,
      message: error.apiMessage || error.message,
      status: error.httpStatus || fallbackStatus,
      details: error.details,
    });
  }
  return sendError(res, error.message, fallbackStatus);
}

/**
 * Listar todos los flujos draft.
 */
export const listDrafts = async (req, res) => {
  try {
    const drafts = await flowDocumentService.listDrafts();
    return sendSuccess(res, drafts);
  } catch (error) {
    return sendError(res, error.message);
  }
};

/**
 * Obtener un flujo draft por ID.
 */
export const getDraft = async (req, res) => {
  const { flowId } = req.params;
  try {
    const draft = await flowDocumentService.getDraft(flowId);
    if (!draft) return sendError(res, 'Flow no encontrado', HTTP_STATUS.NOT_FOUND);
    return sendSuccess(res, draft);
  } catch (error) {
    return sendError(res, error.message);
  }
};

/**
 * Crear un nuevo flujo draft.
 */
export const createFlow = async (req, res) => {
  const flow = req.body;
  
  if (!flow.id) return sendError(res, 'El campo "id" es obligatorio', HTTP_STATUS.BAD_REQUEST);

  try {
    const existing = await flowDocumentService.getDraft(flow.id);
    if (existing) return sendError(res, 'Ya existe un flujo con ese ID', HTTP_STATUS.CONFLICT);

    await flowDocumentService.saveDraft(flow);
    return sendSuccess(res, flow, HTTP_STATUS.CREATED);
  } catch (error) {
    return handleFlowError(res, error);
  }
};

/**
 * Actualizar un flujo draft.
 */
export const updateFlow = async (req, res) => {
  const { flowId } = req.params;
  const flow = req.body;

  if (flow.id && flow.id !== flowId) {
    return sendError(res, 'No se permite cambiar el ID del flujo en una actualización', HTTP_STATUS.BAD_REQUEST);
  }

  try {
    const existing = await flowDocumentService.getDraft(flowId);
    if (!existing) return sendError(res, 'Flow no encontrado', HTTP_STATUS.NOT_FOUND);

    const updatedFlow = { ...flow, id: flowId };
    await flowDocumentService.saveDraft(updatedFlow);
    return sendSuccess(res, updatedFlow);
  } catch (error) {
    return handleFlowError(res, error);
  }
};

/**
 * Duplicar un flujo draft.
 */
export const duplicateFlow = async (req, res) => {
  const { flowId } = req.params;
  const { newId } = req.body;

  if (!newId) return sendError(res, 'El campo "newId" es obligatorio', HTTP_STATUS.BAD_REQUEST);

  try {
    const duplicated = await flowDocumentService.duplicateDraft(flowId, newId);
    return sendSuccess(res, duplicated, HTTP_STATUS.CREATED);
  } catch (error) {
    return sendError(res, error.message);
  }
};

/**
 * Archivar un flujo draft.
 */
export const archiveFlow = async (req, res) => {
  const { flowId } = req.params;
  try {
    await flowDocumentService.archiveDraft(flowId);
    return sendSuccess(res, { message: 'Flujo archivado correctamente' });
  } catch (error) {
    return handleFlowError(res, error);
  }
};

/**
 * Publicar un flujo draft.
 */
export const publishFlow = async (req, res) => {
  const { flowId } = req.params;
  try {
    const published = await flowDocumentService.publishDraft(flowId);
    try {
      await flowLoader.reloadFlow(flowId);
    } catch (reloadErr) {
      return sendError(
        res,
        `Publicación creada (${published.version}) pero falló el refresco del runtime: ${reloadErr.message}`,
        HTTP_STATUS.INTERNAL_ERROR
      );
    }
    return sendSuccess(res, {
      flowId: published.id,
      version: published.version,
      publishedAt: published.publishedAt
    });
  } catch (error) {
    return handleFlowError(res, error);
  }
};

function formatValidateFlowError(error) {
  if (error instanceof FlowFieldValidationError) {
    const detail = toFlowValidationErrorDetail(error, {
      nodeKey: error.nodeId,
      transitionType: null,
      priority: null,
      transitionIndex: null,
    });
    return {
      error: 'FLOW_VALIDATION_FAILED',
      message: detail.message,
      details: { valid: false, errors: [detail] },
    };
  }

  return {
    error: 'FLOW_VALIDATION_FAILED',
    message: error.message,
    details: {
      valid: false,
      errors: [
        {
          code: 'FLOW_VALIDATION_ENGINE',
          message: error.message,
          nodeKey: null,
          path: null,
        },
      ],
    },
  };
}

/**
 * Validar un objeto de flujo sin persistir.
 */
export const validateFlow = async (req, res) => {
  const flow = req.body;
  try {
    flowValidator.validate(flow);
    return sendSuccess(res, { valid: true, errors: [] });
  } catch (error) {
    const payload = formatValidateFlowError(error);
    return sendApiError(res, {
      ...payload,
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }
};
