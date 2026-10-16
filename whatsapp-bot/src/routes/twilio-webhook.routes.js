import express from 'express';
import { receiveTwilioMessage } from '../controllers/twilio-webhook.controller.js';
import { receiveTwilioStatus } from '../controllers/twilio-status.controller.js';
import { verifyTwilioSignature } from '../middleware/verify-twilio-signature.js';

const router = express.Router();

router.post('/:flowId/status', verifyTwilioSignature, receiveTwilioStatus);
// Residual risk: POST /webhooks/twilio/:flowId still accepts inbound messages
// without X-Twilio-Signature. This change covers the status callback only.
router.post('/:flowId', receiveTwilioMessage);

export default router;
