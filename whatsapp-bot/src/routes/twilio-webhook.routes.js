import express from 'express';
import { receiveTwilioMessage } from '../controllers/twilio-webhook.controller.js';
import { receiveTwilioStatus } from '../controllers/twilio-status.controller.js';
import {
  verifyTwilioInboundSignature,
  verifyTwilioSignature,
} from '../middleware/verify-twilio-signature.js';

const router = express.Router();

// El callback de estado exige firma en todos los modos del inbound.
router.post('/:flowId/status', verifyTwilioSignature, receiveTwilioStatus);
router.post('/:flowId', verifyTwilioInboundSignature, receiveTwilioMessage);

export default router;
