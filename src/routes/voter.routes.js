import express from "express";
import {
    createVoter,
    getVoters,
    bulkAddVoters
} from "../controllers/voterController.js";
import { authenticateVoter } from "../controllers/voterAuthController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/auth", authenticateVoter);
router.post("/", requireAuth, createVoter);
router.post("/bulk", requireAuth, bulkAddVoters);
router.get("/:electionId", requireAuth, getVoters);

export default router;
