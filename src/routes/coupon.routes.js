import express from "express";
import {
    validateCoupon,
    createCoupon,
    getAllCoupons,
    toggleCouponStatus,
    deleteCoupon
} from "../controllers/couponController.js";
import { requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/validate", validateCoupon);

// Admin routes
router.get("/", requireAuth, requireAdmin, getAllCoupons);
router.post("/create", requireAuth, requireAdmin, createCoupon);
router.patch("/:id/toggle", requireAuth, requireAdmin, toggleCouponStatus);
router.delete("/:id", requireAuth, requireAdmin, deleteCoupon);

export default router;
