import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import Ballot from "../models/Ballot.js";
import User from "../models/User.js";
import Coupon from "../models/Coupon.js";

export const createElection = async (req, res) => {
    try {
        const { title, description, electionType, startDate, endDate, candidates, settings, votersCount, modules, couponCode } = req.body;
        const userId = req.user?.id;
        let isPaid = false;
        let price = 0;

        // 1. Calculate base price (from QuoteForm.jsx logic)
        let base = 50000;
        const vCount = parseInt(votersCount) || 0;
        if (vCount <= 100) base += vCount * 500;
        else if (vCount <= 500) base += vCount * 400;
        else if (vCount <= 2000) base += vCount * 300;
        else base += vCount * 200;

        if (modules?.virtualAssembly) base += 150000;
        if (modules?.technicalSupport) base += 100000;

        price = base;

        // 2. Apply Coupon if provided
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode.toUpperCase(), isActive: true });
            if (coupon) {
                const discount = (price * coupon.discountPercentage) / 100;
                price -= discount;
                if (price < 0) price = 0;
            }
        }

        // 2. Complex Benefit Logic for Chilean Schools
        if (userId && electionType === "Colegios") {
            const user = await User.findById(userId);
            if (user && user.country === "Chile") {
                const currentYear = new Date().getFullYear();

                // Rule: 1 per year
                const usedThisYear = user.freeElectionHistory.some(usage => usage.year === currentYear);

                if (!usedThisYear) {
                    // Rule: Only for 2 consecutive years
                    const years = user.freeElectionHistory.map(u => u.year).sort((a, b) => b - a);
                    let consecutiveCount = 0;

                    if (years.length > 0) {
                        // If they used it last year, they have 1 consecutive year
                        if (years[0] === currentYear - 1) {
                            consecutiveCount = 1;
                        } else if (years[0] < currentYear - 1) {
                            consecutiveCount = 0; // Break in sequence resets
                        }
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

        let filter = {};
        // If not admin, only see own elections
        if (req.user.role !== 'admin') {
            filter = { organizer: req.user.id };
        }

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

        // Security Check: Organizer or Admin
        const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
        const userId = req.user?.id?.toString();

        if (req.user && req.user.role !== 'admin' && organizerId) {
            if (organizerId !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "Acceso denegado: No eres el dueño de esta elección",
                    debug: { userId, organizerId }
                });
            }
        }

        res.status(200).json({ success: true, data: election });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

/**
 * Client: Update election configuration (title, candidates, dates, settings).
 * PUT /api/elections/:id
 */
export const updateElection = async (req, res) => {
    try {
        const election = await Election.findById(req.params.id);
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        // Security: Owner or Admin only
        if (req.user.role !== 'admin' && election.organizer?.toString() !== req.user.id) {
            return res.status(403).json({ success: false, message: "Forbidden: You cannot modify this election" });
        }

        const allowed = ['title', 'description', 'startDate', 'endDate', 'candidates', 'settings', 'electionType'];
        allowed.forEach(field => {
            if (req.body[field] !== undefined) election[field] = req.body[field];
        });
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
        // Log who approved it
        election.approvedBy = req.user?.email || req.user?.id || "unknown";
        election.approvedAt = new Date();

        if (approvalStatus === "approved") {
            election.status = "draft";
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

        const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
        if (req.user.role !== 'admin' && organizerId !== req.user.id) {
            return res.status(403).json({ success: false, message: "Forbidden: Access denied to voters list" });
        }

        const voters = await Voter.find({ election: req.params.id })
            .select("name cedula email hasVoted votedAt auditIp")
            .sort({ hasVoted: -1, name: 1 });

        const total = voters.length;
        const voted = voters.filter(v => v.hasVoted).length;

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
 * Get full report/acta for an election (Results, Quorum, List of Voters)
 * GET /api/elections/:id/report
 */
export const getElectionReport = async (req, res) => {
    try {
        const { id } = req.params;
        const election = await Election.findById(id).lean();
        if (!election) return res.status(404).json({ success: false, message: "Election not found" });

        const organizerId = election.organizer?._id?.toString() || election.organizer?.toString();
        if (req.user.role !== 'admin' && organizerId !== req.user.id) {
            return res.status(403).json({ success: false, message: "Forbidden: Access denied to report" });
        }

        // 1. Get totalPadron (all voters registered for this election)
        const totalPadron = await Voter.countDocuments({ election: id });

        // 2. Get all ballots for this election
        const ballots = await Ballot.find({ election: id }).lean();
        const votedCount = ballots.length;

        // 3. Calculate results per candidate
        const results = election.candidates.map(candidate => {
            const votes = ballots.filter(b => b.candidate && b.candidate.toString() === candidate._id.toString()).length;
            return {
                ...candidate,
                votes
            };
        });

        // 4. Calculate Blank/Nulo votes
        const blankVotes = ballots.filter(b => !b.candidate && !b.isNulo).length;
        const nuloVotes = ballots.filter(b => b.isNulo).length;

        // 5. Quorum & Abstention
        const quorum = totalPadron > 0 ? (votedCount / totalPadron) * 100 : 0;
        const abstentionCount = totalPadron - votedCount;

        // 6. Detailed Voter List (already partially handled by getElectionVoters)
        // We'll return it here for the "Acta"
        const votersList = await Voter.find({ election: id })
            .select("name cedula hasVoted votedAt auditIp")
            .sort({ name: 1 });

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
                    quorum: quorum.toFixed(2),
                },
                results,
                voters: votersList
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};

import { v4 as uuidv4 } from "uuid";
import { sendVoteConfirmationEmail } from "../utils/emailService.js";

export const castVote = async (req, res) => {
    try {
        const { cedula, voterName, voterEmail, choice, ip, isNulo = false } = req.body;
        const election = await Election.findById(req.params.id);
        if (!election || election.status !== "active") {
            return res.status(400).json({ success: false, message: "Election is not active." });
        }
        const uniqueCode = uuidv4();
        const votedAt = new Date();
        if (voterEmail) {
            sendVoteConfirmationEmail({
                to: voterEmail, name: voterName, rut: cedula,
                electionTitle: election.title, uniqueCode,
                ip: ip || "Unknown", date: votedAt,
            }).catch(err => console.error("[Email] Failed:", err));
        }
        res.status(200).json({ success: true, message: "Voto recibido correctamente.", data: { uniqueCode, votedAt } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
};
