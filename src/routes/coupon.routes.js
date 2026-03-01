import express from 'express';
import { validateCoupon, createCoupon, getAllCoupons, toggleCouponStatus, deleteCoupon } from '../controllers/couponController.js';

const router = express.Router();

router.post('/validate', validateCoupon);
// Admin routes
router.get('/', getAllCoupons);
router.post('/create', createCoupon);
router.patch('/:id/toggle', toggleCouponStatus);
router.delete('/:id', deleteCoupon);

export default router;
