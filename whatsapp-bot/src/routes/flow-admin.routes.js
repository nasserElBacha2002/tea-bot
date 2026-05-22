import express from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import {
  listDrafts,
  getDraft,
  createFlow,
  updateFlow,
  duplicateFlow,
  archiveFlow,
  publishFlow,
  validateFlow
} from '../controllers/flow-admin.controller.js';
import {
  listPublishedVersions,
  getPublishedVersionDetail,
  duplicatePublishedVersionToDraft,
  importJsonAsNewVersion
} from '../controllers/flow-versions.controller.js';
import {
  exportAllFlows,
  exportFlowActive,
  exportFlowVersion,
} from '../controllers/flow-export.controller.js';

const router = express.Router();

router.use(requireAuth);

router.post('/validate', validateFlow);

// Exportación portable JSON (solo lectura desde DB)
router.get('/export/all', exportAllFlows);

// Historial / versiones publicadas (antes de /:flowId genérico)
router.get('/:flowId/versions/:version/export', exportFlowVersion);
router.get('/:flowId/versions/:version', getPublishedVersionDetail);
router.get('/:flowId/versions', listPublishedVersions);
router.get('/:flowId/export', exportFlowActive);
router.post('/:flowId/versions/:version/duplicate-to-draft', duplicatePublishedVersionToDraft);
router.post('/:flowId/versions/import-json', importJsonAsNewVersion);

// CRUD drafts
router.get('/', listDrafts);
router.get('/:flowId', getDraft);
router.post('/', createFlow);
router.put('/:flowId', updateFlow);

// Operaciones Extra
router.post('/:flowId/duplicate', duplicateFlow);
router.post('/:flowId/archive', archiveFlow);
router.post('/:flowId/publish', publishFlow);

export default router;
