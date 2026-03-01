import Voter from "../models/Voter.js";
import Election from "../models/Election.js";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { sendVotingKeyEmail, sendVoteConfirmationEmail } from "../utils/emailService.js";

// @desc    Authenticate voter with Cédula
// @route   POST /api/voters/auth
// @access  Public
export const authenticateVoter = async (req, res) => {
    try {
        const { electionId, cedula } = req.body;

        const election = await Election.findById(electionId);
        if (!election || election.status !== "active") {
            return res.status(404).json({ success: false, message: "Election is not active or does not exist." });
        }

        let voter = await Voter.findOne({ election: electionId, cedula });

        if (!voter) {
            if (election.settings?.allowAutoRegistration) {
                // Auto-register voter on the fly
                voter = new Voter({
                    election: electionId,
                    cedula,
                    name: `Ciudadano ${cedula.slice(-4)}`, // Placeholder name
                    email: '', // Unknown email
                });
                await voter.save();
            } else {
                return res.status(401).json({ success: false, message: "Invalid Cédula for this Padron." });
            }
        }

        if (voter.hasVoted) {
            return res.status(403).json({ success: false, message: "This Cédula has already voted." });
        }

        // Generate 6-digit voting key
        const votingKey = Math.floor(100000 + Math.random() * 900000).toString();
        voter.votingKey = votingKey;
        await voter.save();

        // Create token for this exact vote
        const token = jwt.sign(
            { id: voter._id, role: "voter", votingKey },
            process.env.JWT_SECRET || "default_jwt_secret_for_development",
            { expiresIn: "1h" }
        );

        // Send voting key email (non-blocking)
        if (voter.email) {
            sendVotingKeyEmail({
                to: voter.email,
                name: voter.name,
                votingKey,
                electionTitle: election.title,
            }).catch(err => console.error('[Email] Failed to send voting key:', err));
        }

        res.status(200).json({
            success: true,
            data: {
                token,
                voter: {
                    id: voter._id,
                    name: voter.name,
                    cedula: voter.cedula,
                    weight: voter.weight
                },
                election: {
                    id: election._id,
                    title: election.title,
                    electionType: election.electionType,
                    candidates: election.candidates,
                    settings: election.settings
                }
            }
        });
    } catch (err) {
        console.error("Voter auth error:", err);
        res.status(500).json({ success: false, message: "Server error during authentication." });
    }
};
