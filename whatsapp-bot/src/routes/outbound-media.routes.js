import express from 'express';
import {
  headOutboundMediaForTwilio,
  streamOutboundMediaForTwilio,
} from '../controllers/outbound-media.controller.js';

const router = express.Router();

router.head('/outbound/:filename/:token', headOutboundMediaForTwilio);
router.get('/outbound/:filename/:token', streamOutboundMediaForTwilio);
router.head('/outbound/:token', headOutboundMediaForTwilio);
router.get('/outbound/:token', streamOutboundMediaForTwilio);

export default router;