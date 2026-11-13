import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "ballot_service_test_secret_123";
process.env.BALLOT_HMAC_SECRET = "ballot_service_hmac_secret_123";
delete process.env.WEB3_RPC_URL;
delete process.env.WEB3_PRIVATE_KEY;
delete process.env.WEB3_CONTRACT_ADDRESS;
process.env.WEB3_STRICT_MODE = "false";

import Election from "../src/models/Election.js";
import Voter from "../src/models/Voter.js";
import Ballot from "../src/models/Ballot.js";
import User from "../src/models/User.js";
import ballotService from "../src/services/ballotService.js";
import { getAuditLog, verifyBallotReceipt } from "../src/controllers/auditController.js";
import { register } from "../src/controllers/authController.js";

const electionId = new mongoose.Types.ObjectId().toString();
const organizerId = new mongoose.Types.ObjectId().toString();
const candidate1Id = new mongoose.Types.ObjectId().toString();
const candidate2Id = new mongoose.Types.ObjectId().toString();
const voter1Id = new mongoose.Types.ObjectId().toString();
const voter2Id = new mongoose.Types.ObjectId().toString();

let electionsStore = [];
let votersStore = [];
let ballotsStore = [];
let usersStore = [];

const originals = {};

function makeQuery(docOrList) {
    return {
        select() { return this; },
        sort() { return this; },
        lean() { return Promise.resolve(docOrList); },
        then(resolve, reject) { return Promise.resolve(docOrList).then(resolve, reject); }
    };
}

function makeRes() {
    const res = {
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        cookie() { return this; },
        json(payload) { this.body = payload; return this; }
    };
    return res;
}

before(() => {
    electionsStore = [{
        _id: electionId,
        title: "Elección Sindicato 2026",
        organizer: organizerId,
        status: "active",
        approvalStatus: "approved",
        isPaid: true,
        startDate: new Date(Date.now() - 60_000),
        endDate: new Date(Date.now() + 3_600_000),
        candidates: [
            { _id: candidate1Id, name: "Ana" },
            { _id: candidate2Id, name: "Luis" }
        ],
        settings: { anonymous: true, publicResults: false, weightedVoting: true },
        ballotSequence: 0,
        chainTip: "0x" + "0".repeat(64),
        web3: {}
    }];

    votersStore = [
        {
            _id: voter1Id,
            election: electionId,
            name: "Votante 1",
            cedula: "12.345.678-9",
            cedulaNormalized: "123456789",
            weight: 2,
            hasVoted: false,
            votingKey: "111222"
        },
        {
            _id: voter2Id,
            election: electionId,
            name: "Votante 2",
            cedula: "98.765.432-1",
            cedulaNormalized: "987654321",
            weight: 1,
            hasVoted: false,
            votingKey: "333444"
        }
    ];

    ballotsStore = [];
    usersStore = [];

    originals.ElectionFindById = Election.findById;
    originals.ElectionFindOneAndUpdate = Election.findOneAndUpdate;
    originals.ElectionFindByIdAndUpdate = Election.findByIdAndUpdate;
    originals.VoterFindById = Voter.findById;
    originals.VoterFindOneAndUpdate = Voter.findOneAndUpdate;
    originals.VoterUpdateOne = Voter.updateOne;
    originals.VoterFind = Voter.find;
    originals.BallotExists = Ballot.exists;
    originals.BallotCreate = Ballot.create;
    originals.BallotFind = Ballot.find;
    originals.BallotFindOne = Ballot.findOne;
    originals.UserFindOne = User.findOne;
    originals.UserCreate = User.create;

    Election.findById = (id) => makeQuery(electionsStore.find((e) => e._id === id.toString()) || null);
    Election.findOneAndUpdate = (filter, update) => {
        const el = electionsStore.find(
            (e) => e._id === filter._id.toString() && e.ballotSequence === filter.ballotSequence
        );
        if (!el) return makeQuery(null);
        if (update.$set?.chainTip) el.chainTip = update.$set.chainTip;
        if (update.$inc?.ballotSequence) el.ballotSequence += update.$inc.ballotSequence;
        return makeQuery(el);
    };
    Election.findByIdAndUpdate = (id, update) => {
        const el = electionsStore.find((e) => e._id === id.toString());
        if (el && update.$set) Object.assign(el, update.$set);
        return makeQuery(el);
    };

    Voter.findById = (id) => makeQuery(votersStore.find((v) => v._id === id.toString()) || null);
    Voter.findOneAndUpdate = (filter, update) => {
        const v = votersStore.find(
            (x) =>
                x._id === filter._id.toString() &&
                x.election === filter.election.toString() &&
                x.hasVoted === filter.hasVoted
        );
        if (!v) return makeQuery(null);
        if (update.$set) Object.assign(v, update.$set);
        if (update.$unset?.votingKey) delete v.votingKey;
        return makeQuery(v);
    };
    Voter.updateOne = (filter, update) => {
        const v = votersStore.find((x) => x._id === filter._id.toString());
        if (v && update.$set) Object.assign(v, update.$set);
        return Promise.resolve({ modifiedCount: v ? 1 : 0 });
    };
    Voter.find = (filter) =>
        makeQuery(votersStore.filter((v) => v.election === filter.election.toString()));

    Ballot.exists = (filter) =>
        Promise.resolve(
            ballotsStore.some(
                (b) => b.election === filter.election.toString() && b.nullifierHash === filter.nullifierHash
            )
        );
    Ballot.create = (doc) => {
        const dup = ballotsStore.some(
            (b) => b.election === doc.election.toString() && b.nullifierHash === doc.nullifierHash
        );
        if (dup) throw new Error("E11000 duplicate key error on nullifierHash");
        const created = {
            ...doc,
            _id: new mongoose.Types.ObjectId().toString(),
            createdAt: new Date()
        };
        ballotsStore.push(created);
        return Promise.resolve(created);
    };
    Ballot.find = (filter) =>
        makeQuery(
            ballotsStore
                .filter((b) => b.election === filter.election.toString())
                .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
        );
    Ballot.findOne = (filter) => {
        const found = ballotsStore.find(
            (b) =>
                b.election === filter.election.toString() &&
                (!filter.ballotCommitment || b.ballotCommitment === filter.ballotCommitment)
        );
        return makeQuery(found || null);
    };

    User.findOne = () => Promise.resolve(null);
    User.create = (data) => {
        const u = { ...data, _id: new mongoose.Types.ObjectId().toString() };
        usersStore.push(u);
        return Promise.resolve(u);
    };
});

after(() => {
    Election.findById = originals.ElectionFindById;
    Election.findOneAndUpdate = originals.ElectionFindOneAndUpdate;
    Election.findByIdAndUpdate = originals.ElectionFindByIdAndUpdate;
    Voter.findById = originals.VoterFindById;
    Voter.findOneAndUpdate = originals.VoterFindOneAndUpdate;
    Voter.updateOne = originals.VoterUpdateOne;
    Voter.find = originals.VoterFind;
    Ballot.exists = originals.BallotExists;
    Ballot.create = originals.BallotCreate;
    Ballot.find = originals.BallotFind;
    Ballot.findOne = originals.BallotFindOne;
    User.findOne = originals.UserFindOne;
    User.create = originals.UserCreate;
});

test("Public register forces organizer role and blocks admin escalation", async () => {
    const req = {
        body: {
            username: "attacker",
            email: "attacker@test.cl",
            password: "password123",
            role: "admin"
        }
    };
    const res = makeRes();
    await register(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.user.role, "organizer");
});

test("castVote enforces atomic single-vote concurrency, secrecy, and tamper-evident audit", async () => {
    // Reject invalid candidate ID
    await assert.rejects(
        () => ballotService.castVote(voter1Id, electionId, new mongoose.Types.ObjectId().toString(), "1.2.3.4", "UA", false, "111222"),
        /Candidato inválido/
    );

    // Concurrent race condition by the same voter: only ONE succeeds
    const results = await Promise.allSettled([
        ballotService.castVote(voter1Id, electionId, candidate1Id, "1.2.3.4", "UA", false, "111222"),
        ballotService.castVote(voter1Id, electionId, candidate2Id, "1.2.3.4", "UA", false, "111222")
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(ballotsStore.length, 1);

    // Second voter casts a valid voto nulo
    const ballot2 = await ballotService.castVote(voter2Id, electionId, null, "5.6.7.8", "UA2", true, "333444");
    assert.equal(ballot2.sequenceIndex, 1);
    assert.equal(ballot2.previousHash, fulfilled[0].value.hash);

    // Confirm zero PII on stored Ballot records
    for (const stored of ballotsStore) {
        assert.equal("voter" in stored, false);
        assert.equal("ipAddress" in stored, false);
        assert.equal("device" in stored, false);
    }

    // Verify audit log passes full mathematical recomputation
    const auditRes = makeRes();
    await getAuditLog({ params: { id: electionId }, user: { id: organizerId, role: "organizer" } }, auditRes);
    assert.equal(auditRes.statusCode, 200);
    assert.equal(auditRes.body.data.chainIntegrity, true);
    assert.equal(auditRes.body.data.totalVotes, 2);

    // Verify single ballot receipt lookup
    const verifyRes = makeRes();
    await verifyBallotReceipt(
        { params: { id: electionId, commitment: ballot2.ballotCommitment } },
        verifyRes
    );
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.body.data.cryptographicValid, true);

    // Tamper with ballot #0 candidate in DB and confirm audit detects tampering immediately
    ballotsStore[0].candidate = candidate2Id;
    const tamperedAuditRes = makeRes();
    await getAuditLog({ params: { id: electionId }, user: { id: organizerId, role: "organizer" } }, tamperedAuditRes);
    assert.equal(tamperedAuditRes.body.data.chainIntegrity, false);
    assert.equal(tamperedAuditRes.body.data.auditTrail[0].commitmentValid, false);
});

