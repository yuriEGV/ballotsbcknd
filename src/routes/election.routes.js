import express from "express";
import {
    createElection,
    getElections,
    getElectionById,
    updateElection,
    updateElectionStatus,
    evaluateElection,
    getElectionVoters,
    getElectionReport
} from "../controllers/electionController.js";
import {
    getAuditLog,
    verifyBallotReceipt,
    anchorElectionWeb3
} from "../controllers/auditController.js";
import { optionalAuth, requireAuth, requireAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/", requireAuth, createElection);
router.get("/", requireAuth, getElections);
router.get("/:id", optionalAuth, getElectionById);
router.put("/:id", requireAuth, updateElection);
router.put("/:id/status", requireAuth, updateElectionStatus);

// Admin
router.put("/:id/evaluate", requireAuth, requireAdmin, evaluateElection);

// Voters stats & reports
router.get("/:id/voters", requireAuth, getElectionVoters);
router.get("/:id/report", requireAuth, getElectionReport);
router.get("/:id/audit", optionalAuth, getAuditLog);
router.get("/:id/verify/:commitment", verifyBallotReceipt);
router.post("/:id/anchor", requireAuth, anchorElectionWeb3);

// Legacy unauthenticated vote route disabled in favor of authenticated Web3 POST /api/ballots
router.post("/:id/vote", (_req, res) => {
    res.status(410).json({
        success: false,
        message: "Endpoint obsoleto. Utiliza POST /api/ballots con token de votante autenticado."
    });
});

export default router;
