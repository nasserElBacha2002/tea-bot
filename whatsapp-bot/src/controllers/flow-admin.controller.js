import flowRepository from '../repositories/flow.repository.js';
import flowValidator from '../utils/flow-validator.js';
import flowLoader from '../utils/flow-loader.js';
import { sendSuccess, sendError, HTTP_STATUS } from '../utils/http-errors.js';

/**
 * Listar todos los flujos draft.
 */
export const listDrafts = async (req, res) => {
  try {
    const drafts = await flowRepository.listDrafts();
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
    const draft = await flowRepository.getDraft(flowId);
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
    const existing = await flowRepository.getDraft(flow.id);
    if (existing) return sendError(res, 'Ya existe un flujo con ese ID', HTTP_STATUS.CONFLICT);

    await flowRepository.saveDraft(flow);
    return sendSuccess(res, flow, HTTP_STATUS.CREATED);
  } catch (error) {
    return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
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
    const existing = await flowRepository.getDraft(flowId);
    if (!existing) return sendError(res, 'Flow no encontrado', HTTP_STATUS.NOT_FOUND);

    const updatedFlow = { ...flow, id: flowId };
    await flowRepository.saveDraft(updatedFlow);
    return sendSuccess(res, updatedFlow);
  } catch (error) {
    return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
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
    const duplicated = await flowRepository.duplicateDraft(flowId, newId);
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
    await flowRepository.archiveDraft(flowId);
    return sendSuccess(res, { message: 'Flujo archivado correctamente' });
  } catch (error) {
    return sendError(res, error.message);
  }
};

/**
 * Publicar un flujo draft.
 */
export const publishFlow = async (req, res) => {
  const { flowId } = req.params;
  try {
    const published = await flowRepository.publishDraft(flowId);
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
    return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
  }
};

/**
 * Validar un objeto de flujo sin persistir.
 */
export const validateFlow = async (req, res) => {
  const flow = req.body;
  try {
    flowValidator.validate(flow);
    return sendSuccess(res, { valid: true });
  } catch (error) {
    return sendError(res, error.message, HTTP_STATUS.BAD_REQUEST);
  }
};
