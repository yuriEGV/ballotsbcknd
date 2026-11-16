import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose from "mongoose";
import Coupon from "../src/models/Coupon.js";
import Election from "../src/models/Election.js";
import Voter from "../src/models/Voter.js";
import Ballot from "../src/models/Ballot.js";
import CitizenProfile from "../src/models/CitizenProfile.js";
import User from "../src/models/User.js";
import ballotService from "../src/services/ballotService.js";
import web3Service from "../src/services/web3Service.js";
import { createElection } from "../src/controllers/electionController.js";
import { confirmPaymentManual } from "../src/controllers/paymentController.js";
import jwt from "jsonwebtoken";
import { getPricingCatalog, registerCitizen, loginCitizen, respondToSurvey, redeemPlazaReward } from "../src/controllers/plazaController.js";
import { verifyBallotReceipt } from "../src/controllers/auditController.js";
import {
    buildCanonicalChoiceCode,
    computeBallotCommitment,
    computeRollingHash,
    computeVoterNullifier,
    GENESIS_HASH
} from "../src/utils/crypto.js";
import { calculateProcessPricing } from "../src/utils/pricing.js";

process.env.BALLOT_HMAC_SECRET = process.env.BALLOT_HMAC_SECRET || "test-hmac-secret-ballots-2026";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-ballots-2026";

function createMockRes() {
    const res = {
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
    return res;
}

test("calculateProcessPricing applies organized CLP pricing and conditional admin-review rule", () => {
    const standardElection = calculateProcessPricing({
        processKind: "election",
        votersCount: 100,
        modules: { virtualAssembly: false, technicalSupport: false, fullAuditPackage: false }
    });
    assert.equal(standardElection.baseFee, 50000);
    assert.equal(standardElection.perVoterRate, 500);
    assert.equal(standardElection.participantsFee, 50000);
    assert.equal(standardElection.modulesFee, 0);
    assert.equal(standardElection.total, 100000);
    assert.equal(standardElection.requiresAdminReview, false);

    const standardSurvey = calculateProcessPricing({
        processKind: "survey",
        votersCount: 200,
        modules: { virtualAssembly: false, technicalSupport: false, fullAuditPackage: false }
    });
    assert.equal(standardSurvey.baseFee, 25000);
    assert.equal(standardSurvey.perVoterRate, 200);
    assert.equal(standardSurvey.participantsFee, 40000);
    assert.equal(standardSurvey.total, 65000);
    assert.equal(standardSurvey.requiresAdminReview, false);

    // Selecting fullAuditPackage includes technicalSupport without double-charging and enables admin review
    const auditedElection = calculateProcessPricing({
        processKind: "election",
        votersCount: 100,
        modules: { virtualAssembly: true, technicalSupport: true, fullAuditPackage: true },
        discountPercentage: 10
    });
    assert.equal(auditedElection.normalizedModules.technicalSupport, true);
    assert.equal(auditedElection.normalizedModules.fullAuditPackage, true);
    assert.equal(auditedElection.modulesFee, 150000 + 220000);
    assert.equal(auditedElection.subtotal, 50000 + 50000 + 370000);
    assert.equal(auditedElection.discountAmount, 47000);
    assert.equal(auditedElection.total, 423000);
    assert.equal(auditedElection.requiresAdminReview, true);

    const freeSchool = calculateProcessPricing({
        processKind: "election",
        votersCount: 500,
        freeSchoolBenefit: true
    });
    assert.equal(freeSchool.total, 0);
    assert.equal(freeSchool.requiresAdminReview, false);
});

test("createElection auto-approves standard processes and only marks pending when fullAuditPackage is selected", async () => {
    const originalCouponFindOne = Coupon.findOne;
    const originalElectionCreate = Election.create;
    const originalUserFindById = User.findById;

    const savedDocs = [];
    Election.create = async (doc) => {
        const created = {
            ...doc,
            _id: new mongoose.Types.ObjectId(),
            save: async function () { return this; }
        };
        savedDocs.push(created);
        return created;
    };

    try {
        // 1) Standard paid survey -> auto-approved, draft until paid
        Coupon.findOne = async () => null;
        const reqStandard = {
            user: { id: new mongoose.Types.ObjectId().toString(), role: "client" },
            body: {
                processKind: "survey",
                title: "Encuesta Comunal",
                electionType: "Encuesta Ciudadana",
                votersCount: 100,
                startDate: new Date().toISOString(),
                endDate: new Date(Date.now() + 86400000).toISOString(),
                questions: [{ prompt: "¿Aprueba la medida?", options: [{ label: "Sí" }, { label: "No" }] }],
                modules: { fullAuditPackage: false }
            }
        };
        const resStandard = createMockRes();
        await createElection(reqStandard, resStandard);

        assert.equal(resStandard.statusCode, 201);
        assert.equal(resStandard.body.data.requiresAdminReview, false);
        assert.equal(resStandard.body.data.approvalStatus, "approved");
        assert.equal(resStandard.body.data.status, "draft");
        assert.equal(resStandard.body.data.isPaid, false);

        // 2) Free (100% coupon) standard survey -> auto-approved AND immediately active
        Coupon.findOne = async () => ({ discountPercentage: 100, isActive: true });
        const reqFree = {
            user: { id: new mongoose.Types.ObjectId().toString(), role: "client" },
            body: {
                ...reqStandard.body,
                couponCode: "GRATIS100"
            }
        };
        const resFree = createMockRes();
        await createElection(reqFree, resFree);

        assert.equal(resFree.statusCode, 201);
        assert.equal(resFree.body.data.price, 0);
        assert.equal(resFree.body.data.isPaid, true);
        assert.equal(resFree.body.data.requiresAdminReview, false);
        assert.equal(resFree.body.data.approvalStatus, "approved");
        assert.equal(resFree.body.data.status, "active");

        // 3) Election with Paquete Completo de Auditorías -> pending admin evaluation
        Coupon.findOne = async () => null;
        const reqAudit = {
            user: { id: new mongoose.Types.ObjectId().toString(), role: "client" },
            body: {
                processKind: "election",
                title: "Elección Directiva Auditada",
                electionType: "Sindicatos",
                votersCount: 100,
                startDate: new Date().toISOString(),
                endDate: new Date(Date.now() + 86400000).toISOString(),
                modules: { fullAuditPackage: true }
            }
        };
        const resAudit = createMockRes();
        await createElection(reqAudit, resAudit);

        assert.equal(resAudit.statusCode, 201);
        assert.equal(resAudit.body.data.requiresAdminReview, true);
        assert.equal(resAudit.body.data.approvalStatus, "pending");
        assert.equal(resAudit.body.data.status, "draft");
        assert.equal(resAudit.body.data.price, 50000 + 50000 + 220000);
    } finally {
        Coupon.findOne = originalCouponFindOne;
        Election.create = originalElectionCreate;
        User.findById = originalUserFindById;
    }
});

test("confirmPaymentManual activates standard processes immediately and holds audited ones for admin", async () => {
    const originalFindById = Election.findById;
    const originalIsConfigured = web3Service.isWeb3Configured;
    web3Service.isWeb3Configured = () => false;

    const standardDoc = {
        _id: new mongoose.Types.ObjectId(),
        requiresAdminReview: false,
        approvalStatus: "pending",
        status: "draft",
        isPaid: false,
        save: async function () { return this; }
    };
    const auditedDoc = {
        _id: new mongoose.Types.ObjectId(),
        requiresAdminReview: true,
        approvalStatus: "pending",
        status: "draft",
        isPaid: false,
        save: async function () { return this; }
    };

    try {
        Election.findById = async (id) => (id === "std" ? standardDoc : auditedDoc);

        const resStd = createMockRes();
        await confirmPaymentManual({ params: { electionId: "std" } }, resStd);
        assert.equal(resStd.statusCode, 200);
        assert.equal(standardDoc.isPaid, true);
        assert.equal(standardDoc.approvalStatus, "approved");
        assert.equal(standardDoc.status, "active");

        const resAud = createMockRes();
        await confirmPaymentManual({ params: { electionId: "aud" } }, resAud);
        assert.equal(resAud.statusCode, 200);
        assert.equal(auditedDoc.isPaid, true);
        assert.equal(auditedDoc.approvalStatus, "pending");
        assert.equal(auditedDoc.status, "draft");
    } finally {
        Election.findById = originalFindById;
        web3Service.isWeb3Configured = originalIsConfigured;
    }
});

test("multi-question survey ballot commitment is deterministic and verifiable in auditController", async () => {
    const electionId = new mongoose.Types.ObjectId();
    const qId1 = new mongoose.Types.ObjectId().toString();
    const qId2 = new mongoose.Types.ObjectId().toString();

    const answersA = [
        { questionId: qId2, questionPrompt: "P2", selectedOptions: ["Opción B", "Opción A"] },
        { questionId: qId1, questionPrompt: "P1", selectedOptions: ["Sí"] }
    ];
    const answersReordered = [
        { questionId: qId1, questionPrompt: "P1", selectedOptions: ["Sí"] },
        { questionId: qId2, questionPrompt: "P2", selectedOptions: ["Opción A", "Opción B"] }
    ];

    assert.equal(
        buildCanonicalChoiceCode(null, false, answersA),
        buildCanonicalChoiceCode(null, false, answersReordered)
    );

    const timestampMs = 1794585000000;
    const nonce = `0x${"ab".repeat(32)}`;
    const nullifierHash = computeVoterNullifier(electionId, "12.345.678-9");
    const c1 = computeBallotCommitment({
        electionId,
        candidateId: null,
        isNulo: false,
        surveyAnswers: answersA,
        weight: 1,
        ballotNonce: nonce,
        timestampMs
    });
    const hash = computeRollingHash({
        previousHash: GENESIS_HASH,
        nullifierHash,
        ballotCommitment: c1.ballotCommitment,
        weight: 1
    });

    const originalBallotFindOne = Ballot.findOne;
    const originalIsWeb3Configured = web3Service.isWeb3Configured;
    web3Service.isWeb3Configured = () => false;

    const storedBallot = {
        election: electionId,
        candidate: null,
        isNulo: false,
        surveyAnswers: answersReordered,
        weight: 1,
        ballotNonce: nonce,
        ballotCommitment: c1.ballotCommitment,
        nullifierHash,
        hash,
        previousHash: GENESIS_HASH,
        timestampMs,
        createdAt: new Date(timestampMs),
        web3: { anchored: false }
    };

    try {
        Ballot.findOne = () => ({
            lean: async () => storedBallot
        });

        const resValid = createMockRes();
        await verifyBallotReceipt(
            { params: { id: electionId.toString(), commitment: c1.ballotCommitment } },
            resValid
        );
        assert.equal(resValid.statusCode, 200);
        assert.equal(resValid.body.data.cryptographicValid, true);

        // Mutate answer to simulate tampering
        storedBallot.surveyAnswers = [
            { questionId: qId1, questionPrompt: "P1", selectedOptions: ["No"] }
        ];
        const resTampered = createMockRes();
        await verifyBallotReceipt(
            { params: { id: electionId.toString(), commitment: c1.ballotCommitment } },
            resTampered
        );
        assert.equal(resTampered.statusCode, 200);
        assert.equal(resTampered.body.data.cryptographicValid, false);
    } finally {
        Ballot.findOne = originalBallotFindOne;
        web3Service.isWeb3Configured = originalIsWeb3Configured;
    }
});

test("plazaController handles pricing catalog, citizen auth, survey response points, duplicate guard, and coupon redemption", async () => {
    const resPricing = createMockRes();
    getPricingCatalog({}, resPricing);
    assert.equal(resPricing.statusCode, 200);
    assert.equal(resPricing.body.success, true);
    assert.equal(resPricing.body.data.processes.survey.baseFee, 25000);
    assert.ok(Array.isArray(resPricing.body.data.rewardsCatalog));

    const originalElectionFindById = Election.findById;
    const originalVoterFindOne = Voter.findOne;
    const originalBallotExists = Ballot.exists;
    const originalCastVote = ballotService.castVote;
    const originalProfileFindOne = CitizenProfile.findOne;
    const originalProfileCreate = CitizenProfile.create;
    const originalProfileFindOneAndUpdate = CitizenProfile.findOneAndUpdate;
    const originalBallotFind = Ballot.find;
    const originalCouponCreate = Coupon.create;

    const surveyId = new mongoose.Types.ObjectId();
    const voterId = new mongoose.Types.ObjectId();
    const profileId = new mongoose.Types.ObjectId();
    let capturedToken = null;
    const createdCoupons = [];
    const storedProfiles = [];

    try {
        CitizenProfile.findOne = (query) => {
            const found = storedProfiles.find((p) => {
                if (query.$or) {
                    return query.$or.some((cond) =>
                        (cond.cedulaNormalized && p.cedulaNormalized === cond.cedulaNormalized) ||
                        (cond.email && p.email === cond.email)
                    );
                }
                if (query.email) return p.email === query.email;
                if (query.cedulaNormalized) return p.cedulaNormalized === query.cedulaNormalized;
                return false;
            }) || null;
            const p = Promise.resolve(found);
            p.select = () => Promise.resolve(found);
            return p;
        };
        CitizenProfile.create = async (payload) => {
            const doc = {
                _id: profileId,
                ...payload,
                points: 0,
                participationsCount: 0,
                history: [],
                redemptions: [],
                matchPassword: async (pw) => pw === payload.password
            };
            storedProfiles.push(doc);
            return doc;
        };

        // 1. Citizen registration enforces password & prevents duplicate hijacking
        const resReg = createMockRes();
        await registerCitizen({
            body: {
                displayName: "Vecino Demo",
                cedula: "12.345.678-9",
                email: "vecino@plaza.cl",
                password: "PasswordSegura2026"
            }
        }, resReg);
        assert.equal(resReg.statusCode, 201);
        assert.ok(resReg.body.data.citizenToken);
        capturedToken = resReg.body.data.citizenToken;

        // Re-registering same RUT must fail with 409 (never hijack existing account)
        const resDupReg = createMockRes();
        await registerCitizen({
            body: {
                displayName: "Atacante",
                cedula: "12345678-9",
                email: "atacante@plaza.cl",
                password: "PasswordSegura2026"
            }
        }, resDupReg);
        assert.equal(resDupReg.statusCode, 409);

        // Login with wrong password returns 401; valid password returns 200
        const resBadLogin = createMockRes();
        await loginCitizen({ body: { identifier: "vecino@plaza.cl", password: "wrong" } }, resBadLogin);
        assert.equal(resBadLogin.statusCode, 401);

        const resGoodLogin = createMockRes();
        await loginCitizen({ body: { identifier: "12.345.678-9", password: "PasswordSegura2026" } }, resGoodLogin);
        assert.equal(resGoodLogin.statusCode, 200);
        assert.ok(resGoodLogin.body.data.citizenToken);

        Election.findById = async () => ({
            _id: surveyId,
            title: "Prioridades Ciudadanas",
            processKind: "survey",
            status: "active",
            startDate: new Date(Date.now() - 10000),
            endDate: new Date(Date.now() + 86400000),
            plaza: { featuredInPlaza: true, category: "Ciudadanía", rewardPoints: 75 },
            settings: { allowAutoRegistration: true, publicResults: true },
            candidates: [],
            questions: [
                { _id: new mongoose.Types.ObjectId(), prompt: "Tema principal", allowMultiple: false, options: [{ label: "Seguridad" }] }
            ]
        });
        Voter.findOne = async () => ({ _id: voterId, hasVoted: false, cedula: "12345678-9" });
        Ballot.exists = async () => null;
        ballotService.castVote = async () => ({
            ballotCommitment: `0x${"12".repeat(32)}`,
            web3: { anchored: true, txHash: `0x${"34".repeat(32)}`, explorerUrl: "https://amoy.polygonscan.com/tx/0x34" }
        });
        CitizenProfile.findOneAndUpdate = async (query) => {
            assert.equal(query.cedulaNormalized, "123456789"); // must come from JWT, never spoofed body
            return {
                _id: profileId,
                cedulaNormalized: "123456789",
                displayName: "Vecino Demo",
                points: 175,
                participationsCount: 2,
                history: [],
                redemptions: []
            };
        };
        Ballot.find = () => ({
            select: () => ({
                lean: async () => []
            })
        });

        // Unauthenticated response attempt must be rejected with 401
        const resUnauth = createMockRes();
        await respondToSurvey({
            params: { id: surveyId.toString() },
            headers: {},
            socket: { remoteAddress: "127.0.0.1" },
            body: { cedula: "99.999.999-9", surveyAnswers: [{ questionId: "q1", selectedOptions: ["Seguridad"] }] }
        }, resUnauth);
        assert.equal(resUnauth.statusCode, 401);

        // Authenticated citizen responds (even if body tries spoofed cedula, JWT identity prevails)
        const reqRespond = {
            params: { id: surveyId.toString() },
            headers: { authorization: `Bearer ${capturedToken}` },
            socket: { remoteAddress: "127.0.0.1" },
            body: {
                cedula: "99.999.999-9",
                displayName: "Vecino Demo",
                surveyAnswers: [{ questionId: "q1", selectedOptions: ["Seguridad"] }]
            }
        };
        const resRespond = createMockRes();
        await respondToSurvey(reqRespond, resRespond);

        assert.equal(resRespond.statusCode, 201);
        assert.equal(resRespond.body.data.pointsAwarded, 75);
        assert.equal(resRespond.body.data.profile.points, 175);

        // Duplicate prevention in respondToSurvey returns 409
        Ballot.exists = async () => ({ _id: new mongoose.Types.ObjectId() });
        const resDup = createMockRes();
        await respondToSurvey(reqRespond, resDup);
        assert.equal(resDup.statusCode, 409);

        // Redeem reward creating real coupon
        Coupon.create = async (c) => {
            createdCoupons.push(c);
            return c;
        };
        CitizenProfile.findOneAndUpdate = async () => ({
            _id: profileId,
            cedulaNormalized: "123456789",
            displayName: "Vecino Demo",
            points: 25,
            participationsCount: 2,
            history: [],
            redemptions: [{ rewardId: "cupon-encuesta-15", code: "PLZ15-TEST", pointsCost: 150, redeemedAt: new Date() }]
        });

        const resRedeem = createMockRes();
        await redeemPlazaReward(
            {
                headers: { authorization: `Bearer ${capturedToken}` },
                body: { rewardId: "cupon-encuesta-15" }
            },
            resRedeem
        );
        assert.equal(resRedeem.statusCode, 200);
        assert.equal(createdCoupons.length, 1);
        assert.equal(createdCoupons[0].discountPercentage, 15);
        assert.equal(createdCoupons[0].isActive, true);
        assert.match(resRedeem.body.data.redeemed.code, /^PLZ15-/);
        assert.ok(jwt.verify(capturedToken, process.env.JWT_SECRET).role === "citizen");
    } finally {
        Election.findById = originalElectionFindById;
        Voter.findOne = originalVoterFindOne;
        Ballot.exists = originalBallotExists;
        ballotService.castVote = originalCastVote;
        CitizenProfile.findOne = originalProfileFindOne;
        CitizenProfile.create = originalProfileCreate;
        CitizenProfile.findOneAndUpdate = originalProfileFindOneAndUpdate;
        Ballot.find = originalBallotFind;
        Coupon.create = originalCouponCreate;
    }
});
