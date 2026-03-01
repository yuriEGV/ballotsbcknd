// Checks if a voter is eligible to cast a ballot
const Voter = require('../../src/models/Voter');
const allowCors = require('../utils/serverlessHandler');

const validateBallot = async (req, res) => {
    const { electionId, voterId } = req.body;
    try {
        const voter = await Voter.findById(voterId);
        if (!voter) return res.status(404).json({ success: false, message: 'Voter not found' });

        if (voter.voted) {
            return res.status(400).json({ success: false, message: 'Voter has already voted' });
        }
        res.status(200).json({ success: true, message: 'Voter is eligible' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = allowCors(validateBallot);
