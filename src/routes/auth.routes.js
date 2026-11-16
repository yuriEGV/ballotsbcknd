import express from "express";
import { login, register, logout, getMe } from "../controllers/authController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.post("/login", authRateLimiter, login);
router.post("/register", authRateLimiter, register);
router.get("/me", requireAuth, getMe);
router.post("/logout", logout);

export default router;
