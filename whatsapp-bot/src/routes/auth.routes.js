import express from 'express';
import { login, logout, me } from '../controllers/auth.controller.js';

const router = express.Router();

router.post('/login', login);
router.get('/me', me);
router.post('/logout', logout);

export default router;
