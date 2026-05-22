import flowDocumentService from '../services/flow-document.service.js';
import { HTTP_STATUS } from '../utils/http-errors.js';

function sendExportJson(res, { document, filename }) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.status(HTTP_STATUS.OK).send(`${JSON.stringify(document, null, 2)}\n`);
}

function handleExportError(res, error) {
  if (error.code === 'FLOW_NOT_FOUND') {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      error: 'FLOW_NOT_FOUND',
      message: 'No se encontró el flujo solicitado.',
    });
  }
  if (error.code === 'VERSION_NOT_FOUND') {
    return res.status(HTTP_STATUS.NOT_FOUND).json({
      error: 'VERSION_NOT_FOUND',
      message: 'No se encontró la versión solicitada del flujo.',
    });
  }
  console.error('[FlowExport]', error.message);
  return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
    error: 'EXPORT_FAILED',
    message: 'No se pudo exportar el flujo desde la base de datos.',
  });
}

export const exportAllFlows = async (req, res) => {
  try {
    const bundle = await flowDocumentService.exportAllFlows();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${bundle.bundleFilename}"`);
    res.status(HTTP_STATUS.OK).send(`${JSON.stringify(bundle, null, 2)}\n`);
  } catch (error) {
    return handleExportError(res, error);
  }
};

export const exportFlowActive = async (req, res) => {
  const { flowId } = req.params;
  try {
    const payload = await flowDocumentService.exportActivePublished(flowId);
    return sendExportJson(res, payload);
  } catch (error) {
    return handleExportError(res, error);
  }
};

export const exportFlowVersion = async (req, res) => {
  const { flowId, version } = req.params;
  try {
    const payload = await flowDocumentService.exportVersion(flowId, version);
    return sendExportJson(res, payload);
  } catch (error) {
    return handleExportError(res, error);
  }
};
