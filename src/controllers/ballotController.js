import ballotService from "../services/ballotService.js";
import web3Service from "../services/web3Service.js";

export const castVote = async (req, res) => {
    try {
        if (!req.user || req.user.role !== "voter") {
            return res.status(403).json({
                success: false,
                error: "Solo un votante autenticado puede emitir un voto."
            });
        }

        if (req.user.electionId && req.body.electionId && req.user.electionId !== req.body.electionId) {
            return res.status(403).json({
                success: false,
                error: "El token de votación no corresponde a esta elección."
            });
        }

        const forwardedFor = req.headers["x-forwarded-for"];
        const ipAddress = (Array.isArray(forwardedFor) ? forwardedFor[0] : String(forwardedFor || "").split(",")[0].trim())
            || req.socket?.remoteAddress
            || "unknown";
        const device = req.headers["user-agent"] || "unknown";

        const vote = await ballotService.castVote(
            req.user.id,
            req.body.electionId || req.user.electionId,
            req.body.candidateId,
            ipAddress,
            device,
            Boolean(req.body.isNulo),
            req.user.votingKey
        );

        res.status(201).json({
            success: true,
            data: vote
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};

export const getWeb3Health = async (_req, res) => {
    try {
        const status = await web3Service.getWeb3Status();
        res.status(200).json({ success: true, data: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
