import VoterService from "../services/voterService.js";

export const createVoter = async (req, res) => {
    try {
        const { electionId, ...voterData } = req.body;
        const voter = await VoterService.addVoter(electionId, voterData);

        res.status(201).json({
            success: true,
            data: voter
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};

export const bulkAddVoters = async (req, res) => {
    try {
        const { electionId, voters } = req.body;
        if (!voters || !Array.isArray(voters)) {
            return res.status(400).json({ success: false, error: "Voters array is required." });
        }

        const result = await VoterService.bulkAddVoters(electionId, voters);
        res.status(201).json({
            success: true,
            count: result.length,
            message: `${result.length} voters added to padron.`
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};

export const getVoters = async (req, res) => {
    try {
        const voters = await VoterService.getVoters(req.params.electionId);
        res.status(200).json({
            success: true,
            data: voters
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};
