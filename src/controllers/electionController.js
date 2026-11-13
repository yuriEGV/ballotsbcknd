import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import Ballot from "../models/Ballot.js";
import User from "../models/User.js";
import Coupon from "../models/Coupon.js";
import { computeMerkleRoot, computePadronLeaf } from "../utils/crypto.js";
import { calculateProcessPricing } from "../utils/pricing.js";
import { computeElectionTallyRoot } from "./auditController.js";
import web3Service from "../services/web3Service.js";

function isOwnerOrAdmin(election, user) {
    if (!user) return false;
    if (user.role === "admin") return true;
    const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
    return Boolean(organizerId && organizerId === user.id?.toString());
}

function sanitizeQuestions(rawQuestions = []) {
    if (!Array.isArray(rawQuestions)) return [];
    return rawQuestions
        .filter((q) => q && String(q.prompt || "").trim())
        .map((q) => ({
            ...(q._id ? { _id: q._id } : {}),
            prompt: String(q.prompt).trim(),
            allowMultiple: Boolean(q.allowMultiple),
            options: (Array.isArray(q.options) ? q.options : [])
                .map((opt) => (typeof opt === "string" ? { label: opt.trim() } : { ...(opt._id ? { _id: opt._id } : {}), label: String(opt?.label || opt?.name || "").trim() }))
                .filter((opt) => opt.label)
        }))
        .filter((q) => q.options.length > 0);
}

export const createElection = async (req, res) => {
    try {
        const {
            title,
            description,
            processKind,
            electionType,
            startDate,
            endDate,
            candidates,
            questions,
            settings,
            plaza,
            votersCount,
            modules,
            couponCode
        } = req.body;
        const userId = req.user?.id;
        const resolvedKind = processKind === "survey" ? "survey" : "election";

        let discountPercentage = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: String(couponCode).toUpperCase(), isActive: true });
            const isExpired = coupon?.validUntil && new Date() > new Date(coupon.validUntil);
            if (coupon && !isExpired) {
                discountPercentage = Number(coupon.discountPercentage) || 0;
            }
        }

        let freeSchoolBenefit = false;
        let userToSave = null;
        if (userId && electionType === "Colegios" && resolvedKind === "election") {
            const user = await User.findById(userId);
            if (user && user.country === "Chile") {
                const currentYear = new Date().getFullYear();
                const usedThisYear = user.freeElectionHistory.some((usage) => usage.year === currentYear);

                if (!usedThisYear) {
                    const years = user.freeElectionHistory.map((u) => u.year).sort((a, b) => b - a);
                    let consecutiveCount = 0;
                    if (years.length > 0 && years[0] === currentYear - 1) {
                        consecutiveCount = 1;
                    }
                    if (consecutiveCount < 2) {
                        freeSchoolBenefit = true;
                        user.freeElectionHistory.push({ year: currentYear });
                        userToSave = user;
                    }
                }
            }
        }

        const pricing = calculateProcessPricing({
            processKind: resolvedKind,
            votersCount,
            modules,
            discountPercentage,
            freeSchoolBenefit
        });

        const requiresAdminReview = pricing.requiresAdminReview;
        const isPaid = pricing.total === 0;
        const approvalStatus = requiresAdminReview ? "pending" : "approved";
        const initialStatus = isPaid && approvalStatus === "approved" ? "active" : "draft";

        const normalizedQuestions = sanitizeQuestions(questions);
        const featuredInPlaza =
            resolvedKind === "survey" ? Boolean(plaza?.featuredInPlaza ?? true) : false;

        const normalizedSettings = {
            anonymous: settings?.anonymous ?? true,
            publicResults: settings?.publicResults ?? (resolvedKind === "survey" && featuredInPlaza),
            weightedVoting: Boolean(settings?.weightedVoting),
            virtualAssembly: Boolean(settings?.virtualAssembly || pricing.normalizedModules.virtualAssembly),
            allowAutoRegistration:
                settings?.allowAutoRegistration ?? Boolean(resolvedKind === "survey" && featuredInPlaza),
            requireVotingKey: Boolean(settings?.requireVotingKey)
        };

        const election = await Election.create({
            title,
            description,
            processKind: resolvedKind,
            electionType: electionType || (resolvedKind === "survey" ? "Encuesta Ciudadana" : "Otras"),
            startDate,
            endDate,
            candidates: candidates || [],
            questions: normalizedQuestions,
            settings: normalizedSettings,
            plaza: {
                featuredInPlaza,
                category: plaza?.category || "Ciudadanía",
                rewardPoints: Math.min(1000, Math.max(0, Number(plaza?.rewardPoints ?? 50)))
            },
            organizer: userId || null,
            requiresAdminReview,
            approvalStatus,
            approvedBy: requiresAdminReview ? "" : "auto-self-service",
            approvedAt: requiresAdminReview ? undefined : new Date(),
            status: initialStatus,
            isPaid,
            price: pricing.total,
            pricingBreakdown: {
                baseFee: pricing.baseFee,
                perVoterRate: pricing.perVoterRate,
                participantsFee: pricing.participantsFee,
                modulesFee: pricing.modulesFee,
                subtotal: pricing.subtotal,
                discountPercentage: pricing.discountPercentage,
                discountAmount: pricing.discountAmount,
                total: pricing.total
            },
            votersCount: pricing.votersCount,
            modules: pricing.normalizedModules
        });

        if (userToSave) {
            await userToSave.save();
        }

        if (election.status === "active" && web3Service.isWeb3Configured()) {
            try {
                const reg = await web3Service.ensureElectionRegistered({
                    electionId: election._id,
                    padronRoot: computeMerkleRoot([]),
                    openPadron: Boolean(election.settings?.allowAutoRegistration),
                    startDate: election.startDate,
                    endDate: election.endDate
                });
                election.web3 = {
                    ...(election.web3 || {}),
                    electionKey: reg.electionKey,
                    registered: true,
                    registerTxHash: reg.txHash || "",
                    padronRoot: computeMerkleRoot([]),
                    contractAddress: reg.contractAddress,
                    chainId: reg.chainId,
                    network: reg.networkName
                };
                await election.save();
            } catch (web3Err) {
                console.warn("[Web3] Auto-activation registration warning:", web3Err.message);
            }
        }

        res.status(201).json({ success: true, data: election });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

export const getElections = async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

        const filter = req.user.role === "admin" ? {} : { organizer: req.user.id };

        const elections = await Election.find(filter)
            .populate("organizer", "username email organization")
            .sort({ createdAt: -1 })
            .lean();

        const electionIds = elections.map((e) => e._id);
        const votersByElection = new Map();
        const ballotsByElection = new Map();

        if (electionIds.length > 0 && typeof Voter.aggregate === "function" && typeof Ballot.aggregate === "function") {
            const [voterCounts, ballotCounts] = await Promise.all([
                Voter.aggregate([
                    { $match: { election: { $in: electionIds } } },
                    { $group: { _id: "$election", count: { $sum: 1 } } }
                ]),
                Ballot.aggregate([
                    { $match: { election: { $in: electionIds } } },
                    { $group: { _id: "$election", count: { $sum: 1 } } }
                ])
            ]);
            voterCounts.forEach((row) => votersByElection.set(row._id.toString(), row.count));
            ballotCounts.forEach((row) => ballotsByElection.set(row._id.toString(), row.count));
        }

        const enriched = elections.map((e) => ({
            ...e,
            registeredVotersCount: votersByElection.get(e._id.toString()) || 0,
            votedCount: ballotsByElection.get(e._id.toString()) || 0
        }));

        res.status(200).json({ success: true, data: enriched });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

export const getElectionById = async (req, res) => {
    try {
        const election = await Election.findById(req.params.id)
            .populate("organizer", "username email organization");
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        // Authenticated non-admin organizers cannot inspect another organizer's private election
        if (req.user && req.user.role !== "admin" && req.user.role !== "voter") {
            const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
            if (organizerId && organizerId !== req.user.id?.toString()) {
                return res.status(403).json({
                    success: false,
                    message: "Acceso denegado: No eres el dueño de esta elección"
                });
            }
        }

        // Public / voter requests only receive public ballot metadata (never adminNote / price)
        if (!req.user || req.user.role === "voter") {
            return res.status(200).json({
                success: true,
                data: {
                    _id: election._id,
                    title: election.title,
                    description: election.description,
                    processKind: election.processKind || "election",
                    electionType: election.electionType,
                    startDate: election.startDate,
                    endDate: election.endDate,
                    status: election.status,
                    candidates: election.candidates,
                    questions: election.questions || [],
                    plaza: election.plaza,
                    settings: election.settings,
                    web3: {
                        registered: Boolean(election.web3?.registered),
                        contractAddress: election.web3?.contractAddress || "",
                        chainId: election.web3?.chainId || null,
                        network: election.web3?.network || ""
                    }
                }
            });
        }

        res.status(200).json({ success: true, data: election });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

/**
 * Client/Admin: Update election configuration (title, candidates, questions, dates, settings, plaza).
 * PUT /api/elections/:id
 */
export const updateElection = async (req, res) => {
    try {
        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        if (!isOwnerOrAdmin(election, req.user)) {
            return res.status(403).json({ success: false, message: "Forbidden: You cannot modify this election" });
        }

        const ballotCount = await Ballot.countDocuments({ election: election._id });
        if (ballotCount > 0 && (req.body.candidates !== undefined || req.body.questions !== undefined)) {
            return res.status(400).json({
                success: false,
                message: "No se pueden modificar los candidatos u opciones después de haberse emitido votos."
            });
        }

        const allowed = ["title", "description", "startDate", "endDate", "candidates", "settings", "electionType", "plaza"];
        allowed.forEach((field) => {
            if (req.body[field] !== undefined) election[field] = req.body[field];
        });
        if (ballotCount === 0 && req.body.processKind !== undefined && ["election", "survey"].includes(req.body.processKind)) {
            election.processKind = req.body.processKind;
        }
        if (req.body.questions !== undefined) {
            election.questions = sanitizeQuestions(req.body.questions);
        }
        await election.save();
        res.status(200).json({ success: true, data: election });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * Organizer/Admin: Transition election status ('draft' | 'active' | 'ended').
 * Supports pausing/setting to pending ('draft'), activating ('active'), and closing ('ended').
 * PUT /api/elections/:id/status
 */
export const updateElectionStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!["draft", "active", "ended"].includes(status)) {
            return res.status(400).json({
                success: false,
                message: "El estado debe ser 'draft' (pendiente/pausada), 'active' (activa) o 'ended' (apagada/finalizada)."
            });
        }

        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        if (!isOwnerOrAdmin(election, req.user)) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        const isAdmin = req.user?.role === "admin";
        if (status === "active" && !isAdmin) {
            if (!election.isPaid || (election.requiresAdminReview && election.approvalStatus !== "approved")) {
                return res.status(400).json({
                    success: false,
                    message: "El proceso debe estar pagado (y aprobado si seleccionaste Paquete de Auditorías) antes de activarse."
                });
            }
        }

        if (status === "active" && isAdmin && election.approvalStatus === "pending") {
            election.approvalStatus = "approved";
            election.approvedBy = req.user.email || req.user.id || "admin";
            election.approvedAt = new Date();
        }

        election.status = status;

        if (web3Service.isWeb3Configured() && (status === "active" || (status === "ended" && (election.isPaid || election.web3?.registered)))) {
            const voters = await Voter.find({ election: election._id }).select("cedula").lean();
            const padronRoot = computeMerkleRoot(voters.map((v) => computePadronLeaf(election._id, v.cedula)));

            if (status === "active") {
                const reg = await web3Service.ensureElectionRegistered({
                    electionId: election._id,
                    padronRoot,
                    openPadron: Boolean(election.settings?.allowAutoRegistration),
                    startDate: election.startDate,
                    endDate: election.endDate
                });
                election.web3 = {
                    ...(election.web3 || {}),
                    electionKey: reg.electionKey,
                    registered: true,
                    registerTxHash: election.web3?.registerTxHash || reg.txHash || "",
                    padronRoot,
                    contractAddress: reg.contractAddress,
                    chainId: reg.chainId,
                    network: reg.networkName
                };
            } else if (status === "ended") {
                const ballots = await Ballot.find({ election: election._id })
                    .select("ballotCommitment choiceHash weight")
                    .lean();
                const tallyRoot = computeElectionTallyRoot(ballots, election._id);
                const fin = await web3Service.finalizeElectionOnChain({
                    electionId: election._id,
                    tallyRoot,
                    padronRoot,
                    openPadron: Boolean(election.settings?.allowAutoRegistration),
                    startDate: election.startDate,
                    endDate: election.endDate
                });
                election.web3 = {
                    ...(election.web3 || {}),
                    registered: true,
                    finalized: true,
                    tallyRoot: fin.tallyRoot || tallyRoot,
                    finalizeTxHash: fin.txHash || election.web3?.finalizeTxHash || "",
                    contractAddress: fin.contractAddress || election.web3?.contractAddress || "",
                    chainId: fin.chainId || election.web3?.chainId || null,
                    network: fin.networkName || election.web3?.network || ""
                };
            }
        }

        await election.save();
        res.status(200).json({ success: true, data: election });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message, error: err.message });
    }
};

/**
 * Admin: Approve or reject a pending election.
 * PUT /api/elections/:id/evaluate
 */
export const evaluateElection = async (req, res) => {
    try {
        const { approvalStatus, reason } = req.body;
        if (!["approved", "rejected"].includes(approvalStatus)) {
            return res.status(400).json({ success: false, message: "approvalStatus must be 'approved' or 'rejected'" });
        }
        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        if (approvalStatus === "approved" && !election.isPaid) {
            return res.status(402).json({ success: false, message: "La elección debe estar pagada para ser aprobada." });
        }

        election.approvalStatus = approvalStatus;
        election.adminNote = reason || "";
        election.approvedBy = req.user?.email || req.user?.id || "unknown";
        election.approvedAt = new Date();

        if (approvalStatus === "approved") {
            // Once paid and approved, transition election to active so voters can vote
            election.status = "active";

            if (web3Service.isWeb3Configured()) {
                try {
                    const voters = await Voter.find({ election: election._id }).select("cedula").lean();
                    const padronRoot = computeMerkleRoot(
                        voters.map((v) => computePadronLeaf(election._id, v.cedula))
                    );
                    const reg = await web3Service.ensureElectionRegistered({
                        electionId: election._id,
                        padronRoot,
                        openPadron: Boolean(election.settings?.allowAutoRegistration),
                        startDate: election.startDate,
                        endDate: election.endDate
                    });
                    election.web3 = {
                        ...(election.web3 || {}),
                        electionKey: reg.electionKey,
                        registered: true,
                        registerTxHash: reg.txHash || "",
                        padronRoot,
                        contractAddress: reg.contractAddress,
                        chainId: reg.chainId,
                        network: reg.networkName
                    };
                } catch (web3Err) {
                    console.warn("[Web3] Election registration warning on approval:", web3Err.message);
                }
            }
        }

        await election.save();
        res.status(200).json({ success: true, message: `Election ${approvalStatus}`, data: election });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Get voter stats for an election.
 * GET /api/elections/:id/voters
 */
export const getElectionVoters = async (req, res) => {
    try {
        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        if (!isOwnerOrAdmin(election, req.user)) {
            return res.status(403).json({ success: false, message: "Forbidden: Access denied to voters list" });
        }

        const voters = await Voter.find({ election: req.params.id })
            .select("name cedula email weight hasVoted votedAt auditIp")
            .sort({ hasVoted: -1, name: 1 });

        const total = voters.length;
        const voted = voters.filter((v) => v.hasVoted).length;

        res.status(200).json({
            success: true,
            stats: { total, voted, pending: total - voted },
            data: voters
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Get full report/acta for an election (Results, Quorum, List of Voters, Web3 Proof).
 * GET /api/elections/:id/report
 */
export const getElectionReport = async (req, res) => {
    try {
        const { id } = req.params;
        const election = await Election.findById(id).lean();
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        if (!isOwnerOrAdmin(election, req.user)) {
            return res.status(403).json({ success: false, message: "Forbidden: Access denied to report" });
        }

        const totalPadron = await Voter.countDocuments({ election: id });
        const ballots = await Ballot.find({ election: id }).lean();
        const votedCount = ballots.length;
        const weighted = Boolean(election.settings?.weightedVoting);

        const tallyWeight = (list) =>
            list.reduce((acc, b) => acc + (weighted ? Number(b.weight) || 1 : 1), 0);

        const results = (election.candidates || []).map((candidate) => {
            const matching = ballots.filter(
                (b) => b.candidate && b.candidate.toString() === candidate._id.toString()
            );
            return {
                ...candidate,
                votes: tallyWeight(matching),
                rawVotes: matching.length
            };
        });

        const blankBallots = ballots.filter((b) => !b.candidate && !b.isNulo);
        const nuloBallots = ballots.filter((b) => b.isNulo);
        const blankVotes = tallyWeight(blankBallots);
        const nuloVotes = tallyWeight(nuloBallots);

        const quorum = totalPadron > 0 ? (votedCount / totalPadron) * 100 : 0;
        const abstentionCount = Math.max(0, totalPadron - votedCount);

        const votersList = await Voter.find({ election: id })
            .select("name cedula weight hasVoted votedAt auditIp")
            .sort({ name: 1 });

        const onChain = await web3Service.getElectionOnChain(id);
        const anchoredVotesCount = ballots.filter((b) => b.web3?.anchored).length;

        const questionResults = (election.questions || []).map((question) => {
            const qId = question._id.toString();
            const optionCounts = new Map(
                (question.options || []).map((o) => [o.label, 0])
            );
            ballots.forEach((ballot) => {
                const match = (ballot.surveyAnswers || []).find(
                    (ans) => ans.questionId === qId || ans.questionPrompt === question.prompt
                );
                if (match && Array.isArray(match.selectedOptions)) {
                    const weightVal = weighted ? Number(ballot.weight) || 1 : 1;
                    match.selectedOptions.forEach((opt) => {
                        optionCounts.set(opt, (optionCounts.get(opt) || 0) + weightVal);
                    });
                }
            });
            return {
                _id: question._id,
                prompt: question.prompt,
                allowMultiple: Boolean(question.allowMultiple),
                options: (question.options || []).map((o) => ({
                    label: o.label,
                    votes: optionCounts.get(o.label) || 0
                }))
            };
        });

        res.status(200).json({
            success: true,
            data: {
                election,
                stats: {
                    totalPadron,
                    votedCount,
                    abstentionCount,
                    blankVotes,
                    nuloVotes,
                    totalWeight: tallyWeight(ballots),
                    quorum: quorum.toFixed(2),
                    anchoredVotesCount
                },
                web3: {
                    ...onChain,
                    tallyRoot: computeElectionTallyRoot(ballots, election._id)
                },
                results,
                questionResults,
                voters: votersList
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
