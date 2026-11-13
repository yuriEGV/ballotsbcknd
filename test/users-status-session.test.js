import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { ethers } from "ethers";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "users_status_session_test_jwt_2026";
process.env.BALLOT_HMAC_SECRET = process.env.BALLOT_HMAC_SECRET || "users_status_session_test_hmac_2026";

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/User.js");
const { default: Election } = await import("../src/models/Election.js");
const { default: Ballot } = await import("../src/models/Ballot.js");
const { default: Voter } = await import("../src/models/Voter.js");
const { default: web3Service } = await import("../src/services/web3Service.js");
const { createUser, updateUser } = await import("../src/controllers/userController.js");
const { updateElectionStatus } = await import("../src/controllers/electionController.js");
const { computeElectionTallyRoot } = await import("../src/controllers/auditController.js");
const { computeEmptyTallyRoot } = await import("../src/utils/crypto.js");

function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

function makeChainableQuery(result) {
    const p = Promise.resolve(result);
    p.select = () => p;
    p.sort = () => p;
    p.lean = () => Promise.resolve(result);
    return p;
}

let server;
let baseUrl;
let originalReadyStateDescriptor;

before(async () => {
    originalReadyStateDescriptor = Object.getOwnPropertyDescriptor(mongoose.connection, "readyState");
    Object.defineProperty(mongoose.connection, "readyState", {
        configurable: true,
        get: () => 1
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
    if (originalReadyStateDescriptor) {
        Object.defineProperty(mongoose.connection, "readyState", originalReadyStateDescriptor);
    } else {
        delete mongoose.connection.readyState;
    }
    if (server) {
        await new Promise((resolve) => server.close(resolve));
    }
});

test("createUser and updateUser normalize legacy 'client' role, update fields/password, and reject duplicates", async () => {
    const originalFindOne = User.findOne;
    const originalCreate = User.create;
    const originalFindById = User.findById;

    const storedUsers = [];

    try {
        User.findOne = async (query) => {
            if (query.$or) {
                return storedUsers.find((u) =>
                    query.$or.some((cond) =>
                        (cond.email && u.email === cond.email) ||
                        (cond.username && u.username === cond.username)
                    )
                ) || null;
            }
            return storedUsers.find((u) => {
                if (query._id?.$ne && String(u._id) === String(query._id.$ne)) return false;
                if (query.email && u.email !== query.email) return false;
                if (query.username && u.username !== query.username) return false;
                return true;
            }) || null;
        };

        User.create = async (payload) => {
            const doc = {
                _id: new mongoose.Types.ObjectId(),
                ...payload,
                savedCount: 0,
                save: async function () {
                    this.savedCount += 1;
                    return this;
                }
            };
            storedUsers.push(doc);
            return doc;
        };

        User.findById = async (id) => storedUsers.find((u) => String(u._id) === String(id)) || null;

        // 1. Create user with legacy 'client' role -> normalized to 'organizer'
        const resCreate = createMockRes();
        await createUser({
            body: {
                username: "ana.organizer",
                email: "ana@empresa.cl",
                password: "secret123",
                organization: "Sindicato Sur",
                role: "client"
            }
        }, resCreate);

        assert.equal(resCreate.statusCode, 201);
        assert.equal(resCreate.body.success, true);
        assert.equal(resCreate.body.data.role, "organizer");
        assert.equal(resCreate.body.data.organization, "Sindicato Sur");
        assert.equal(resCreate.body.data.password, undefined);

        const createdId = resCreate.body.data._id;

        // 2. Reject duplicate email cleanly with 409
        const resDupCreate = createMockRes();
        await createUser({
            body: {
                username: "otra.persona",
                email: "ana@empresa.cl",
                password: "secret123",
                role: "organizer"
            }
        }, resDupCreate);
        assert.equal(resDupCreate.statusCode, 409);

        // 3. Reject short password with 400
        const resShortPass = createMockRes();
        await createUser({
            body: {
                username: "nuevo",
                email: "nuevo@empresa.cl",
                password: "123",
                role: "organizer"
            }
        }, resShortPass);
        assert.equal(resShortPass.statusCode, 400);

        // 4. Update user with role 'client' -> 'organizer', new org, and new password
        const resUpdate = createMockRes();
        await updateUser({
            params: { id: String(createdId) },
            body: {
                username: "ana.updated",
                organization: "Federación Norte",
                role: "client",
                password: "newpassword99"
            }
        }, resUpdate);

        assert.equal(resUpdate.statusCode, 200);
        assert.equal(resUpdate.body.success, true);
        assert.equal(resUpdate.body.data.username, "ana.updated");
        assert.equal(resUpdate.body.data.organization, "Federación Norte");
        assert.equal(resUpdate.body.data.role, "organizer");
        assert.equal(storedUsers[0].password, "newpassword99");
        assert.equal(storedUsers[0].savedCount, 1);

        // 5. Reject invalid role cleanly with 400 (instead of 500)
        const resBadRole = createMockRes();
        await updateUser({
            params: { id: String(createdId) },
            body: { role: "superhacker" }
        }, resBadRole);
        assert.equal(resBadRole.statusCode, 400);
    } finally {
        User.findOne = originalFindOne;
        User.create = originalCreate;
        User.findById = originalFindById;
    }
});

test("computeEmptyTallyRoot and computeElectionTallyRoot never return bytes32(0)", () => {
    const idA = new mongoose.Types.ObjectId();
    const idB = new mongoose.Types.ObjectId();

    const emptyRootA1 = computeEmptyTallyRoot(idA);
    const emptyRootA2 = computeEmptyTallyRoot(idA);
    const emptyRootB = computeEmptyTallyRoot(idB);
    const computedEmpty = computeElectionTallyRoot([], idA);

    assert.match(emptyRootA1, /^0x[0-9a-f]{64}$/i);
    assert.notEqual(emptyRootA1, ethers.ZeroHash);
    assert.equal(emptyRootA1, emptyRootA2);
    assert.notEqual(emptyRootA1, emptyRootB);
    assert.equal(computedEmpty, emptyRootA1);
});

test("updateElectionStatus supports draft/active/ended transitions and seals 0-ballot on-chain elections with non-zero tallyRoot", async () => {
    const originalElectionFindById = Election.findById;
    const originalBallotFind = Ballot.find;
    const originalVoterFind = Voter.find;
    const originalVoterCount = Voter.countDocuments;
    const originalIsWeb3Configured = web3Service.isWeb3Configured;
    const originalRegister = web3Service.ensureElectionRegistered;
    const originalFinalize = web3Service.finalizeElectionOnChain;

    const organizerId = new mongoose.Types.ObjectId();
    const electionId = new mongoose.Types.ObjectId();
    const electionDoc = {
        _id: electionId,
        organizer: organizerId,
        title: "Elección Prueba Estados",
        isPaid: false,
        price: 50000,
        status: "draft",
        approvalStatus: "pending",
        requiresAdminReview: false,
        startDate: new Date(Date.now() + 3600_000),
        endDate: new Date(Date.now() + 7200_000),
        web3: { registered: false },
        save: async function () {
            return this;
        }
    };

    const recordedFinalizations = [];

    try {
        Election.findById = async (id) => (String(id) === String(electionId) ? electionDoc : null);
        Ballot.find = () => makeChainableQuery([]);
        Voter.find = () => makeChainableQuery([]);
        Voter.countDocuments = async () => 5;
        web3Service.isWeb3Configured = () => false;

        // Invalid status -> 400
        const resInvalid = createMockRes();
        await updateElectionStatus({
            params: { id: String(electionId) },
            body: { status: "archived" },
            user: { id: organizerId.toString(), role: "admin" }
        }, resInvalid);
        assert.equal(resInvalid.statusCode, 400);

        // Admin activates unpaid election -> sets status='active' and approvalStatus='approved'
        const resAdminActivate = createMockRes();
        await updateElectionStatus({
            params: { id: String(electionId) },
            body: { status: "active" },
            user: { id: "admin-1", role: "admin" }
        }, resAdminActivate);
        assert.equal(resAdminActivate.statusCode, 200, JSON.stringify(resAdminActivate.body));
        assert.equal(electionDoc.status, "active");
        assert.equal(electionDoc.approvalStatus, "approved");

        // Admin pauses back to 'draft' (Pendiente / Pausada)
        const resAdminPause = createMockRes();
        await updateElectionStatus({
            params: { id: String(electionId) },
            body: { status: "draft" },
            user: { id: "admin-1", role: "admin" }
        }, resAdminPause);
        assert.equal(resAdminPause.statusCode, 200, JSON.stringify(resAdminPause.body));
        assert.equal(electionDoc.status, "draft");

        // Paid & Web3-enabled election ending with 0 ballots sends non-zero tallyRoot to smart contract
        electionDoc.isPaid = true;
        electionDoc.status = "active";
        web3Service.isWeb3Configured = () => true;
        web3Service.ensureElectionRegistered = async () => ({ registered: true, electionKey: computeEmptyTallyRoot(electionId) });
        web3Service.finalizeElectionOnChain = async (params) => {
            recordedFinalizations.push({ id: String(params.electionId), tallyRoot: params.tallyRoot });
            return {
                finalized: true,
                txHash: "0x" + "f".repeat(64),
                chainTip: "0x" + "1".repeat(64),
                tallyRoot: params.tallyRoot
            };
        };

        const resEndZeroBallots = createMockRes();
        await updateElectionStatus({
            params: { id: String(electionId) },
            body: { status: "ended" },
            user: { id: organizerId.toString(), role: "organizer" }
        }, resEndZeroBallots);
        assert.equal(resEndZeroBallots.statusCode, 200, JSON.stringify(resEndZeroBallots.body));
        assert.equal(electionDoc.status, "ended");
        assert.equal(recordedFinalizations.length, 1);
        assert.notEqual(recordedFinalizations[0].tallyRoot, ethers.ZeroHash);
        assert.equal(recordedFinalizations[0].tallyRoot, computeEmptyTallyRoot(electionId));
    } finally {
        Election.findById = originalElectionFindById;
        Ballot.find = originalBallotFind;
        Voter.find = originalVoterFind;
        Voter.countDocuments = originalVoterCount;
        web3Service.isWeb3Configured = originalIsWeb3Configured;
        web3Service.ensureElectionRegistered = originalRegister;
        web3Service.finalizeElectionOnChain = originalFinalize;
    }
});

test("GET /api/auth/me requires JWT and returns verified user profile", async () => {
    const unauthRes = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(unauthRes.status, 401);

    const originalFindById = User.findById;
    const fakeId = new mongoose.Types.ObjectId();
    const token = jwt.sign(
        { id: fakeId.toString(), role: "admin", email: "yuri@ballots.cl" },
        process.env.JWT_SECRET
    );

    try {
        User.findById = () => makeChainableQuery({
            _id: fakeId,
            username: "yuri",
            email: "yuri@ballots.cl",
            role: "admin",
            organization: "Ballots Einsoft"
        });

        const authRes = await fetch(`${baseUrl}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        assert.equal(authRes.status, 200);
        const body = await authRes.json();
        assert.equal(body.success, true);
        assert.equal(body.user.email, "yuri@ballots.cl");
        assert.equal(body.user.role, "admin");
        assert.equal(body.user.username, "yuri");
    } finally {
        User.findById = originalFindById;
    }
});

test("All frontend PRICING_CATALOG property paths exist in frontend pricing catalog", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { PRICING_CATALOG } = await import("../frontend-fixes/src/utils/pricing.js");

    const srcRoot = path.resolve(process.cwd(), "frontend-fixes/src");
    const walk = (dir) => {
        const files = [];
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) files.push(...walk(full));
            else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
        }
        return files;
    };

    const files = walk(srcRoot);
    assert.ok(files.length > 0);
    for (const file of files) {
        const src = fs.readFileSync(file, "utf8");
        for (const m of src.matchAll(/PRICING_CATALOG\.([A-Za-z0-9_.]+)/g)) {
            const keys = m[1].split(".");
            let cur = PRICING_CATALOG;
            for (const key of keys) {
                assert.ok(
                    cur !== null && cur !== undefined && key in cur,
                    `Invalid PRICING_CATALOG.${m[1]} in ${path.relative(srcRoot, file)} (missing "${key}")`
                );
                cur = cur[key];
            }
            assert.notEqual(cur, undefined, `PRICING_CATALOG.${m[1]} in ${file} evaluated to undefined`);
        }
    }
});
