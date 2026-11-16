import express from "express";
import {
    createVoter,
    getVoters,
    bulkAddVoters
} from "../controllers/voterController.js";
import { authenticateVoter } from "../controllers/voterAuthController.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";
import { validateObjectIdParam } from "../middleware/security.js";

const router = express.Router();

router.post("/auth", authRateLimiter, authenticateVoter);
router.post("/", requireAuth, createVoter);
router.post("/bulk", requireAuth, bulkAddVoters);
router.get("/:electionId", requireAuth, validateObjectIdParam("electionId"), getVoters);

export default router;
