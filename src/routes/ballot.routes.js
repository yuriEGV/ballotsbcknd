import express from "express";
import { castVote } from "../controllers/ballotController.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();
router.post("/", requireAuth, castVote);

export default router;
