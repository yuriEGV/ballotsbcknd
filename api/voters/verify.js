// This would typically verify a token or status
import Voter from '../../src/models/Voter.js';
import allowCors from '../utils/serverlessHandler.js';

const verifyVoter = async (req, res) => {
    const { electionId, identifier } = req.body;
    try {
        const voter = await Voter.findOne({ electionId, identifier });
        if (!voter) return res.status(404).json({ success: false, message: 'Voter not found' });
        res.status(200).json({ success: true, verified: voter.verified, voted: voter.voted });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

export default allowCors(verifyVoter);
