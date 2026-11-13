import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import Ballot from "../models/Ballot.js";
import User from "../models/User.js";
import Coupon from "../models/Coupon.js";
import { computeMerkleRoot, computePadronLeaf } from "../utils/crypto.js";
import { computeElectionTallyRoot } from "./auditController.js";
import web3Service from "../services/web3Service.js";

function isOwnerOrAdmin(election, user) {
    if (!user) return false;
    if (user.role === "admin") return true;
    const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
    return Boolean(organizerId && organizerId === user.id?.toString());
}

export const createElection = async (req, res) => {
    try {
        const { title, description, electionType, startDate, endDate, candidates, settings, votersCount, modules, couponCode } = req.body;
        const userId = req.user?.id;
        let isPaid = false;
        let price = 0;

        let base = 50000;
        const vCount = parseInt(votersCount, 10) || 0;
        if (vCount <= 100) base += vCount * 500;
        else if (vCount <= 500) base += vCount * 400;
        else if (vCount <= 2000) base += vCount * 300;
        else base += vCount * 200;

        if (modules?.virtualAssembly) base += 150000;
        if (modules?.technicalSupport) base += 100000;

        price = base;

        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
            const isExpired = coupon?.validUntil && new Date() > new Date(coupon.validUntil);
            if (coupon && !isExpired) {
                const discount = (price * coupon.discountPercentage) / 100;
                price -= discount;
                if (price < 0) price = 0;
            }
        }

        if (userId && electionType === "Colegios") {
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
                        isPaid = true;
                        price = 0;
                        user.freeElectionHistory.push({ year: currentYear });
                        await user.save();
                    }
                }
            }
        }

        const election = await Election.create({
            title,
            description,
            electionType,
            startDate,
            endDate,
            candidates: candidates || [],
            settings,
            organizer: userId || null,
            approvalStatus: "pending",
            isPaid,
            price,
            votersCount: vCount,
            modules: modules || {}
        });
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
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: elections });
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
                    electionType: election.electionType,
                    startDate: election.startDate,
                    endDate: election.endDate,
                    status: election.status,
                    candidates: election.candidates,
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
 * Client/Admin: Update election configuration (title, candidates, dates, settings).
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
        if (ballotCount > 0 && req.body.candidates !== undefined) {
            return res.status(400).json({
                success: false,
                message: "No se pueden modificar los candidatos después de haberse emitido votos."
            });
        }

        const allowed = ["title", "description", "startDate", "endDate", "candidates", "settings", "electionType"];
        allowed.forEach((field) => {
            if (req.body[field] !== undefined) election[field] = req.body[field];
        });
        await election.save();
        res.status(200).json({ success: true, data: election });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * Organizer/Admin: Transition approved & paid election status ('active' <-> 'ended').
 * PUT /api/elections/:id/status
 */
export const updateElectionStatus = async (req, res) => {
    try {
        const { status } = req.body;
        if (!["active", "ended"].includes(status)) {
            return res.status(400).json({ success: false, message: "status must be 'active' or 'ended'" });
        }

        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        if (!isOwnerOrAdmin(election, req.user)) {
            return res.status(403).json({ success: false, message: "Forbidden" });
        }

        if (election.approvalStatus !== "approved" || !election.isPaid) {
            return res.status(400).json({
                success: false,
                message: "La elección debe estar pagada y aprobada antes de activarse."
            });
        }

        election.status = status;

        if (web3Service.isWeb3Configured()) {
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
                const tallyRoot = computeElectionTallyRoot(ballots);
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
                    tallyRoot,
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
        res.status(500).json({ success: false, error: err.message });
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
                    tallyRoot: computeElectionTallyRoot(ballots)
                },
                results,
                voters: votersList
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
