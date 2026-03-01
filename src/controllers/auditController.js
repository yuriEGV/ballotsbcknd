import Election from '../models/Election.js';
import Ballot from '../models/Ballot.js';
import Voter from '../models/Voter.js';

/**
 * Get the full blockchain audit log for an election
 */
export const getAuditLog = async (req, res) => {
    try {
        const { id } = req.params;

        // Fetch all ballots for this election, sorted by date (or index if we had one)
        // Since they are chain-linked, chronological order is usually the sequence
        const ballots = await Ballot.find({ election: id })
            .select('hash previousHash createdAt candidate voterId')
            .sort({ createdAt: 1 })
            .lean();

        // Map candidate names for readability
        const election = await Election.findById(id).select('candidates');
        const candidateMap = {};
        election.candidates.forEach(c => {
            candidateMap[c._id.toString()] = c.name;
        });

        const auditTrail = ballots.map((b, index) => ({
            index,
            hash: b.hash,
            previousHash: b.previousHash,
            timestamp: b.votedAt || b.createdAt,
            isValid: index === 0 ? (b.previousHash === '0') : (b.previousHash === ballots[index - 1].hash),
            candidateName: b.candidate ? candidateMap[b.candidate.toString()] : 'Voto en Blanco'
        }));

        res.json({
            success: true,
            data: {
                electionId: id,
                auditTrail,
                totalVotes: ballots.length,
                chainIntegrity: auditTrail.every(step => step.isValid)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
