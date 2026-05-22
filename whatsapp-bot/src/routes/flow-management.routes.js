import express from 'express';
import { requireAuth } from '../middleware/require-auth.middleware.js';
import {
  listFlows,
  getFlowDetail,
  listFlowVersions,
  getVersionDetail,
  getVersionSnapshot,
  createDraft,
  updateVersion,
  createNode,
  updateNode,
  deleteNode,
  createTransition,
  updateTransition,
  deleteTransition,
  validateVersion,
  publishVersion,
  rollbackVersion,
  discardDraft,
} from '../controllers/flow-management.controller.js';

const router = express.Router();
const versionsRouter = express.Router();
const nodesRouter = express.Router();
const transitionsRouter = express.Router();

router.use(requireAuth);

// /api/flow-management/flows
router.get('/flows', listFlows);
router.get('/flows/:flowId', getFlowDetail);
router.get('/flows/:flowId/versions', listFlowVersions);
router.post('/flows/:flowId/drafts', createDraft);

// /api/flow-management/flow-versions
versionsRouter.get('/:versionId', getVersionDetail);
versionsRouter.get('/:versionId/snapshot', getVersionSnapshot);
versionsRouter.patch('/:versionId', updateVersion);
versionsRouter.post('/:versionId/nodes', createNode);
versionsRouter.post('/:versionId/validate', validateVersion);
versionsRouter.post('/:versionId/publish', publishVersion);
versionsRouter.post('/:versionId/rollback', rollbackVersion);
versionsRouter.delete('/:versionId/draft', discardDraft);

// /api/flow-management/flow-nodes
nodesRouter.patch('/:nodeId', updateNode);
nodesRouter.delete('/:nodeId', deleteNode);
nodesRouter.post('/:nodeId/transitions', createTransition);

// /api/flow-management/flow-transitions
transitionsRouter.patch('/:transitionId', updateTransition);
transitionsRouter.delete('/:transitionId', deleteTransition);

router.use('/flow-versions', versionsRouter);
router.use('/flow-nodes', nodesRouter);
router.use('/flow-transitions', transitionsRouter);

export default router;
