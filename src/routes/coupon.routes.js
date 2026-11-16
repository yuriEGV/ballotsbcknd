import express from "express";
import {
    validateCoupon,
    createCoupon,
    getAllCoupons,
    toggleCouponStatus,
    deleteCoupon
} from "../controllers/couponController.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";
import { publicActionRateLimiter } from "../middleware/rateLimiter.js";
import { validateObjectIdParam } from "../middleware/security.js";

const router = express.Router();

router.post("/validate", publicActionRateLimiter, validateCoupon);

// Admin routes
router.get("/", requireAuth, requireAdmin, getAllCoupons);
router.post("/create", requireAuth, requireAdmin, createCoupon);
router.patch("/:id/toggle", requireAuth, requireAdmin, validateObjectIdParam("id"), toggleCouponStatus);
router.delete("/:id", requireAuth, requireAdmin, validateObjectIdParam("id"), deleteCoupon);

export default router;
