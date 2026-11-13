import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "api_security_test_secret_987654";
process.env.BALLOT_HMAC_SECRET = "api_hmac_test_secret_987654";

const { default: app } = await import("../src/app.js");

let server;
let baseUrl;
let originalReadyStateDescriptor;

before(async () => {
    // Stub mongoose readyState=1 so /api middleware passes cleanly in route security unit tests without external Atlas DB
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

test("Protected admin and organizer endpoints reject unauthenticated requests", async () => {
    const protectedRequests = [
        { method: "GET", path: "/api/coupons" },
        { method: "POST", path: "/api/coupons/create", body: { code: "FREE100", discountPercentage: 100 } },
        { method: "DELETE", path: "/api/coupons/65f000000000000000000001" },
        { method: "POST", path: "/api/voters", body: { electionId: "65f000000000000000000001", cedula: "1-9", name: "X" } },
        { method: "POST", path: "/api/voters/bulk", body: { electionId: "65f000000000000000000001", voters: [] } },
        { method: "GET", path: "/api/voters/65f000000000000000000001" },
        { method: "PUT", path: "/api/elections/65f000000000000000000001/evaluate", body: { approvalStatus: "approved" } },
        { method: "GET", path: "/api/elections/65f000000000000000000001/voters" },
        { method: "GET", path: "/api/elections/65f000000000000000000001/report" },
        { method: "POST", path: "/api/elections/65f000000000000000000001/anchor" },
        { method: "POST", path: "/api/payments/confirm-manual/65f000000000000000000001" },
        { method: "POST", path: "/api/ballots", body: {} }
    ];

    for (const reqSpec of protectedRequests) {
        const res = await fetch(`${baseUrl}${reqSpec.path}`, {
            method: reqSpec.method,
            headers: { "Content-Type": "application/json" },
            body: reqSpec.body ? JSON.stringify(reqSpec.body) : undefined
        });
        assert.equal(res.status, 401, `${reqSpec.method} ${reqSpec.path} should return 401`);
    }
});

test("Non-admin organizers cannot evaluate elections, manage coupons, or confirm manual payments", async () => {
    const organizerToken = jwt.sign(
        { id: "65f000000000000000000099", role: "organizer", email: "org@test.cl" },
        process.env.JWT_SECRET
    );

    const adminOnlyRoutes = [
        { method: "GET", path: "/api/coupons" },
        { method: "POST", path: "/api/coupons/create", body: { code: "HACK100", discountPercentage: 100 } },
        { method: "PUT", path: "/api/elections/65f000000000000000000001/evaluate", body: { approvalStatus: "approved" } },
        { method: "POST", path: "/api/payments/confirm-manual/65f000000000000000000001" },
        { method: "POST", path: "/api/ballots", body: { electionId: "65f000000000000000000001" } }
    ];

    for (const reqSpec of adminOnlyRoutes) {
        const res = await fetch(`${baseUrl}${reqSpec.path}`, {
            method: reqSpec.method,
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${organizerToken}`
            },
            body: reqSpec.body ? JSON.stringify(reqSpec.body) : undefined
        });
        assert.equal(res.status, 403, `${reqSpec.method} ${reqSpec.path} should forbid organizer`);
    }
});

test("Legacy unauthenticated vote endpoint returns 410 Gone and web3-status endpoint responds cleanly", async () => {
    const legacyRes = await fetch(`${baseUrl}/api/elections/65f000000000000000000001/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cedula: "12345678-9" })
    });
    assert.equal(legacyRes.status, 410);

    const web3Res = await fetch(`${baseUrl}/api/ballots/web3-status`);
    assert.equal(web3Res.status, 200);
    const json = await web3Res.json();
    assert.equal(json.success, true);
    assert.ok("configured" in json.data);
});

