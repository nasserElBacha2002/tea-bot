import express from 'express';
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
  duplicatePublishedVersionToDraft
} from '../controllers/flow-versions.controller.js';

const router = express.Router();

router.post('/validate', validateFlow);

// Historial / versiones publicadas (antes de /:flowId genérico)
router.get('/:flowId/versions/:version', getPublishedVersionDetail);
router.get('/:flowId/versions', listPublishedVersions);
router.post('/:flowId/versions/:version/duplicate-to-draft', duplicatePublishedVersionToDraft);

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
