import express from 'express';
import { receiveTwilioMessage } from '../controllers/twilio-webhook.controller.js';
import { receiveTwilioStatus } from '../controllers/twilio-status.controller.js';

const router = express.Router();

router.post('/:flowId/status', receiveTwilioStatus);
router.post('/:flowId', receiveTwilioMessage);

export default router;
