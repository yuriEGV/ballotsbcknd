import Ballot from "../models/Ballot.js";
import Voter from "../models/Voter.js";
import Election from "../models/Election.js";
import { sendVoteConfirmationEmail } from "../utils/emailService.js";
import crypto from "crypto";

const castVote = async (voterId, electionId, candidateId, ipAddress, device, isNulo = false) => {
    const voter = await Voter.findById(voterId);
    if (!voter) throw new Error("Voter not found");
    if (voter.hasVoted) throw new Error("Voter has already voted");

    const election = await Election.findById(electionId);
    if (!election) throw new Error("Election not found");

    // 🔗 BLOCKCHAIN INTEGRATION: Get last ballot to link hashes
    const lastBallot = await Ballot.findOne({ election: electionId }).sort({ createdAt: -1 });
    const previousHash = lastBallot ? lastBallot.hash : "0000000000000000000000000000000000000000000000000000000000000000";

    // Create hash for THIS ballot (Web3 / Ledger integrity)
    // Include isNulo in hash to prevent tampering
    const dataToHash = `${electionId}${voterId}${candidateId}${ipAddress}${device}${previousHash}${isNulo}${new Date().getTime()}`;
    const hash = crypto.createHash('sha256').update(dataToHash).digest('hex');

    const ballot = await Ballot.create({
        voter: voterId,
        election: electionId,
        candidate: candidateId,
        ipAddress,
        device,
        weight: voter.weight || 1,
        previousHash,
        hash,
        isNulo
    });

    voter.hasVoted = true;
    voter.votedAt = new Date();
    voter.auditIp = ipAddress;
    voter.auditDevice = device;
    await voter.save();

    // Send confirmation email (non-blocking)
    if (voter.email) {
        sendVoteConfirmationEmail({
            to: voter.email,
            name: voter.name,
            electionTitle: election.title,
            rut: voter.cedula,
            voteId: ballot._id,
            date: voter.votedAt,
            ip: ipAddress,
            hash: ballot.hash // Include hash in email for verification
        }).catch(err => console.error('[Email] Failed to send confirmation:', err));
    }

    return ballot;
};

export default {
    castVote
};
