import ballotService from "../services/ballotService.js";

export const castVote = async (req, res) => {
    try {
        const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const device = req.headers['user-agent'];

        const vote = await ballotService.castVote(
            req.user.id,
            req.body.electionId,
            req.body.candidateId,
            ipAddress,
            device,
            req.body.isNulo
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
