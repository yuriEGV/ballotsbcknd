import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import {
    GENESIS_HASH,
    computeBallotCommitment,
    computeElectionKey,
    computeMerkleRoot,
    computePadronLeaf,
    computeRollingHash,
    computeTallyLeaf,
    computeVoterNullifier,
    generateRandomBytes32,
    normalizeCedula
} from "../src/utils/crypto.js";

test("normalizeCedula strips punctuation, spaces, and normalizes case", () => {
    assert.equal(normalizeCedula("12.345.678-k"), "12345678K");
    assert.equal(normalizeCedula(" 12345678-K "), "12345678K");
    assert.equal(normalizeCedula("12 345 678 k"), "12345678K");
});

test("computeVoterNullifier is deterministic per election+rut and hides PII", () => {
    process.env.JWT_SECRET = "test_secret_123456";
    const n1 = computeVoterNullifier("65f000000000000000000001", "12.345.678-k");
    const n2 = computeVoterNullifier("65f000000000000000000001", "12345678-K");
    const nOtherElection = computeVoterNullifier("65f000000000000000000002", "12345678-K");

    assert.equal(n1, n2);
    assert.notEqual(n1, nOtherElection);
    assert.match(n1, /^0x[0-9a-f]{64}$/);
    assert.equal(n1.toLowerCase().includes("12345678"), false);
});

test("ballot commitment, rolling hash, and Merkle roots are deterministic", () => {
    const electionId = "65f000000000000000000010";
    const candidateId = "65f0000000000000000000aa";
    const nonce = generateRandomBytes32();
    const timestampMs = 1760000000000;

    const c1 = computeBallotCommitment({
        electionId,
        candidateId,
        isNulo: false,
        weight: 2,
        ballotNonce: nonce,
        timestampMs
    });
    const c2 = computeBallotCommitment({
        electionId,
        candidateId,
        isNulo: false,
        weight: 2,
        ballotNonce: nonce,
        timestampMs
    });
    assert.equal(c1.ballotCommitment, c2.ballotCommitment);
    assert.equal(c1.electionKey, computeElectionKey(electionId));

    const nullifier = computeVoterNullifier(electionId, "11.111.111-1");
    const tip1 = computeRollingHash({
        previousHash: GENESIS_HASH,
        nullifierHash: nullifier,
        ballotCommitment: c1.ballotCommitment,
        weight: 2
    });
    assert.match(tip1, /^0x[0-9a-f]{64}$/);

    const padronLeaves = [
        computePadronLeaf(electionId, "11.111.111-1"),
        computePadronLeaf(electionId, "22.222.222-2"),
        computePadronLeaf(electionId, "33.333.333-3")
    ];
    const rootA = computeMerkleRoot(padronLeaves);
    const rootB = computeMerkleRoot([...padronLeaves].reverse());
    assert.equal(rootA, rootB);
    assert.equal(computeMerkleRoot([]), ethers.ZeroHash);

    const tallyLeaf = computeTallyLeaf({
        ballotCommitment: c1.ballotCommitment,
        choiceHash: c1.choiceHash,
        weight: 2
    });
    assert.match(tallyLeaf, /^0x[0-9a-f]{64}$/);
});

