import express from "express";
import {
    createVoter,
    getVoters,
    bulkAddVoters
} from "../controllers/voterController.js";
import { authenticateVoter } from "../controllers/voterAuthController.js";

const router = express.Router();

router.post("/auth", authenticateVoter);
router.post("/", createVoter);
router.post("/bulk", bulkAddVoters);
router.get("/:electionId", getVoters);

export default router;
