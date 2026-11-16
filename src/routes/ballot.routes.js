import express from "express";
import { castVote, getWeb3Health } from "../controllers/ballotController.js";
import { requireAuth, requireVoter } from "../middleware/authMiddleware.js";
import { setCacheControl } from "../middleware/security.js";

const router = express.Router();

router.get("/web3-status", setCacheControl("public, max-age=60, stale-while-revalidate=300"), getWeb3Health);
router.post("/", requireAuth, requireVoter, castVote);

export default router;
