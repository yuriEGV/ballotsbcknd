import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    generateRandomBytes32
} from "../src/utils/crypto.js";
import web3Service from "../src/services/web3Service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const artifact = JSON.parse(
    fs.readFileSync(path.join(rootDir, "src", "web3", "BallotsRegistry.json"), "utf8")
);

// Standard Hardhat deterministic test account #0 (local-only, never used on real networks)
const HARDHAT_PK_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const HARDHAT_PK_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const RPC_PORT = 18545;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;

let hardhatProc = null;
let contractAddress = "";
let provider = null;

async function waitForRpc(url, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })
            });
            if (res.ok) {
                return new ethers.JsonRpcProvider(url, undefined, { cacheTimeout: -1 });
            }
        } catch {
            // Hardhat node still starting
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("Timed out waiting for local Hardhat EVM RPC node");
}

before(async () => {
    process.env.JWT_SECRET = "test_jwt_secret_for_web3";
    process.env.BALLOT_HMAC_SECRET = "test_hmac_secret_for_web3";

    const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
    hardhatProc = spawn(npxBin, ["hardhat", "node", "--port", String(RPC_PORT)], {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32"
    });

    provider = await waitForRpc(RPC_URL);
    const deployer = new ethers.Wallet(HARDHAT_PK_0, provider);
    const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
    const contract = await factory.deploy();
    await contract.waitForDeployment();
    contractAddress = await contract.getAddress();

    process.env.WEB3_RPC_URL = RPC_URL;
    process.env.WEB3_PRIVATE_KEY = HARDHAT_PK_0;
    process.env.WEB3_CONTRACT_ADDRESS = contractAddress;
    process.env.WEB3_STRICT_MODE = "true";
    process.env.WEB3_NETWORK_NAME = "Hardhat Local EVM";
});

after(() => {
    if (hardhatProc) {
        if (process.platform === "win32") {
            spawn("taskkill", ["/pid", String(hardhatProc.pid), "/f", "/t"], { stdio: "ignore" });
        } else {
            hardhatProc.kill("SIGTERM");
        }
    }
});

test("BallotsRegistry smart contract enforces uniqueness, zero-PII, rolling tip, and finalization", async () => {
    const status = await web3Service.getWeb3Status();
    assert.equal(status.configured, true);
    assert.equal(status.chainId, 31337);
    assert.equal(status.contractAddress, contractAddress);

    const electionId = "65f111111111111111111111";
    const candidateA = "65f111111111111111111aaa";
    const candidateB = "65f111111111111111111bbb";
    const startDate = new Date(Date.now() - 60_000);
    const endDate = new Date(Date.now() + 3_600_000);

    const padronLeaves = [
        computePadronLeaf(electionId, "12.345.678-9"),
        computePadronLeaf(electionId, "98.765.432-1"),
        computePadronLeaf(electionId, "15.555.555-K")
    ];
    const padronRoot = computeMerkleRoot(padronLeaves);

    // 1. Register election on-chain
    const reg1 = await web3Service.ensureElectionRegistered({
        electionId,
        padronRoot,
        openPadron: false,
        startDate,
        endDate
    });
    assert.equal(reg1.registered, true);
    assert.equal(reg1.alreadyRegistered, false);
    assert.ok(reg1.txHash);

    // Idempotent second call
    const reg2 = await web3Service.ensureElectionRegistered({
        electionId,
        padronRoot,
        openPadron: false,
        startDate,
        endDate
    });
    assert.equal(reg2.alreadyRegistered, true);

    // 2. Cast two concurrent votes from different voters (serializes relayer nonce safely)
    const n1 = computeVoterNullifier(electionId, "12.345.678-9");
    const c1 = computeBallotCommitment({
        electionId,
        candidateId: candidateA,
        isNulo: false,
        weight: 1,
        ballotNonce: generateRandomBytes32(),
        timestampMs: Date.now()
    });

    const n2 = computeVoterNullifier(electionId, "98.765.432-1");
    const c2 = computeBallotCommitment({
        electionId,
        candidateId: candidateB,
        isNulo: false,
        weight: 2,
        ballotNonce: generateRandomBytes32(),
        timestampMs: Date.now() + 5
    });

    const [anchor1, anchor2] = await Promise.all([
        web3Service.anchorVote({
            electionId,
            nullifierHash: n1,
            ballotCommitment: c1.ballotCommitment,
            weight: 1,
            padronRoot,
            openPadron: false,
            startDate,
            endDate
        }),
        web3Service.anchorVote({
            electionId,
            nullifierHash: n2,
            ballotCommitment: c2.ballotCommitment,
            weight: 2,
            padronRoot,
            openPadron: false,
            startDate,
            endDate
        })
    ]);

    assert.equal(anchor1.anchored, true);
    assert.equal(anchor2.anchored, true);
    assert.equal(anchor1.onChainVoteIndex, 0);
    assert.equal(anchor2.onChainVoteIndex, 1);
    assert.equal(anchor1.onChainPreviousTip, GENESIS_HASH);
    assert.equal(anchor2.onChainPreviousTip, anchor1.onChainNewTip);

    // Rolling hash formula off-chain matches Solidity chainTip byte-for-byte
    const expectedTip1 = computeRollingHash({
        previousHash: GENESIS_HASH,
        nullifierHash: n1,
        ballotCommitment: c1.ballotCommitment,
        weight: 1
    });
    const expectedTip2 = computeRollingHash({
        previousHash: expectedTip1,
        nullifierHash: n2,
        ballotCommitment: c2.ballotCommitment,
        weight: 2
    });
    assert.equal(anchor1.onChainNewTip.toLowerCase(), expectedTip1.toLowerCase());
    assert.equal(anchor2.onChainNewTip.toLowerCase(), expectedTip2.toLowerCase());

    // 3. Verify zero PII / candidate strings inside raw EVM transaction calldata
    const tx1 = await provider.getTransaction(anchor1.txHash);
    assert.equal(tx1.data.toLowerCase().includes("12345678"), false);
    assert.equal(tx1.data.toLowerCase().includes(candidateA.toLowerCase()), false);

    // 4. Reject duplicate vote ON-CHAIN for the same voter nullifier (even with a new commitment!)
    const fakeCommitment = generateRandomBytes32();
    await assert.rejects(
        () =>
            web3Service.anchorVote({
                electionId,
                nullifierHash: n1,
                ballotCommitment: fakeCommitment,
                weight: 1,
                padronRoot,
                openPadron: false,
                startDate,
                endDate
            }),
        /duplicate vote rejected/i
    );

    // 5. Reject unauthorized wallet calling smart contract directly
    const attackerWallet = new ethers.Wallet(HARDHAT_PK_1, provider);
    const attackerContract = new ethers.Contract(contractAddress, artifact.abi, attackerWallet);
    await assert.rejects(
        () =>
            attackerContract.castVote(
                computeElectionKey(electionId),
                generateRandomBytes32(),
                generateRandomBytes32(),
                1n
            ),
        /caller is not relayer/i
    );

    // 6. Reject padron alteration after votes cast (closed padron)
    await assert.rejects(
        () => attackerContract.updatePadronRoot(computeElectionKey(electionId), generateRandomBytes32()),
        /caller is not relayer/i
    );
    const relayerContract = new ethers.Contract(
        contractAddress,
        artifact.abi,
        new ethers.Wallet(HARDHAT_PK_0, provider)
    );
    await assert.rejects(
        () => relayerContract.updatePadronRoot(computeElectionKey(electionId), generateRandomBytes32()),
        /padron frozen/i
    );

    // 7. Verify individual receipt on-chain
    const receiptCheck = await web3Service.verifyReceiptOnChain({
        electionId,
        nullifierHash: n1,
        ballotCommitment: c1.ballotCommitment
    });
    assert.equal(receiptCheck.verified, true);
    assert.equal(receiptCheck.voteIndex, 0);

    // 8. Finalize election on-chain with tallyRoot and ensure further votes are blocked
    const tallyRoot = computeMerkleRoot([
        computeTallyLeaf({ ballotCommitment: c1.ballotCommitment, choiceHash: c1.choiceHash, weight: 1 }),
        computeTallyLeaf({ ballotCommitment: c2.ballotCommitment, choiceHash: c2.choiceHash, weight: 2 })
    ]);
    const finalized = await web3Service.finalizeElectionOnChain({
        electionId,
        tallyRoot,
        padronRoot,
        openPadron: false,
        startDate,
        endDate
    });
    assert.equal(finalized.finalized, true);
    assert.ok(finalized.txHash);

    const onChainRecord = await web3Service.getElectionOnChain(electionId);
    assert.equal(onChainRecord.finalized, true);
    assert.equal(onChainRecord.voteCount, 2);
    assert.equal(onChainRecord.totalWeight, 3);
    assert.equal(onChainRecord.chainTip.toLowerCase(), expectedTip2.toLowerCase());
    assert.equal(onChainRecord.tallyRoot.toLowerCase(), tallyRoot.toLowerCase());

    const n3 = computeVoterNullifier(electionId, "15.555.555-K");
    await assert.rejects(
        () =>
            web3Service.anchorVote({
                electionId,
                nullifierHash: n3,
                ballotCommitment: generateRandomBytes32(),
                weight: 1,
                padronRoot,
                openPadron: false,
                startDate,
                endDate
            }),
        /already finalized/i
    );
});

test("Full integrated castVote -> Smart Contract -> getAuditLog -> verifyBallotReceipt flow", async () => {
    const mongoose = (await import("mongoose")).default;
    const { default: Election } = await import("../src/models/Election.js");
    const { default: Voter } = await import("../src/models/Voter.js");
    const { default: Ballot } = await import("../src/models/Ballot.js");
    const { default: ballotService } = await import("../src/services/ballotService.js");
    const { getAuditLog, verifyBallotReceipt } = await import("../src/controllers/auditController.js");

    const eId = new mongoose.Types.ObjectId().toString();
    const orgId = new mongoose.Types.ObjectId().toString();
    const candA = new mongoose.Types.ObjectId().toString();
    const v1Id = new mongoose.Types.ObjectId().toString();

    const el = {
        _id: eId,
        title: "Integración Real EVM",
        organizer: orgId,
        status: "active",
        approvalStatus: "approved",
        isPaid: true,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 3_600_000),
        candidates: [{ _id: candA, name: "Candidata Web3" }],
        settings: { anonymous: true, publicResults: true, weightedVoting: false },
        ballotSequence: 0,
        chainTip: GENESIS_HASH,
        web3: {}
    };
    const voter = {
        _id: v1Id,
        election: eId,
        name: "Votante Real",
        cedula: "10.200.300-4",
        cedulaNormalized: "102003004",
        weight: 1,
        hasVoted: false,
        votingKey: "998877"
    };
    const ballots = [];

    const orig = {
        ef: Election.findById,
        efu: Election.findByIdAndUpdate,
        vf: Voter.findById,
        vf1u: Voter.findOneAndUpdate,
        vfind: Voter.find,
        vu: Voter.updateOne,
        be: Ballot.exists,
        bc: Ballot.create,
        bf: Ballot.find,
        bf1: Ballot.findOne
    };

    const q = (val) => ({
        select() { return this; },
        sort() { return this; },
        lean() { return Promise.resolve(val); },
        then(res, rej) { return Promise.resolve(val).then(res, rej); }
    });

    Election.findById = () => q(el);
    Election.findByIdAndUpdate = (_id, upd) => {
        if (upd.$set) Object.assign(el, upd.$set);
        return q(el);
    };
    Voter.findById = () => q(voter);
    Voter.findOneAndUpdate = (f) => {
        if (voter.hasVoted !== f.hasVoted) return q(null);
        voter.hasVoted = true;
        voter.votedAt = new Date();
        delete voter.votingKey;
        return q(voter);
    };
    Voter.find = () => q([voter]);
    Voter.updateOne = () => Promise.resolve({ modifiedCount: 1 });
    Ballot.exists = (f) => Promise.resolve(ballots.some((b) => b.nullifierHash === f.nullifierHash));
    Ballot.create = (d) => {
        const created = { ...d, _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date() };
        ballots.push(created);
        return Promise.resolve(created);
    };
    Ballot.find = () => q(ballots);
    Ballot.findOne = (f) => q(ballots.find((b) => b.ballotCommitment === f.ballotCommitment) || null);

    try {
        const receipt = await ballotService.castVote(v1Id, eId, candA, "1.1.1.1", "TestUA", false, "998877");
        assert.equal(receipt.web3.anchored, true);
        assert.equal(receipt.web3.onChainVoteIndex, 0);
        assert.ok(receipt.web3.txHash);

        const auditRes = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
        await getAuditLog({ params: { id: eId } }, auditRes);
        assert.equal(auditRes.statusCode, 200);
        assert.equal(auditRes.body.data.chainIntegrity, true);
        assert.equal(auditRes.body.data.matchesOnChainTip, true);
        assert.equal(auditRes.body.data.anchoredVotesCount, 1);

        const verifyRes = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; } };
        await verifyBallotReceipt({ params: { id: eId, commitment: receipt.ballotCommitment } }, verifyRes);
        assert.equal(verifyRes.statusCode, 200);
        assert.equal(verifyRes.body.data.cryptographicValid, true);
        assert.equal(verifyRes.body.data.web3.onChainVerified, true);
    } finally {
        Election.findById = orig.ef;
        Election.findByIdAndUpdate = orig.efu;
        Voter.findById = orig.vf;
        Voter.findOneAndUpdate = orig.vf1u;
        Voter.find = orig.vfind;
        Voter.updateOne = orig.vu;
        Ballot.exists = orig.be;
        Ballot.create = orig.bc;
        Ballot.find = orig.bf;
        Ballot.findOne = orig.bf1;
    }
});
