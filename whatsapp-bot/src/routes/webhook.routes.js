import express from 'express';
import { verifyWebhook, receiveMessage } from '../controllers/webhook.controller.js';

const router = express.Router();

/**
 * Endpoint de verificación para Meta WhatsApp Cloud API.
 * GET /webhook
 */
router.get('/', verifyWebhook);

/**
 * Endpoint para recibir notificaciones y mensajes de Meta.
 * POST /webhook
 */
router.post('/', receiveMessage);

export default router;
