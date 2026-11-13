import Election from "../models/Election.js";
import Ballot from "../models/Ballot.js";
import Voter from "../models/Voter.js";
import {
    GENESIS_HASH,
    computeBallotCommitment,
    computeMerkleRoot,
    computePadronLeaf,
    computeRollingHash,
    computeTallyLeaf
} from "../utils/crypto.js";
import web3Service from "../services/web3Service.js";

function isOwnerOrAdmin(election, user) {
    if (!user) return false;
    if (user.role === "admin") return true;
    const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
    return Boolean(organizerId && organizerId === user.id?.toString());
}

export function computeElectionTallyRoot(ballots = []) {
    const leaves = ballots
        .filter((b) => b.ballotCommitment && b.choiceHash)
        .map((b) =>
            computeTallyLeaf({
                ballotCommitment: b.ballotCommitment,
                choiceHash: b.choiceHash,
                weight: b.weight || 1
            })
        );
    return computeMerkleRoot(leaves);
}

/**
 * Get the full cryptographic & Web3 audit log for an election.
 * Zero PII (no voter ID, RUT, IP, or device) is returned.
 */
export const getAuditLog = async (req, res) => {
    try {
        const { id } = req.params;
        const election = await Election.findById(id)
            .select("title candidates organizer settings web3 status startDate endDate")
            .lean();

        if (!election) {
            return res.status(404).json({ success: false, message: "Election not found" });
        }

        if (!election.settings?.publicResults && !isOwnerOrAdmin(election, req.user)) {
            return res.status(req.user ? 403 : 401).json({
                success: false,
                message: "No autorizado para ver la auditoría de esta elección"
            });
        }

        const ballots = await Ballot.find({ election: id })
            .select("sequenceIndex timestampMs candidate isNulo weight nullifierHash ballotNonce choiceHash ballotCommitment previousHash hash web3 createdAt")
            .sort({ sequenceIndex: 1, createdAt: 1 })
            .lean();

        const candidateMap = {};
        (election.candidates || []).forEach((c) => {
            candidateMap[c._id.toString()] = c.name;
        });

        const auditTrail = ballots.map((b, index) => {
            const expectedPrevious = index === 0 ? GENESIS_HASH : ballots[index - 1].hash;
            const linkValid = b.previousHash === expectedPrevious;

            let commitmentValid = false;
            let hashVerified = false;

            if (b.ballotCommitment && b.ballotNonce && b.timestampMs && b.nullifierHash) {
                const recomputed = computeBallotCommitment({
                    electionId: id,
                    candidateId: b.candidate,
                    isNulo: Boolean(b.isNulo),
                    weight: b.weight || 1,
                    ballotNonce: b.ballotNonce,
                    timestampMs: b.timestampMs
                });
                commitmentValid =
                    recomputed.ballotCommitment.toLowerCase() === b.ballotCommitment.toLowerCase();

                const recomputedTip = computeRollingHash({
                    previousHash: b.previousHash,
                    nullifierHash: b.nullifierHash,
                    ballotCommitment: b.ballotCommitment,
                    weight: b.weight || 1
                });
                hashVerified = recomputedTip.toLowerCase() === b.hash.toLowerCase();
            }

            const isValid = Boolean(linkValid && commitmentValid && hashVerified);
            const candidateName = b.isNulo
                ? "Voto Nulo"
                : b.candidate
                    ? candidateMap[b.candidate.toString()] || "Candidato"
                    : "Voto en Blanco";

            return {
                index: b.sequenceIndex ?? index,
                hash: b.hash,
                previousHash: b.previousHash,
                ballotCommitment: b.ballotCommitment,
                nullifierHash: b.nullifierHash,
                weight: b.weight || 1,
                timestamp: b.timestampMs || b.createdAt,
                linkValid,
                commitmentValid,
                hashVerified,
                isValid,
                anchored: Boolean(b.web3?.anchored),
                txHash: b.web3?.txHash || null,
                blockNumber: b.web3?.blockNumber || null,
                explorerUrl: b.web3?.explorerUrl || null,
                network: b.web3?.network || null,
                candidateName
            };
        });

        const onChain = await web3Service.getElectionOnChain(id);
        const lastDbHash = ballots.length > 0 ? ballots[ballots.length - 1].hash : GENESIS_HASH;
        const matchesOnChainTip = onChain.registered
            ? onChain.chainTip?.toLowerCase() === lastDbHash.toLowerCase() &&
              onChain.voteCount === ballots.length
            : null;

        const localIntegrity = auditTrail.every((step) => step.isValid);
        const chainIntegrity =
            matchesOnChainTip === null ? localIntegrity : Boolean(localIntegrity && matchesOnChainTip);

        const anchoredVotesCount = auditTrail.filter((b) => b.anchored).length;

        res.json({
            success: true,
            data: {
                electionId: id,
                electionTitle: election.title,
                auditTrail,
                totalVotes: ballots.length,
                anchoredVotesCount,
                localIntegrity,
                matchesOnChainTip,
                chainIntegrity,
                tallyRoot: computeElectionTallyRoot(ballots),
                onChain
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Verify a specific ballot commitment receipt against DB and on-chain Smart Contract.
 * GET /api/elections/:id/verify/:commitment
 */
export const verifyBallotReceipt = async (req, res) => {
    try {
        const { id, commitment } = req.params;
        const ballot = await Ballot.findOne({ election: id, ballotCommitment: commitment }).lean();
        if (!ballot) {
            return res.status(404).json({
                success: false,
                verified: false,
                message: "No se encontró un voto con ese commitment en esta elección."
            });
        }

        const recomputed = computeBallotCommitment({
            electionId: id,
            candidateId: ballot.candidate,
            isNulo: Boolean(ballot.isNulo),
            weight: ballot.weight || 1,
            ballotNonce: ballot.ballotNonce,
            timestampMs: ballot.timestampMs
        });
        const recomputedHash = computeRollingHash({
            previousHash: ballot.previousHash,
            nullifierHash: ballot.nullifierHash,
            ballotCommitment: ballot.ballotCommitment,
            weight: ballot.weight || 1
        });

        const commitmentMatches =
            recomputed.ballotCommitment.toLowerCase() === ballot.ballotCommitment.toLowerCase();
        const hashMatches = recomputedHash.toLowerCase() === ballot.hash.toLowerCase();

        let onChain = { configured: false, verified: false };
        if (web3Service.isWeb3Configured()) {
            onChain = await web3Service.verifyReceiptOnChain({
                electionId: id,
                nullifierHash: ballot.nullifierHash,
                ballotCommitment: ballot.ballotCommitment
            });
        }

        res.json({
            success: true,
            data: {
                electionId: id,
                sequenceIndex: ballot.sequenceIndex,
                ballotCommitment: ballot.ballotCommitment,
                nullifierHash: ballot.nullifierHash,
                hash: ballot.hash,
                previousHash: ballot.previousHash,
                timestamp: ballot.timestampMs || ballot.createdAt,
                cryptographicValid: Boolean(commitmentMatches && hashMatches),
                web3: {
                    ...ballot.web3,
                    onChainVerified: Boolean(onChain.verified),
                    onChainDetails: onChain
                }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * Anchor an election (and optionally finalize its tallyRoot) on the Web3 Smart Contract.
 * POST /api/elections/:id/anchor
 */
export const anchorElectionWeb3 = async (req, res) => {
    try {
        const { id } = req.params;
        const election = await Election.findById(id);
        if (!election) {
            return res.status(404).json({ success: false, message: "Election not found" });
        }

        if (!isOwnerOrAdmin(election, req.user)) {
            return res.status(403).json({ success: false, message: "No autorizado" });
        }

        if (!web3Service.isWeb3Configured()) {
            return res.status(400).json({
                success: false,
                message: "Web3 no está configurado en el servidor (faltan WEB3_RPC_URL, WEB3_PRIVATE_KEY o WEB3_CONTRACT_ADDRESS)."
            });
        }

        const voters = await Voter.find({ election: id }).select("cedula").lean();
        const padronRoot = computeMerkleRoot(voters.map((v) => computePadronLeaf(id, v.cedula)));

        const regResult = await web3Service.ensureElectionRegistered({
            electionId: id,
            padronRoot,
            openPadron: Boolean(election.settings?.allowAutoRegistration),
            startDate: election.startDate,
            endDate: election.endDate
        });

        election.web3 = {
            ...(election.web3 || {}),
            electionKey: regResult.electionKey,
            registered: true,
            registerTxHash: election.web3?.registerTxHash || regResult.txHash || "",
            padronRoot,
            contractAddress: regResult.contractAddress,
            chainId: regResult.chainId,
            network: regResult.networkName
        };

        let finalizeResult = null;
        if (election.status === "ended" || req.body?.finalize === true) {
            const ballots = await Ballot.find({ election: id })
                .select("ballotCommitment choiceHash weight")
                .lean();
            const tallyRoot = computeElectionTallyRoot(ballots);
            finalizeResult = await web3Service.finalizeElectionOnChain({
                electionId: id,
                tallyRoot,
                padronRoot,
                openPadron: Boolean(election.settings?.allowAutoRegistration),
                startDate: election.startDate,
                endDate: election.endDate
            });
            election.web3.finalized = true;
            election.web3.tallyRoot = tallyRoot;
            if (finalizeResult.txHash) {
                election.web3.finalizeTxHash = finalizeResult.txHash;
            }
        }

        await election.save();

        res.json({
            success: true,
            data: {
                web3: election.web3,
                registration: regResult,
                finalization: finalizeResult
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
};
