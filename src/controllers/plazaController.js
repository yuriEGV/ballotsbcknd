import crypto from "crypto";
import jwt from "jsonwebtoken";
import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import Ballot from "../models/Ballot.js";
import Coupon from "../models/Coupon.js";
import CitizenProfile from "../models/CitizenProfile.js";
import ballotService from "../services/ballotService.js";
import { refreshElectionPadronRoot } from "../services/voterService.js";
import { getJwtSecret } from "../config/jwt.js";
import { computeVoterNullifier, normalizeCedula } from "../utils/crypto.js";
import { PRICING_CATALOG, SURVEY_CATEGORIES } from "../utils/pricing.js";

export const PLAZA_REWARDS = [
    {
        id: "certificado-civico",
        title: "Certificado Cívico Verificado Web3",
        description: "Credencial digital de participación verificada en Polygon Amoy.",
        pointsCost: 50,
        badge: "Certificado",
        createsCoupon: false
    },
    {
        id: "insignia-impulsor",
        title: "Insignia Voz Ciudadana",
        description: "Reconocimiento por aportar activamente en consultas de la comunidad.",
        pointsCost: 120,
        badge: "Insignia",
        createsCoupon: false
    },
    {
        id: "cupon-encuesta-15",
        title: "Cupón 15% Dcto. en Encuestas o Votaciones",
        description: "Genera un código real aplicable al crear tu propia encuesta o elección.",
        pointsCost: 150,
        badge: "Descuento 15%",
        createsCoupon: true,
        discountPercentage: 15
    },
    {
        id: "cupon-encuesta-30",
        title: "Cupón 30% Dcto. en Encuestas o Votaciones",
        description: "Código real de descuento para organizaciones y líderes comunitarios.",
        pointsCost: 300,
        badge: "Descuento 30%",
        createsCoupon: true,
        discountPercentage: 30
    }
];

function signCitizenToken(profile) {
    return jwt.sign(
        {
            id: profile._id.toString(),
            cedulaNormalized: profile.cedulaNormalized,
            role: "citizen"
        },
        getJwtSecret(),
        { expiresIn: "30d" }
    );
}

function sanitizeCitizenProfile(profile) {
    if (!profile) return null;
    const obj = typeof profile.toObject === "function" ? profile.toObject() : profile;
    return {
        _id: obj._id,
        displayName: obj.displayName || "Ciudadano",
        email: obj.email || "",
        commune: obj.commune || "",
        region: obj.region || "",
        maskedCedula: obj.cedulaNormalized
            ? `••••${obj.cedulaNormalized.slice(-4)}`
            : "",
        points: obj.points || 0,
        participationsCount: obj.participationsCount || 0,
        history: [...(obj.history || [])].sort(
            (a, b) => new Date(b.participatedAt) - new Date(a.participatedAt)
        ),
        redemptions: [...(obj.redemptions || [])].sort(
            (a, b) => new Date(b.redeemedAt) - new Date(a.redeemedAt)
        )
    };
}

function readCitizenAuth(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded || decoded.role !== "citizen") return null;
    return decoded;
}

function buildSurveyTallies(survey, ballots = []) {
    const totalResponses = ballots.length;
    const candidateResults = (survey.candidates || []).map((c) => {
        const count = ballots.filter(
            (b) => b.candidate && b.candidate.toString() === c._id.toString()
        ).length;
        return {
            _id: c._id,
            name: c.name,
            description: c.description || "",
            votes: count,
            percentage: totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
        };
    });

    const questionResults = (survey.questions || []).map((q) => {
        const qId = q._id.toString();
        const counts = new Map((q.options || []).map((o) => [o.label, 0]));
        ballots.forEach((b) => {
            const match = (b.surveyAnswers || []).find(
                (a) => a.questionId === qId || a.questionPrompt === q.prompt
            );
            if (match && Array.isArray(match.selectedOptions)) {
                match.selectedOptions.forEach((opt) => {
                    counts.set(opt, (counts.get(opt) || 0) + 1);
                });
            }
        });
        return {
            _id: q._id,
            prompt: q.prompt,
            allowMultiple: Boolean(q.allowMultiple),
            options: (q.options || []).map((o) => {
                const votes = counts.get(o.label) || 0;
                return {
                    _id: o._id,
                    label: o.label,
                    votes,
                    percentage: totalResponses > 0 ? Math.round((votes / totalResponses) * 100) : 0
                };
            })
        };
    });

    return {
        totalResponses,
        anchoredCount: ballots.filter((b) => b.web3?.anchored).length,
        candidateResults,
        questionResults
    };
}

/**
 * GET /api/plaza/pricing
 * Public structured pricing catalog for UI consistency.
 */
export const getPricingCatalog = (_req, res) => {
    res.json({
        success: true,
        data: {
            ...PRICING_CATALOG,
            surveyCategories: SURVEY_CATEGORIES,
            rewardsCatalog: PLAZA_REWARDS
        }
    });
};

/**
 * GET /api/plaza/surveys
 * Public list of surveys featured in Plaza Ciudadana.
 */
export const getPublicSurveys = async (req, res) => {
    try {
        const { category, search, status } = req.query;
        const query = {
            processKind: "survey",
            "plaza.featuredInPlaza": true,
            status: status && ["active", "ended"].includes(status) ? status : { $in: ["active", "ended"] }
        };

        if (category && category !== "Todas") {
            query["plaza.category"] = category;
        }
        if (search && String(search).trim()) {
            const escaped = String(search).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            query.$or = [
                { title: { $regex: escaped, $options: "i" } },
                { description: { $regex: escaped, $options: "i" } }
            ];
        }

        const surveys = await Election.find(query)
            .select("title description processKind electionType startDate endDate status candidates questions plaza settings web3 createdAt")
            .sort({ status: 1, createdAt: -1 })
            .lean();

        const surveyIds = surveys.map((s) => s._id);
        const ballotsBySurvey = new Map();

        if (surveyIds.length > 0) {
            const allBallots = await Ballot.find({ election: { $in: surveyIds } })
                .select("election candidate surveyAnswers web3.anchored")
                .lean();
            allBallots.forEach((b) => {
                const key = b.election.toString();
                if (!ballotsBySurvey.has(key)) ballotsBySurvey.set(key, []);
                ballotsBySurvey.get(key).push(b);
            });
        }

        const now = new Date();
        const payload = surveys.map((s) => {
            const surveyBallots = ballotsBySurvey.get(s._id.toString()) || [];
            const isOpenWindow =
                s.status === "active" &&
                (!s.startDate || now >= new Date(s.startDate)) &&
                (!s.endDate || now <= new Date(s.endDate));
            const showResults = Boolean(s.settings?.publicResults || s.status === "ended");
            const tallies = buildSurveyTallies(s, surveyBallots);

            return {
                _id: s._id,
                title: s.title,
                description: s.description || "",
                electionType: s.electionType,
                startDate: s.startDate,
                endDate: s.endDate,
                status: s.status,
                isOpenWindow,
                allowOpenParticipation: Boolean(s.settings?.allowAutoRegistration),
                publicResults: showResults,
                category: s.plaza?.category || "Ciudadanía",
                rewardPoints: s.plaza?.rewardPoints ?? 50,
                candidates: s.candidates || [],
                questions: s.questions || [],
                participantsCount: tallies.totalResponses,
                anchoredCount: tallies.anchoredCount,
                results: showResults ? tallies : null,
                web3: {
                    registered: Boolean(s.web3?.registered),
                    contractAddress: s.web3?.contractAddress || "",
                    chainId: s.web3?.chainId || null,
                    network: s.web3?.network || ""
                }
            };
        });

        res.json({
            success: true,
            data: {
                surveys: payload,
                categories: SURVEY_CATEGORIES,
                rewardsCatalog: PLAZA_REWARDS
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * GET /api/plaza/surveys/:id/results
 * Aggregated results for a public survey.
 */
export const getPublicSurveyResults = async (req, res) => {
    try {
        const survey = await Election.findById(req.params.id)
            .select("title description processKind status candidates questions plaza settings web3 startDate endDate")
            .lean();

        if (!survey || survey.processKind !== "survey") {
            return res.status(404).json({ success: false, message: "Encuesta no encontrada" });
        }

        if (!survey.settings?.publicResults && survey.status !== "ended") {
            return res.status(403).json({
                success: false,
                message: "Los resultados públicos de esta encuesta se mostrarán al finalizar."
            });
        }

        const ballots = await Ballot.find({ election: survey._id })
            .select("candidate surveyAnswers web3.anchored")
            .lean();
        const tallies = buildSurveyTallies(survey, ballots);

        res.json({
            success: true,
            data: {
                surveyId: survey._id,
                title: survey.title,
                status: survey.status,
                category: survey.plaza?.category || "Ciudadanía",
                web3: survey.web3 || {},
                ...tallies
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * POST /api/plaza/surveys/:id/respond
 * Submit a unique, Web3-backed survey response directly from Plaza Ciudadana.
 */
export const respondToSurvey = async (req, res) => {
    try {
        const { id } = req.params;
        const { cedula, displayName, email, commune, region, candidateId, surveyAnswers } = req.body;

        let rawCedula = cedula ? String(cedula).trim() : "";
        let cedulaNormalized = rawCedula ? normalizeCedula(rawCedula) : "";

        if (!cedulaNormalized) {
            const auth = readCitizenAuth(req);
            if (auth?.cedulaNormalized) {
                cedulaNormalized = auth.cedulaNormalized;
                rawCedula = auth.cedulaNormalized;
            }
        }

        if (!cedulaNormalized || cedulaNormalized.length < 5) {
            return res.status(400).json({
                success: false,
                message: "Ingresa un RUT / Cédula válido para validar participación única (nunca se vincula públicamente a tu respuesta)."
            });
        }

        const survey = await Election.findById(id);
        if (!survey || survey.processKind !== "survey") {
            return res.status(404).json({ success: false, message: "Encuesta no encontrada" });
        }
        if (!survey.plaza?.featuredInPlaza && !survey.settings?.allowAutoRegistration) {
            return res.status(403).json({ success: false, message: "Esta encuesta no está habilitada para respuesta pública en Plaza Ciudadana." });
        }
        if (survey.status !== "active") {
            return res.status(400).json({ success: false, message: "Esta encuesta no está activa actualmente." });
        }

        const now = new Date();
        if (survey.startDate && now < new Date(survey.startDate)) {
            return res.status(403).json({ success: false, message: "Esta encuesta aún no inicia." });
        }
        if (survey.endDate && now > new Date(survey.endDate)) {
            return res.status(403).json({ success: false, message: "El período de respuesta de esta encuesta ha finalizado." });
        }

        let voter = await Voter.findOne({
            election: id,
            $or: [{ cedulaNormalized }, { cedula: rawCedula }]
        });

        if (!voter) {
            if (!survey.settings?.allowAutoRegistration) {
                return res.status(403).json({
                    success: false,
                    message: "Esta encuesta es cerrada y tu RUT no está en el padrón autorizado."
                });
            }
            voter = await Voter.create({
                election: id,
                cedula: rawCedula,
                cedulaNormalized,
                name: String(displayName || "").trim() || `Ciudadano ${cedulaNormalized.slice(-4)}`,
                email: String(email || "").trim()
            });
            await refreshElectionPadronRoot(id);
        }

        const nullifierHash = computeVoterNullifier(id, cedulaNormalized);
        const duplicateBallot = await Ballot.exists({ election: id, nullifierHash });
        if (voter.hasVoted || duplicateBallot) {
            return res.status(409).json({
                success: false,
                message: "Este RUT ya registró su respuesta única en esta encuesta."
            });
        }

        const hasMultiQuestions = Array.isArray(survey.questions) && survey.questions.length > 0;
        if (!hasMultiQuestions && !candidateId) {
            return res.status(400).json({ success: false, message: "Debes seleccionar una opción de respuesta." });
        }

        const forwardedFor = req.headers["x-forwarded-for"];
        const ipAddress =
            (Array.isArray(forwardedFor)
                ? forwardedFor[0]
                : String(forwardedFor || "").split(",")[0].trim()) ||
            req.socket?.remoteAddress ||
            "unknown";
        const device = req.headers["user-agent"] || "unknown";

        const receipt = await ballotService.castVote(
            voter._id,
            id,
            candidateId || null,
            ipAddress,
            device,
            false,
            null,
            hasMultiQuestions ? surveyAnswers : null
        );

        const pointsAwarded = Number(survey.plaza?.rewardPoints ?? 50);
        const safeDisplayName = String(displayName || "").trim();
        const safeEmail = String(email || "").trim();
        const safeCommune = String(commune || "").trim();
        const safeRegion = String(region || "").trim();

        const setFields = {};
        if (safeDisplayName) setFields.displayName = safeDisplayName;
        if (safeEmail) setFields.email = safeEmail;
        if (safeCommune) setFields.commune = safeCommune;
        if (safeRegion) setFields.region = safeRegion;

        const profile = await CitizenProfile.findOneAndUpdate(
            { cedulaNormalized },
            {
                ...(Object.keys(setFields).length > 0 ? { $set: setFields } : {}),
                $setOnInsert: {
                    cedulaNormalized,
                    ...(safeDisplayName ? {} : { displayName: `Ciudadano ${cedulaNormalized.slice(-4)}` })
                },
                $inc: { points: pointsAwarded, participationsCount: 1 },
                $push: {
                    history: {
                        election: survey._id,
                        electionTitle: survey.title,
                        category: survey.plaza?.category || "Ciudadanía",
                        pointsEarned: pointsAwarded,
                        ballotCommitment: receipt.ballotCommitment,
                        txHash: receipt.web3?.txHash || "",
                        explorerUrl: receipt.web3?.explorerUrl || "",
                        participatedAt: new Date()
                    }
                }
            },
            { new: true, upsert: true }
        );

        const allBallots = await Ballot.find({ election: id })
            .select("candidate surveyAnswers web3.anchored")
            .lean();
        const surveyResults = survey.settings?.publicResults ? buildSurveyTallies(survey, allBallots) : null;

        const citizenToken = signCitizenToken(profile);

        res.status(201).json({
            success: true,
            data: {
                receipt,
                pointsAwarded,
                profile: sanitizeCitizenProfile(profile),
                citizenToken,
                surveyResults
            }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * POST /api/plaza/profile
 * Identify or update citizen profile in Plaza Ciudadana ("Mis datos").
 */
export const upsertCitizenProfile = async (req, res) => {
    try {
        const { cedula, displayName, email, commune, region } = req.body;
        let cedulaNormalized = "";

        if (cedula && String(cedula).trim()) {
            cedulaNormalized = normalizeCedula(cedula);
        } else {
            const auth = readCitizenAuth(req);
            if (auth?.cedulaNormalized) {
                cedulaNormalized = auth.cedulaNormalized;
            }
        }

        if (!cedulaNormalized || cedulaNormalized.length < 5) {
            return res.status(400).json({ success: false, message: "Ingresa un RUT / Cédula válido." });
        }

        const updates = {};
        if (displayName && String(displayName).trim()) updates.displayName = String(displayName).trim();
        if (email !== undefined) updates.email = String(email || "").trim();
        if (commune !== undefined) updates.commune = String(commune || "").trim();
        if (region !== undefined) updates.region = String(region || "").trim();

        const profile = await CitizenProfile.findOneAndUpdate(
            { cedulaNormalized },
            {
                ...(Object.keys(updates).length > 0 ? { $set: updates } : {}),
                $setOnInsert: {
                    cedulaNormalized,
                    ...(updates.displayName ? {} : { displayName: `Ciudadano ${cedulaNormalized.slice(-4)}` })
                }
            },
            { new: true, upsert: true }
        );

        const token = signCitizenToken(profile);

        res.json({
            success: true,
            data: {
                profile: sanitizeCitizenProfile(profile),
                citizenToken: token,
                rewardsCatalog: PLAZA_REWARDS
            }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/plaza/profile/me
 * Fetch authenticated citizen profile, points, history, and redemptions.
 */
export const getCitizenProfile = async (req, res) => {
    try {
        const auth = readCitizenAuth(req);
        if (!auth) {
            return res.status(401).json({ success: false, message: "Sesión ciudadana requerida." });
        }

        const profile = await CitizenProfile.findOne({ cedulaNormalized: auth.cedulaNormalized });
        if (!profile) {
            return res.status(404).json({ success: false, message: "Perfil ciudadano no encontrado." });
        }

        res.json({
            success: true,
            data: {
                profile: sanitizeCitizenProfile(profile),
                rewardsCatalog: PLAZA_REWARDS
            }
        });
    } catch (err) {
        res.status(401).json({ success: false, message: "Sesión inválida o expirada." });
    }
};

/**
 * POST /api/plaza/rewards/redeem
 * Redeem civic points for verifiable badges or real Ballots Einsoft discount coupons.
 */
export const redeemPlazaReward = async (req, res) => {
    try {
        const auth = readCitizenAuth(req);
        if (!auth) {
            return res.status(401).json({ success: false, message: "Identifícate primero en 'Mis datos' para canjear puntos." });
        }

        const { rewardId } = req.body;
        const reward = PLAZA_REWARDS.find((r) => r.id === rewardId);
        if (!reward) {
            return res.status(404).json({ success: false, message: "Recompensa no encontrada." });
        }

        const rewardCode = reward.createsCoupon
            ? `PLZ${reward.discountPercentage}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`
            : `CIVIC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

        const updatedProfile = await CitizenProfile.findOneAndUpdate(
            { cedulaNormalized: auth.cedulaNormalized, points: { $gte: reward.pointsCost } },
            {
                $inc: { points: -reward.pointsCost },
                $push: {
                    redemptions: {
                        rewardId: reward.id,
                        rewardTitle: reward.title,
                        pointsCost: reward.pointsCost,
                        code: rewardCode,
                        discountPercentage: reward.discountPercentage || 0,
                        redeemedAt: new Date()
                    }
                }
            },
            { new: true }
        );

        if (!updatedProfile) {
            return res.status(400).json({
                success: false,
                message: `Puntos insuficientes. Necesitas ${reward.pointsCost} puntos para este canje.`
            });
        }

        if (reward.createsCoupon) {
            const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
            await Coupon.create({
                code: rewardCode,
                discountPercentage: reward.discountPercentage,
                validUntil,
                isActive: true
            });
        }

        res.json({
            success: true,
            data: {
                profile: sanitizeCitizenProfile(updatedProfile),
                redeemed: {
                    ...reward,
                    code: rewardCode
                }
            }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};
