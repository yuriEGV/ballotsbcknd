import VoterService from "../services/voterService.js";
import Election from "../models/Election.js";

async function ensureElectionAccess(electionId, user) {
    const election = await Election.findById(electionId).select("organizer");
    if (!election) {
        const err = new Error("Election not found");
        err.statusCode = 404;
        throw err;
    }
    const organizerId = election.organizer?.toString();
    if (user?.role !== "admin" && organizerId !== user?.id) {
        const err = new Error("Acceso denegado a este padrón electoral");
        err.statusCode = 403;
        throw err;
    }
}

export const createVoter = async (req, res) => {
    try {
        const { electionId, ...voterData } = req.body;
        if (!electionId) {
            return res.status(400).json({ success: false, error: "electionId is required." });
        }
        await ensureElectionAccess(electionId, req.user);

        const voter = await VoterService.addVoter(electionId, voterData);
        res.status(201).json({
            success: true,
            data: voter
        });
    } catch (err) {
        res.status(err.statusCode || 400).json({
            success: false,
            error: err.message
        });
    }
};

export const bulkAddVoters = async (req, res) => {
    try {
        const { electionId, voters } = req.body;
        if (!electionId || !voters || !Array.isArray(voters)) {
            return res.status(400).json({ success: false, error: "electionId and voters array are required." });
        }
        await ensureElectionAccess(electionId, req.user);

        const result = await VoterService.bulkAddVoters(electionId, voters);
        res.status(201).json({
            success: true,
            count: result.length,
            message: `${result.length} voters added to padron.`
        });
    } catch (err) {
        res.status(err.statusCode || 400).json({
            success: false,
            error: err.message
        });
    }
};

export const getVoters = async (req, res) => {
    try {
        await ensureElectionAccess(req.params.electionId, req.user);
        const voters = await VoterService.getVoters(req.params.electionId);
        res.status(200).json({
            success: true,
            data: voters
        });
    } catch (err) {
        res.status(err.statusCode || 400).json({
            success: false,
            error: err.message
        });
    }
};
