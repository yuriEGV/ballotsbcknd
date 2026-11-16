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
import { validateObjectIdParam } from "../middleware/security.js";

const router = express.Router();

router.post("/", requireAuth, createElection);
router.get("/", requireAuth, getElections);
router.get("/:id", validateObjectIdParam("id"), optionalAuth, getElectionById);
router.put("/:id", validateObjectIdParam("id"), requireAuth, updateElection);
router.put("/:id/status", validateObjectIdParam("id"), requireAuth, updateElectionStatus);

// Admin
router.put("/:id/evaluate", validateObjectIdParam("id"), requireAuth, requireAdmin, evaluateElection);

// Voters stats & reports
router.get("/:id/voters", validateObjectIdParam("id"), requireAuth, getElectionVoters);
router.get("/:id/report", validateObjectIdParam("id"), requireAuth, getElectionReport);
router.get("/:id/audit", validateObjectIdParam("id"), optionalAuth, getAuditLog);
router.get("/:id/verify/:commitment", validateObjectIdParam("id"), verifyBallotReceipt);
router.post("/:id/anchor", validateObjectIdParam("id"), requireAuth, anchorElectionWeb3);

// Legacy unauthenticated vote route disabled in favor of authenticated Web3 POST /api/ballots
router.post("/:id/vote", (_req, res) => {
    res.status(410).json({
        success: false,
        message: "Endpoint obsoleto. Utiliza POST /api/ballots con token de votante autenticado."
    });
});

export default router;
