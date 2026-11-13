import Ballot from "../models/Ballot.js";
import Voter from "../models/Voter.js";
import Election from "../models/Election.js";
import { sendVoteConfirmationEmail } from "../utils/emailService.js";
import {
    GENESIS_HASH,
    computeBallotCommitment,
    computeElectionKey,
    computeMerkleRoot,
    computePadronLeaf,
    computeRollingHash,
    computeVoterNullifier,
    generateRandomBytes32,
    normalizeCedula
} from "../utils/crypto.js";
import web3Service from "./web3Service.js";

const electionLocks = new Map();

function withElectionLock(electionId, fn) {
    const key = electionId.toString();
    const prev = electionLocks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    const cleanup = next.finally(() => {
        if (electionLocks.get(key) === cleanup) {
            electionLocks.delete(key);
        }
    });
    electionLocks.set(key, cleanup);
    return next;
}

/**
 * Cast a single unique, privacy-preserving ballot backed by cryptographic
 * commitments and optional/strict EVM smart-contract anchoring.
 */
const castVote = async (
    voterId,
    electionId,
    candidateId,
    ipAddress,
    device,
    isNulo = false,
    votingKeyFromToken = null
) => {
    if (!electionId) throw new Error("electionId es requerido");

    const election = await Election.findById(electionId);
    if (!election) throw new Error("Election not found");
    if (election.status !== "active") {
        throw new Error("La elección no está activa");
    }

    const now = new Date();
    if (election.startDate && now < new Date(election.startDate)) {
        throw new Error("La votación aún no ha comenzado");
    }
    if (election.endDate && now > new Date(election.endDate)) {
        throw new Error("El período de votación ha finalizado");
    }

    const normalizedIsNulo = Boolean(isNulo);
    let resolvedCandidateId = null;

    if (!normalizedIsNulo && candidateId !== null && candidateId !== undefined && candidateId !== "") {
        const candidateExists = election.candidates.some(
            (c) => c._id.toString() === candidateId.toString()
        );
        if (!candidateExists) {
            throw new Error("Candidato inválido para esta elección");
        }
        resolvedCandidateId = candidateId;
    }

    const existingVoter = await Voter.findById(voterId);
    if (!existingVoter) throw new Error("Voter not found");
    if (existingVoter.election.toString() !== electionId.toString()) {
        throw new Error("El votante no pertenece a esta elección");
    }
    if (existingVoter.hasVoted) {
        throw new Error("Voter has already voted");
    }
    if (votingKeyFromToken && existingVoter.votingKey && existingVoter.votingKey !== votingKeyFromToken) {
        throw new Error("Clave de votación inválida o expirada");
    }

    const normalizedCedula = normalizeCedula(existingVoter.cedula);
    const nullifierHash = computeVoterNullifier(electionId, normalizedCedula);

    // Defensive check against duplicate nullifier even if a Voter document was re-created
    const existingBallot = await Ballot.exists({ election: electionId, nullifierHash });
    if (existingBallot) {
        throw new Error("Este RUT ya registró un voto único en esta elección");
    }

    // Atomic compare-and-set on Voter so concurrent requests cannot vote twice
    const lockedVoter = await Voter.findOneAndUpdate(
        { _id: voterId, election: electionId, hasVoted: false },
        {
            $set: {
                hasVoted: true,
                votedAt: now,
                auditIp: ipAddress,
                auditDevice: device
            },
            $unset: { votingKey: 1 }
        },
        { new: true }
    );

    if (!lockedVoter) {
        throw new Error("Voter has already voted");
    }

    let anchoredOnChain = false;

    try {
        return await withElectionLock(electionId, async () => {
            const weight = election.settings?.weightedVoting ? Math.max(1, Number(lockedVoter.weight) || 1) : 1;
            const timestampMs = now.getTime();
            const ballotNonce = generateRandomBytes32();

            const { electionKey, choiceHash, ballotCommitment } = computeBallotCommitment({
                electionId,
                candidateId: resolvedCandidateId,
                isNulo: normalizedIsNulo,
                weight,
                ballotNonce,
                timestampMs
            });

            let padronRoot = election.web3?.padronRoot || GENESIS_HASH;
            if (padronRoot === GENESIS_HASH) {
                const allVoters = await Voter.find({ election: electionId }).select("cedula").lean();
                padronRoot = computeMerkleRoot(
                    allVoters.map((v) => computePadronLeaf(electionId, v.cedula))
                );
            }

            // Anchor on-chain first when Web3 is configured so EVM consensus defines authoritative sequence/tip
            const web3Result = await web3Service.anchorVote({
                electionId,
                nullifierHash,
                ballotCommitment,
                weight,
                padronRoot,
                openPadron: Boolean(election.settings?.allowAutoRegistration),
                startDate: election.startDate,
                endDate: election.endDate
            });

            anchoredOnChain = Boolean(web3Result.anchored);

            let sequenceIndex;
            let previousHash;
            let hash;

            if (web3Result.anchored && web3Result.onChainVoteIndex !== null) {
                sequenceIndex = web3Result.onChainVoteIndex;
                previousHash = web3Result.onChainPreviousTip;
                hash = web3Result.onChainNewTip;
            } else {
                // Optimistic CAS sequence/chain-tip update in MongoDB to prevent forks across serverless lambdas
                let updatedElection = null;
                for (let attempt = 0; attempt < 5; attempt++) {
                    const freshElection = await Election.findById(electionId).lean();
                    const currentSeq = freshElection.ballotSequence || 0;
                    let currentTip = freshElection.chainTip || GENESIS_HASH;

                    if (currentSeq > 0 && currentTip === GENESIS_HASH) {
                        const lastBallot = await Ballot.findOne({ election: electionId })
                            .sort({ sequenceIndex: -1, createdAt: -1 })
                            .lean();
                        if (lastBallot) {
                            currentTip = lastBallot.hash;
                        }
                    }

                    const nextHash = computeRollingHash({
                        previousHash: currentTip,
                        nullifierHash,
                        ballotCommitment,
                        weight
                    });

                    updatedElection = await Election.findOneAndUpdate(
                        { _id: electionId, ballotSequence: currentSeq },
                        {
                            $set: {
                                chainTip: nextHash,
                                "web3.electionKey": electionKey,
                                "web3.padronRoot": padronRoot
                            },
                            $inc: { ballotSequence: 1 }
                        },
                        { new: true }
                    );

                    if (updatedElection) {
                        sequenceIndex = currentSeq;
                        previousHash = currentTip;
                        hash = nextHash;
                        break;
                    }
                }

                if (sequenceIndex === undefined) {
                    throw new Error("No se pudo serializar el voto de forma segura. Reintenta.");
                }
            }

            if (web3Result.anchored) {
                await Election.findByIdAndUpdate(electionId, {
                    $set: {
                        ballotSequence: sequenceIndex + 1,
                        chainTip: hash,
                        "web3.electionKey": electionKey,
                        "web3.registered": true,
                        "web3.padronRoot": padronRoot,
                        "web3.contractAddress": web3Result.contractAddress,
                        "web3.chainId": web3Result.chainId,
                        "web3.network": web3Result.network
                    }
                });
            }

            const ballot = await Ballot.create({
                election: electionId,
                candidate: resolvedCandidateId,
                isNulo: normalizedIsNulo,
                weight,
                sequenceIndex,
                timestampMs,
                nullifierHash,
                ballotNonce,
                choiceHash,
                ballotCommitment,
                previousHash,
                hash,
                web3: {
                    anchored: web3Result.anchored,
                    network: web3Result.network || "",
                    chainId: web3Result.chainId || null,
                    contractAddress: web3Result.contractAddress || "",
                    txHash: web3Result.txHash || "",
                    blockNumber: web3Result.blockNumber || null,
                    explorerUrl: web3Result.explorerUrl || "",
                    onChainVoteIndex: web3Result.onChainVoteIndex ?? null,
                    error: web3Result.error || ""
                }
            });

            if (lockedVoter.email) {
                sendVoteConfirmationEmail({
                    to: lockedVoter.email,
                    name: lockedVoter.name,
                    electionTitle: election.title,
                    rut: lockedVoter.cedula,
                    voteId: ballot._id,
                    date: lockedVoter.votedAt,
                    ip: ipAddress,
                    hash: ballot.hash,
                    ballotCommitment: ballot.ballotCommitment,
                    nullifierHash: ballot.nullifierHash,
                    txHash: ballot.web3?.txHash,
                    explorerUrl: ballot.web3?.explorerUrl,
                    network: ballot.web3?.network
                }).catch((err) => console.error("[Email] Failed to send confirmation:", err));
            }

            return {
                _id: ballot._id,
                election: ballot.election,
                sequenceIndex: ballot.sequenceIndex,
                hash: ballot.hash,
                previousHash: ballot.previousHash,
                ballotCommitment: ballot.ballotCommitment,
                nullifierHash: ballot.nullifierHash,
                weight: ballot.weight,
                web3: ballot.web3,
                createdAt: ballot.createdAt
            };
        });
    } catch (error) {
        // Roll back voter lock only if the vote was NOT already committed on-chain
        const msg = error?.message || "";
        const duplicateOnChain = msg.includes("duplicate vote rejected") || msg.includes("Duplicate");
        if (!anchoredOnChain && !duplicateOnChain) {
            await Voter.updateOne(
                { _id: voterId },
                {
                    $set: { hasVoted: false, votingKey: existingVoter.votingKey },
                    $unset: { votedAt: 1, auditIp: 1, auditDevice: 1 }
                }
            );
        }
        throw error;
    }
};

export default {
    castVote
};
