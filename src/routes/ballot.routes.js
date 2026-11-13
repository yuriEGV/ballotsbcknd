import express from "express";
import { castVote, getWeb3Health } from "../controllers/ballotController.js";
import { requireAuth, requireVoter } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/web3-status", getWeb3Health);
router.post("/", requireAuth, requireVoter, castVote);

export default router;
