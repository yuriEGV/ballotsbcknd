import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "sec_hardening_test_jwt_2026";
process.env.BALLOT_HMAC_SECRET = process.env.BALLOT_HMAC_SECRET || "sec_hardening_test_hmac_2026";

const { default: app } = await import("../src/app.js");
const { default: User } = await import("../src/models/User.js");
const { default: Election } = await import("../src/models/Election.js");
const { default: Ballot } = await import("../src/models/Ballot.js");
const { default: CitizenProfile } = await import("../src/models/CitizenProfile.js");
const { bridgeUserToPlaza, getPublicSurveys } = await import("../src/controllers/plazaController.js");
const { handleWebhook } = await import("../src/controllers/paymentController.js");

function makeQuery(result) {
    const p = Promise.resolve(result);
    p.select = () => p;
    p.populate = () => p;
    p.sort = () => p;
    p.lean = () => Promise.resolve(result);
    return p;
}

function createMockRes() {
    return {
        statusCode: 200,
        body: null,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        sendStatus(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
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

test("Plaza Ciudadana routes strictly require authenticated Citizen/Platform session and block Voter tokens", async () => {
    const validId = new mongoose.Types.ObjectId().toString();
    const unauthCalls = [
        { method: "GET", path: "/api/plaza/surveys" },
        { method: "GET", path: `/api/plaza/surveys/${validId}/results` },
        { method: "POST", path: `/api/plaza/surveys/${validId}/respond`, body: { cedula: "12345678-9" } },
        { method: "POST", path: "/api/plaza/profile", body: { cedula: "12345678-9" } },
        { method: "GET", path: "/api/plaza/profile/me" },
        { method: "POST", path: "/api/plaza/rewards/redeem", body: { rewardId: "cupon-encuesta-15" } },
        { method: "POST", path: "/api/plaza/auth/bridge", body: { cedula: "12345678-9" } }
    ];

    for (const c of unauthCalls) {
        const res = await fetch(`${baseUrl}${c.path}`, {
            method: c.method,
            headers: { "Content-Type": "application/json" },
            body: c.body ? JSON.stringify(c.body) : undefined
        });
        assert.equal(res.status, 401, `${c.method} ${c.path} must reject unauthenticated requests`);
    }

    // Voter tokens scoped to single election must NEVER access Plaza endpoints
    const voterToken = jwt.sign(
        { id: validId, electionId: validId, role: "voter" },
        process.env.JWT_SECRET
    );
    const voterRes = await fetch(`${baseUrl}/api/plaza/surveys`, {
        headers: { Authorization: `Bearer ${voterToken}` }
    });
    assert.equal(voterRes.status, 403);
});

test("IDOR & ObjectId validation block draft election exposure and malformed IDs", async () => {
    const badIdRes = await fetch(`${baseUrl}/api/elections/not-a-valid-object-id`);
    assert.equal(badIdRes.status, 400);

    const originalFindById = Election.findById;
    const draftId = new mongoose.Types.ObjectId();

    try {
        Election.findById = () => makeQuery({
            _id: draftId,
            title: "Borrador Confidencial",
            status: "draft",
            approvalStatus: "pending",
            organizer: new mongoose.Types.ObjectId(),
            candidates: [],
            questions: [],
            settings: {}
        });

        const draftRes = await fetch(`${baseUrl}/api/elections/${draftId.toString()}`);
        assert.equal(draftRes.status, 403);
    } finally {
        Election.findById = originalFindById;
    }
});

test("CORS allowlist, security headers, NoSQL injection sanitization, and rate limiter work properly", async () => {
    // 1. Disallowed CORS origin rejected with 403
    const badCorsRes = await fetch(`${baseUrl}/api/ballots/web3-status`, {
        headers: { Origin: "https://evil-attacker.example" }
    });
    assert.equal(badCorsRes.status, 403);

    // 2. Allowed frontend origin permitted + security headers present
    const okCorsRes = await fetch(`${baseUrl}/api/plaza/pricing`, {
        headers: { Origin: "https://ballotsfrntnd.vercel.app" }
    });
    assert.equal(okCorsRes.status, 200);
    assert.equal(okCorsRes.headers.get("access-control-allow-origin"), "https://ballotsfrntnd.vercel.app");
    assert.equal(okCorsRes.headers.get("x-powered-by"), null);
    assert.ok(okCorsRes.headers.get("referrer-policy"));

    // 3. NoSQL operator injection sanitized safely in /api/auth/login
    const origUserFindOne = User.findOne;
    let querySeen = null;
    try {
        User.findOne = async (q) => {
            querySeen = q;
            return null;
        };
        const injRes = await fetch(`${baseUrl}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: { $ne: "" }, password: { $gt: "" } })
        });
        assert.equal(injRes.status, 400);
        assert.equal(querySeen, null);
    } finally {
        User.findOne = origUserFindOne;
    }

    // 4. Rate limiter returns 429 + Retry-After when activated
    let got429 = false;
    let retryAfter = null;
    const origFind = User.findOne;
    User.findOne = async () => null;
    try {
        for (let i = 0; i < 30; i++) {
            const rlRes = await fetch(`${baseUrl}/api/auth/login`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-test-rate-limit": "1",
                    "x-forwarded-for": "198.51.100.42"
                },
                body: JSON.stringify({ email: "test@example.com", password: "wrong" })
            });
            if (rlRes.status === 429) {
                got429 = true;
                retryAfter = rlRes.headers.get("retry-after");
                break;
            }
        }
        assert.equal(got429, true);
        assert.ok(Number(retryAfter) >= 1);
    } finally {
        User.findOne = origFind;
    }
});

test("bridgeUserToPlaza prevents hijacking an existing citizen RUT and getPublicSurveys uses Ballot.aggregate", async () => {
    const origProfileFindOne = CitizenProfile.findOne;
    const origUserFindById = User.findById;
    const origElectionFind = Election.find;
    const origBallotAggregate = Ballot.aggregate;

    try {
        // 1. Organizer trying to link a RUT owned by another CitizenProfile -> 409
        const orgUserId = new mongoose.Types.ObjectId();
        User.findById = () => makeQuery({ username: "org", email: "org@empresa.cl" });
        CitizenProfile.findOne = async (q) => {
            if (q.linkedUser) return null;
            return { _id: new mongoose.Types.ObjectId(), cedulaNormalized: "155555551" };
        };

        const resConflict = createMockRes();
        await bridgeUserToPlaza({
            user: { id: orgUserId.toString(), role: "organizer" },
            body: { cedula: "15.555.555-1" }
        }, resConflict);
        assert.equal(resConflict.statusCode, 409);

        // 2. getPublicSurveys uses Ballot.aggregate when DB readyState === 1
        const sId = new mongoose.Types.ObjectId();
        const qId = new mongoose.Types.ObjectId();
        let aggCalls = 0;
        Election.find = () => makeQuery([{
            _id: sId,
            title: "Encuesta Optimizada",
            processKind: "survey",
            status: "active",
            plaza: { featuredInPlaza: true, category: "Ciudadanía", rewardPoints: 50 },
            settings: { publicResults: true, allowAutoRegistration: true },
            candidates: [],
            questions: [{ _id: qId, prompt: "¿Tema?", options: [{ label: "Educación" }] }],
            web3: {}
        }]);
        Ballot.aggregate = async (pipeline) => {
            aggCalls += 1;
            const hasUnwind = pipeline.some((stage) => "$unwind" in stage);
            if (!hasUnwind) {
                return [{ _id: { election: sId, candidate: null }, count: 12, anchoredCount: 10 }];
            }
            return [{
                _id: { election: sId, questionId: qId.toString(), questionPrompt: "¿Tema?", option: "Educación" },
                count: 9
            }];
        };

        const resSurveys = createMockRes();
        await getPublicSurveys({ query: {} }, resSurveys);
        assert.equal(resSurveys.statusCode, 200);
        assert.equal(aggCalls, 2);
        assert.equal(resSurveys.body.data.surveys[0].participantsCount, 12);
        assert.equal(resSurveys.body.data.surveys[0].anchoredCount, 10);
        assert.equal(resSurveys.body.data.surveys[0].results.questionResults[0].options[0].votes, 9);
    } finally {
        CitizenProfile.findOne = origProfileFindOne;
        User.findById = origUserFindById;
        Election.find = origElectionFind;
        Ballot.aggregate = origBallotAggregate;
    }
});

test("MercadoPago webhook signature check never throws RangeError on malformed signature length", async () => {
    const prevSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    process.env.MERCADOPAGO_WEBHOOK_SECRET = "mp_webhook_secret_test_12345";
    try {
        const res = createMockRes();
        await handleWebhook({
            headers: {
                "x-signature": "ts=1700000,v1=shortbad",
                "x-request-id": "req-123"
            },
            query: { "data.id": "999" },
            body: {}
        }, res);
        assert.equal(res.statusCode, 401);
    } finally {
        if (prevSecret === undefined) delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
        else process.env.MERCADOPAGO_WEBHOOK_SECRET = prevSecret;
    }
});
