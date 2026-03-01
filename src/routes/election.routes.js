import express from "express";
import {
    createElection,
    getElections,
    getElectionById,
    updateElection,
    evaluateElection,
    getElectionVoters,
    castVote,
    getElectionReport
} from "../controllers/electionController.js";
import { getAuditLog } from "../controllers/auditController.js";
import { optionalAuth, requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", requireAuth, createElection);
router.get("/", requireAuth, getElections);
router.get("/:id", optionalAuth, getElectionById);
router.put("/:id", requireAuth, updateElection);

// Admin
router.put("/:id/evaluate", optionalAuth, evaluateElection);

// Voters stats
router.get("/:id/voters", optionalAuth, getElectionVoters);
router.get("/:id/report", optionalAuth, getElectionReport);
router.get("/:id/audit", optionalAuth, getAuditLog);

// Cast vote
router.post("/:id/vote", castVote);

export default router;
