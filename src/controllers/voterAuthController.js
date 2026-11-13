import Voter from "../models/Voter.js";
import Election from "../models/Election.js";
import Ballot from "../models/Ballot.js";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../config/jwt.js";
import { computeVoterNullifier, normalizeCedula } from "../utils/crypto.js";
import { sendVotingKeyEmail } from "../utils/emailService.js";
import { refreshElectionPadronRoot } from "../services/voterService.js";

/**
 * Authenticate voter with Cédula/RUT (and optional/required 6-digit votingKey OTP).
 * POST /api/voters/auth
 */
export const authenticateVoter = async (req, res) => {
    try {
        const { electionId, cedula, votingKey: submittedKey } = req.body;
        if (!electionId || !cedula) {
            return res.status(400).json({ success: false, message: "electionId and cedula are required." });
        }

        const election = await Election.findById(electionId);
        if (!election || election.status !== "active") {
            return res.status(404).json({ success: false, message: "Election is not active or does not exist." });
        }

        const now = new Date();
        if (election.startDate && now < new Date(election.startDate)) {
            return res.status(403).json({ success: false, message: "La elección aún no ha iniciado." });
        }
        if (election.endDate && now > new Date(election.endDate)) {
            return res.status(403).json({ success: false, message: "El período de votación ha finalizado." });
        }

        const rawCedula = String(cedula).trim();
        const cedulaNormalized = normalizeCedula(rawCedula);

        let voter = await Voter.findOne({
            election: electionId,
            $or: [{ cedulaNormalized }, { cedula: rawCedula }]
        });

        if (!voter) {
            if (election.settings?.allowAutoRegistration) {
                voter = new Voter({
                    election: electionId,
                    cedula: rawCedula,
                    cedulaNormalized,
                    name: `Ciudadano ${rawCedula.slice(-4)}`,
                    email: ""
                });
                await voter.save();
                await refreshElectionPadronRoot(electionId);
            } else {
                return res.status(401).json({ success: false, message: "Invalid Cédula for this Padron." });
            }
        } else if (!voter.cedulaNormalized) {
            voter.cedulaNormalized = cedulaNormalized;
        }

        // Check both Voter flag and cryptographic nullifier uniqueness
        const nullifierHash = computeVoterNullifier(electionId, cedulaNormalized);
        const ballotAlreadyExists = await Ballot.exists({ election: electionId, nullifierHash });
        if (voter.hasVoted || ballotAlreadyExists) {
            return res.status(403).json({ success: false, message: "This Cédula has already voted." });
        }

        // Optional 2FA votingKey flow when enabled on election and voter has email
        const requireOtp = Boolean(election.settings?.requireVotingKey && voter.email);
        if (requireOtp && !submittedKey) {
            const generatedKey = Math.floor(100000 + Math.random() * 900000).toString();
            voter.votingKey = generatedKey;
            await voter.save();

            sendVotingKeyEmail({
                to: voter.email,
                name: voter.name,
                votingKey: generatedKey,
                electionTitle: election.title
            }).catch((err) => console.error("[Email] Failed to send voting key:", err));

            return res.status(200).json({
                success: true,
                requiresVotingKey: true,
                message: "Se ha enviado una clave de verificación de 6 dígitos a tu correo registrado."
            });
        }

        if (requireOtp && submittedKey) {
            if (!voter.votingKey || voter.votingKey !== String(submittedKey).trim()) {
                return res.status(401).json({ success: false, message: "Clave de votación incorrecta o expirada." });
            }
        }

        // Generate single-use voting session key bound to JWT
        const sessionVotingKey = requireOtp
            ? voter.votingKey
            : Math.floor(100000 + Math.random() * 900000).toString();

        voter.votingKey = sessionVotingKey;
        await voter.save();

        const token = jwt.sign(
            { id: voter._id.toString(), electionId: election._id.toString(), role: "voter", votingKey: sessionVotingKey },
            getJwtSecret(),
            { expiresIn: "1h" }
        );

        if (!requireOtp && voter.email) {
            sendVotingKeyEmail({
                to: voter.email,
                name: voter.name,
                votingKey: sessionVotingKey,
                electionTitle: election.title
            }).catch((err) => console.error("[Email] Failed to send voting key:", err));
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
                    settings: election.settings,
                    web3: {
                        registered: Boolean(election.web3?.registered),
                        network: election.web3?.network || "",
                        contractAddress: election.web3?.contractAddress || ""
                    }
                }
            }
        });
    } catch (err) {
        console.error("Voter auth error:", err);
        res.status(500).json({ success: false, message: "Server error during authentication." });
    }
};
