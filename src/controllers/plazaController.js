import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import Ballot from "../models/Ballot.js";
import Coupon from "../models/Coupon.js";
import User from "../models/User.js";
import CitizenProfile from "../models/CitizenProfile.js";
import ballotService from "../services/ballotService.js";
import { refreshElectionPadronRoot } from "../services/voterService.js";
import { getJwtSecret } from "../config/jwt.js";
import { computeVoterNullifier, normalizeCedula } from "../utils/crypto.js";
import { PRICING_CATALOG, SURVEY_CATEGORIES } from "../utils/pricing.js";
import { isValidCedulaFormat, isValidEmail } from "../middleware/security.js";

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
        { expiresIn: "7d" }
    );
}

function sanitizeCitizenProfile(profile) {
    if (!profile) return null;
    const obj = typeof profile.toObject === "function" ? profile.toObject() : { ...profile };
    return {
        _id: obj._id,
        displayName: obj.displayName || "Ciudadano",
        email: obj.email || "",
        commune: obj.commune || "",
        region: obj.region || "",
        maskedCedula: obj.cedulaNormalized
            ? `••••${obj.cedulaNormalized.slice(-4)}`
            : "",
        linkedUser: obj.linkedUser || null,
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
    if (req.user && req.user.role === "citizen" && req.user.cedulaNormalized) {
        return req.user;
    }
    const authHeader = req.headers?.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    try {
        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, getJwtSecret());
        if (!decoded || decoded.role !== "citizen" || !decoded.cedulaNormalized) return null;
        return decoded;
    } catch {
        return null;
    }
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

async function aggregateTalliesForSurveys(surveys = []) {
    const surveyIds = surveys.map((s) => s._id);
    const tallyBySurvey = new Map();
    if (surveyIds.length === 0) return tallyBySurvey;

    const useAggregation =
        mongoose.connection?.readyState === 1 &&
        typeof Ballot.aggregate === "function";

    if (!useAggregation) {
        const allBallots = await Ballot.find({ election: { $in: surveyIds } })
            .select("election candidate surveyAnswers web3.anchored")
            .lean();
        const ballotsBySurvey = new Map();
        allBallots.forEach((b) => {
            const key = b.election.toString();
            if (!ballotsBySurvey.has(key)) ballotsBySurvey.set(key, []);
            ballotsBySurvey.get(key).push(b);
        });
        for (const survey of surveys) {
            const list = ballotsBySurvey.get(survey._id.toString()) || [];
            tallyBySurvey.set(survey._id.toString(), buildSurveyTallies(survey, list));
        }
        return tallyBySurvey;
    }

    const [summaryRows, optionRows] = await Promise.all([
        Ballot.aggregate([
            { $match: { election: { $in: surveyIds } } },
            {
                $group: {
                    _id: { election: "$election", candidate: "$candidate" },
                    count: { $sum: 1 },
                    anchoredCount: {
                        $sum: { $cond: [{ $eq: ["$web3.anchored", true] }, 1, 0] }
                    }
                }
            }
        ]),
        Ballot.aggregate([
            { $match: { election: { $in: surveyIds }, "surveyAnswers.0": { $exists: true } } },
            { $unwind: "$surveyAnswers" },
            { $unwind: "$surveyAnswers.selectedOptions" },
            {
                $group: {
                    _id: {
                        election: "$election",
                        questionId: "$surveyAnswers.questionId",
                        questionPrompt: "$surveyAnswers.questionPrompt",
                        option: "$surveyAnswers.selectedOptions"
                    },
                    count: { $sum: 1 }
                }
            }
        ])
    ]);

    const totalsMap = new Map();
    const anchoredMap = new Map();
    const candCountsMap = new Map();
    for (const row of summaryRows) {
        const eId = row._id.election.toString();
        totalsMap.set(eId, (totalsMap.get(eId) || 0) + row.count);
        anchoredMap.set(eId, (anchoredMap.get(eId) || 0) + (row.anchoredCount || 0));
        if (row._id.candidate) {
            const cKey = `${eId}:${row._id.candidate.toString()}`;
            candCountsMap.set(cKey, (candCountsMap.get(cKey) || 0) + row.count);
        }
    }

    const optCountsBySurvey = new Map();
    for (const row of optionRows) {
        const eId = row._id.election.toString();
        if (!optCountsBySurvey.has(eId)) optCountsBySurvey.set(eId, []);
        optCountsBySurvey.get(eId).push(row);
    }

    for (const survey of surveys) {
        const eId = survey._id.toString();
        const totalResponses = totalsMap.get(eId) || 0;
        const anchoredCount = anchoredMap.get(eId) || 0;
        const surveyOptRows = optCountsBySurvey.get(eId) || [];

        const candidateResults = (survey.candidates || []).map((c) => {
            const count = candCountsMap.get(`${eId}:${c._id.toString()}`) || 0;
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
            surveyOptRows.forEach((r) => {
                if (r._id.questionId === qId || r._id.questionPrompt === q.prompt) {
                    const optLabel = r._id.option;
                    counts.set(optLabel, (counts.get(optLabel) || 0) + r.count);
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

        tallyBySurvey.set(eId, {
            totalResponses,
            anchoredCount,
            candidateResults,
            questionResults
        });
    }

    return tallyBySurvey;
}

/**
 * POST /api/plaza/auth/register
 * Create a password-protected citizen account for Plaza Ciudadana.
 */
export const registerCitizen = async (req, res) => {
    try {
        const { displayName, cedula, email, password, commune = "", region = "" } = req.body || {};

        const cleanName = String(displayName || "").trim();
        const cedulaNormalized = normalizeCedula(String(cedula || ""));
        const cleanEmail = String(email || "").trim().toLowerCase();

        if (!cleanName || cleanName.length < 2) {
            return res.status(400).json({ success: false, message: "Ingresa tu nombre completo (mínimo 2 caracteres)." });
        }
        if (!isValidCedulaFormat(cedulaNormalized)) {
            return res.status(400).json({ success: false, message: "Ingresa un RUT / Cédula válido." });
        }
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ success: false, message: "Ingresa un correo electrónico válido." });
        }
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ success: false, message: "La contraseña debe tener al menos 8 caracteres." });
        }

        const existing = await CitizenProfile.findOne({
            $or: [{ cedulaNormalized }, { email: cleanEmail }]
        });
        if (existing) {
            return res.status(409).json({
                success: false,
                message: "Ya existe una cuenta ciudadana registrada con ese RUT o correo electrónico."
            });
        }

        const profile = await CitizenProfile.create({
            cedulaNormalized,
            displayName: cleanName,
            email: cleanEmail,
            password,
            commune: String(commune || "").trim(),
            region: String(region || "").trim()
        });

        const citizenToken = signCitizenToken(profile);
        res.status(201).json({
            success: true,
            data: {
                profile: sanitizeCitizenProfile(profile),
                citizenToken,
                rewardsCatalog: PLAZA_REWARDS
            }
        });
    } catch (err) {
        const status = err.code === 11000 ? 409 : 400;
        res.status(status).json({
            success: false,
            message: err.code === 11000
                ? "Ese RUT o correo electrónico ya está registrado."
                : err.message
        });
    }
};

/**
 * POST /api/plaza/auth/login
 * Authenticate an existing citizen using Email or RUT + Password.
 */
export const loginCitizen = async (req, res) => {
    try {
        const { identifier, email, cedula, password } = req.body || {};
        const rawIdentifier = String(identifier || email || cedula || "").trim();

        if (!rawIdentifier || typeof password !== "string" || !password) {
            return res.status(400).json({ success: false, message: "Ingresa tu correo o RUT y tu contraseña." });
        }

        const query = isValidEmail(rawIdentifier)
            ? { email: rawIdentifier.toLowerCase() }
            : { cedulaNormalized: normalizeCedula(rawIdentifier) };

        const profile = await CitizenProfile.findOne(query).select("+password");
        if (!profile || !profile.password) {
            return res.status(401).json({ success: false, message: "Credenciales ciudadanas incorrectas." });
        }

        const isMatch = await profile.matchPassword(password);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: "Credenciales ciudadanas incorrectas." });
        }

        const citizenToken = signCitizenToken(profile);
        res.json({
            success: true,
            data: {
                profile: sanitizeCitizenProfile(profile),
                citizenToken,
                rewardsCatalog: PLAZA_REWARDS
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: "No se pudo verificar el acceso ciudadano." });
    }
};

/**
 * POST /api/plaza/auth/bridge
 * Allows an authenticated platform User (admin/organizer/observer) to access or create
 * ONLY their own linked CitizenProfile (never hijacking another person's RUT).
 */
export const bridgeUserToPlaza = async (req, res) => {
    try {
        if (!req.user || !["admin", "organizer", "observer"].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "Acceso restringido a usuarios del sistema." });
        }

        let profile = await CitizenProfile.findOne({ linkedUser: req.user.id });
        if (profile) {
            const citizenToken = signCitizenToken(profile);
            return res.json({
                success: true,
                data: {
                    profile: sanitizeCitizenProfile(profile),
                    citizenToken,
                    rewardsCatalog: PLAZA_REWARDS
                }
            });
        }

        const { cedula, commune = "", region = "" } = req.body || {};
        const cedulaNormalized = normalizeCedula(String(cedula || ""));
        if (!isValidCedulaFormat(cedulaNormalized)) {
            return res.status(200).json({
                success: true,
                requiresCedulaLink: true,
                message: "Vincula tu RUT personal para poder votar y acumular puntos cívicos."
            });
        }

        const user = await User.findById(req.user.id).select("username email");
        if (!user) {
            return res.status(404).json({ success: false, message: "Usuario no encontrado." });
        }

        const userEmail = String(user.email || "").trim().toLowerCase();
        const duplicate = await CitizenProfile.findOne({
            $or: [
                { cedulaNormalized },
                ...(userEmail ? [{ email: userEmail }] : [])
            ]
        });
        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: "Ese RUT o correo ya pertenece a otra cuenta ciudadana. Inicia sesión con tus credenciales ciudadanas."
            });
        }

        profile = await CitizenProfile.create({
            cedulaNormalized,
            displayName: user.username || `Ciudadano ${cedulaNormalized.slice(-4)}`,
            email: userEmail,
            linkedUser: req.user.id,
            commune: String(commune || "").trim(),
            region: String(region || "").trim()
        });

        const citizenToken = signCitizenToken(profile);
        res.status(201).json({
            success: true,
            data: {
                profile: sanitizeCitizenProfile(profile),
                citizenToken,
                rewardsCatalog: PLAZA_REWARDS
            }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message });
    }
};

/**
 * GET /api/plaza/pricing
 * Public structured pricing catalog for Landing/Quote UI consistency.
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
 * Protected list of surveys featured in Plaza Ciudadana (requires authenticated user or citizen).
 */
export const getPublicSurveys = async (req, res) => {
    try {
        const { category, search, status } = req.query;
        const query = {
            processKind: "survey",
            "plaza.featuredInPlaza": true,
            status: status && ["active", "ended"].includes(String(status)) ? String(status) : { $in: ["active", "ended"] }
        };

        if (category && category !== "Todas") {
            query["plaza.category"] = String(category);
        }
        if (search && String(search).trim()) {
            const escaped = String(search).trim().slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            query.$or = [
                { title: { $regex: escaped, $options: "i" } },
                { description: { $regex: escaped, $options: "i" } }
            ];
        }

        const surveys = await Election.find(query)
            .select("title description processKind electionType startDate endDate status candidates questions plaza settings web3 createdAt")
            .sort({ status: 1, createdAt: -1 })
            .lean();

        const talliesBySurvey = await aggregateTalliesForSurveys(surveys);

        const now = new Date();
        const payload = surveys.map((s) => {
            const tallies = talliesBySurvey.get(s._id.toString()) || {
                totalResponses: 0,
                anchoredCount: 0,
                candidateResults: [],
                questionResults: []
            };
            const isOpenWindow =
                s.status === "active" &&
                (!s.startDate || now >= new Date(s.startDate)) &&
                (!s.endDate || now <= new Date(s.endDate));
            const showResults = Boolean(s.settings?.publicResults || s.status === "ended");

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
 * Aggregated results for a Plaza Ciudadana survey.
 */
export const getPublicSurveyResults = async (req, res) => {
    try {
        const survey = await Election.findById(req.params.id)
            .select("title description organizer processKind status candidates questions plaza settings web3 startDate endDate")
            .lean();

        if (!survey || survey.processKind !== "survey") {
            return res.status(404).json({ success: false, message: "Encuesta no encontrada" });
        }

        const isOwnerOrAdmin =
            req.user?.role === "admin" ||
            (survey.organizer && survey.organizer.toString() === req.user?.id?.toString());

        if (!survey.plaza?.featuredInPlaza && !isOwnerOrAdmin) {
            return res.status(403).json({
                success: false,
                message: "Esta encuesta no es pública en Plaza Ciudadana."
            });
        }

        if (!survey.settings?.publicResults && survey.status !== "ended" && !isOwnerOrAdmin) {
            return res.status(403).json({
                success: false,
                message: "Los resultados públicos de esta encuesta se mostrarán al finalizar."
            });
        }

        const talliesMap = await aggregateTalliesForSurveys([survey]);
        const tallies = talliesMap.get(survey._id.toString()) || {
            totalResponses: 0,
            anchoredCount: 0,
            candidateResults: [],
            questionResults: []
        };

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
 * Submit a unique, Web3-backed survey response directly from an authenticated Citizen account.
 */
export const respondToSurvey = async (req, res) => {
    try {
        const auth = readCitizenAuth(req);
        if (!auth || !auth.cedulaNormalized) {
            return res.status(401).json({
                success: false,
                message: "Debes iniciar sesión con tu cuenta ciudadana para participar en esta encuesta."
            });
        }

        const { id } = req.params;
        const { displayName, commune, region, candidateId, surveyAnswers } = req.body || {};
        const cedulaNormalized = normalizeCedula(auth.cedulaNormalized);

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
            cedulaNormalized
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
                cedula: cedulaNormalized,
                cedulaNormalized,
                name: String(displayName || "").trim() || `Ciudadano ${cedulaNormalized.slice(-4)}`,
                email: ""
            });
            await refreshElectionPadronRoot(id);
        }

        const nullifierHash = computeVoterNullifier(id, cedulaNormalized);
        const duplicateBallot = await Ballot.exists({ election: id, nullifierHash });
        if (voter.hasVoted || duplicateBallot) {
            return res.status(409).json({
                success: false,
                message: "Tu cuenta ciudadana ya registró su respuesta única en esta encuesta."
            });
        }

        const hasMultiQuestions = Array.isArray(survey.questions) && survey.questions.length > 0;
        if (!hasMultiQuestions && !candidateId) {
            return res.status(400).json({ success: false, message: "Debes seleccionar una opción de respuesta." });
        }

        const forwardedFor = req.headers?.["x-forwarded-for"];
        const ipAddress =
            (Array.isArray(forwardedFor)
                ? forwardedFor[0]
                : String(forwardedFor || "").split(",")[0].trim()) ||
            req.socket?.remoteAddress ||
            "unknown";
        const device = req.headers?.["user-agent"] || "unknown";

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
        const safeCommune = String(commune || "").trim();
        const safeRegion = String(region || "").trim();

        const setFields = {};
        if (safeDisplayName) setFields.displayName = safeDisplayName;
        if (safeCommune) setFields.commune = safeCommune;
        if (safeRegion) setFields.region = safeRegion;

        const profile = await CitizenProfile.findOneAndUpdate(
            { cedulaNormalized },
            {
                ...(Object.keys(setFields).length > 0 ? { $set: setFields } : {}),
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
            { new: true }
        );

        const talliesMap = survey.settings?.publicResults
            ? await aggregateTalliesForSurveys([survey])
            : new Map();
        const surveyResults = survey.settings?.publicResults
            ? talliesMap.get(survey._id.toString()) || null
            : null;

        res.status(201).json({
            success: true,
            data: {
                receipt,
                pointsAwarded,
                profile: sanitizeCitizenProfile(profile),
                surveyResults
            }
        });
    } catch (err) {
        res.status(400).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * POST /api/plaza/profile
 * Update authenticated citizen's own profile ("Mis datos"). Never accepts foreign RUT hijacking.
 */
export const upsertCitizenProfile = async (req, res) => {
    try {
        const auth = readCitizenAuth(req);
        if (!auth || !auth.cedulaNormalized) {
            return res.status(401).json({
                success: false,
                message: "Debes iniciar sesión con tu cuenta ciudadana para actualizar tus datos."
            });
        }

        const { displayName, email, commune, region } = req.body || {};
        const updates = {};
        if (displayName !== undefined && String(displayName).trim()) {
            updates.displayName = String(displayName).trim();
        }
        if (email !== undefined) {
            const cleanEmail = String(email || "").trim().toLowerCase();
            if (cleanEmail && !isValidEmail(cleanEmail)) {
                return res.status(400).json({ success: false, message: "Correo electrónico inválido." });
            }
            if (cleanEmail) {
                const emailOwner = await CitizenProfile.findOne({
                    email: cleanEmail,
                    cedulaNormalized: { $ne: auth.cedulaNormalized }
                });
                if (emailOwner) {
                    return res.status(409).json({ success: false, message: "Ese correo ya está en uso por otra cuenta." });
                }
            }
            updates.email = cleanEmail;
        }
        if (commune !== undefined) updates.commune = String(commune || "").trim();
        if (region !== undefined) updates.region = String(region || "").trim();

        const profile = Object.keys(updates).length > 0
            ? await CitizenProfile.findOneAndUpdate(
                { cedulaNormalized: auth.cedulaNormalized },
                { $set: updates },
                { new: true }
            )
            : await CitizenProfile.findOne({ cedulaNormalized: auth.cedulaNormalized });

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
        const status = err.code === 11000 ? 409 : 400;
        res.status(status).json({ success: false, message: err.message });
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
    } catch {
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
            return res.status(401).json({ success: false, message: "Inicia sesión para canjear puntos." });
        }

        const { rewardId } = req.body || {};
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
