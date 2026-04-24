import express from 'express';
import { receiveTwilioMessage } from '../controllers/twilio-webhook.controller.js';

const router = express.Router();

router.post('/:flowId', receiveTwilioMessage);

export default router;
