import crypto from "crypto";
import { ethers } from "ethers";
import { getBallotHmacSecret } from "../config/jwt.js";

export const GENESIS_HASH = ethers.ZeroHash;

export const generateToken = () => {
    return crypto.randomBytes(20).toString("hex");
};

export const hashToken = (token) => {
    return crypto.createHash("sha256").update(token).digest("hex");
};

export const generateRandomBytes32 = () => {
    return `0x${crypto.randomBytes(32).toString("hex")}`;
};

/**
 * Normalize RUT / Cédula so formatting differences (dots, dashes, case)
 * cannot be used to register or vote twice with the same ID.
 */
export const normalizeCedula = (cedula = "") => {
    return String(cedula).replace(/[.\-\s]/g, "").trim().toUpperCase();
};

/**
 * Deterministic opaque election identifier (bytes32) stored on-chain.
 */
export const computeElectionKey = (electionId) => {
    return ethers.solidityPackedKeccak256(["string"], [electionId.toString()]);
};

/**
 * Privacy-preserving deterministic voter nullifier (bytes32).
 * Uses HMAC-SHA256 with a server secret so observers on-chain cannot
 * reverse or brute-force a voter's RUT/Cédula from the nullifier,
 * while guaranteeing strict 1-voter-1-vote uniqueness per election.
 */
export const computeVoterNullifier = (electionId, cedula) => {
    const normalized = normalizeCedula(cedula);
    const digest = crypto
        .createHmac("sha256", getBallotHmacSecret())
        .update(`ballots:nullifier:v1:${electionId.toString()}:${normalized}`)
        .digest("hex");
    return `0x${digest}`;
};

/**
 * Hash of a voter's nullifier used as an anonymized leaf in the election's padron Merkle tree.
 */
export const computePadronLeaf = (electionId, cedula) => {
    const nullifier = computeVoterNullifier(electionId, cedula);
    return ethers.keccak256(nullifier);
};

export const buildCanonicalChoiceCode = (candidateId, isNulo = false, surveyAnswers = null) => {
    if (isNulo) return "NULO";
    if (Array.isArray(surveyAnswers) && surveyAnswers.length > 0) {
        const canonical = surveyAnswers
            .map((ans) => ({
                q: String(ans.questionId || ans.questionPrompt || ""),
                opts: [...(ans.selectedOptions || [])].map((o) => String(o)).sort()
            }))
            .sort((a, b) => a.q.localeCompare(b.q));
        return `SURVEY:${JSON.stringify(canonical)}`;
    }
    if (candidateId) return candidateId.toString();
    return "BLANK";
};

export const computeChoiceHash = (electionId, choiceCode) => {
    return ethers.solidityPackedKeccak256(
        ["string", "string"],
        [electionId.toString(), choiceCode.toString()]
    );
};

/**
 * Sealed cryptographic commitment of a ballot (bytes32).
 * Hides the vote choice on-chain while binding choice, weight, nonce, and timestamp.
 */
export const computeBallotCommitment = ({
    electionId,
    candidateId = null,
    isNulo = false,
    surveyAnswers = null,
    weight = 1,
    ballotNonce,
    timestampMs
}) => {
    const electionKey = computeElectionKey(electionId);
    const choiceCode = buildCanonicalChoiceCode(candidateId, isNulo, surveyAnswers);
    const choiceHash = computeChoiceHash(electionId, choiceCode);
    const ballotCommitment = ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "uint256", "bytes32", "uint256"],
        [electionKey, choiceHash, BigInt(weight), ballotNonce, BigInt(timestampMs)]
    );

    return {
        electionKey,
        choiceCode,
        choiceHash,
        ballotCommitment
    };
};

/**
 * Sequential rolling chain hash matching BallotsRegistry.sol's exact formula:
 * keccak256(abi.encodePacked(previousTip, nullifier, ballotCommitment, weight))
 */
export const computeRollingHash = ({
    previousHash = GENESIS_HASH,
    nullifierHash,
    ballotCommitment,
    weight = 1
}) => {
    return ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "bytes32", "uint256"],
        [previousHash, nullifierHash, ballotCommitment, BigInt(weight)]
    );
};

/**
 * Compute a sorted-pair Keccak256 Merkle root from an array of bytes32 leaves.
 */
export const computeMerkleRoot = (leaves = []) => {
    if (!leaves || leaves.length === 0) {
        return ethers.ZeroHash;
    }

    let level = [...leaves].sort();
    while (level.length > 1) {
        const nextLevel = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = i + 1 < level.length ? level[i + 1] : left;
            const [a, b] = left.toLowerCase() <= right.toLowerCase() ? [left, right] : [right, left];
            nextLevel.push(ethers.solidityPackedKeccak256(["bytes32", "bytes32"], [a, b]));
        }
        level = nextLevel;
    }
    return level[0];
};

export const computeTallyLeaf = ({ ballotCommitment, choiceHash, weight = 1 }) => {
    return ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32", "uint256"],
        [ballotCommitment, choiceHash, BigInt(weight)]
    );
};

/**
 * Deterministic non-zero commitment for elections finalized with 0 valid ballots.
 * Satisfies BallotsRegistry.sol's `tallyRoot != bytes32(0)` check cleanly.
 */
export const computeEmptyTallyRoot = (electionId = null) => {
    if (electionId) {
        return ethers.solidityPackedKeccak256(
            ["string", "string"],
            ["BALLOTS:EMPTY_TALLY:V1", electionId.toString()]
        );
    }
    return ethers.keccak256(ethers.toUtf8Bytes("BALLOTS:EMPTY_TALLY:V1"));
};
