import express from 'express';
import { createPayment, handleWebhook, confirmPaymentManual } from '../controllers/paymentController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/create-preference', requireAuth, createPayment);
router.post('/webhook', handleWebhook);
router.post('/confirm-manual/:electionId', requireAuth, confirmPaymentManual);

export default router;
