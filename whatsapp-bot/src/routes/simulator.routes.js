import express from 'express';
import {
  startSimulation,
  sendMessage,
  resetSimulation
} from '../controllers/simulator.controller.js';

const router = express.Router();

/**
 * Rutas de simulación para el frontend.
 */
router.post('/start', startSimulation);
router.post('/message', sendMessage);
router.post('/reset', resetSimulation);

export default router;
