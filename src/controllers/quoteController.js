import Quote from "../models/Quote.js";
import Coupon from "../models/Coupon.js";
import { calculateProcessPricing } from "../utils/pricing.js";
import { isValidEmail } from "../middleware/security.js";

// @desc    Create a new quote request (Lead Capture)
// @route   POST /api/quotes
// @access  Public
export const createQuoteRequest = async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            processKind,
            votersCount,
            eventType,
            modules,
            technicalSupport,
            fullAuditPackage,
            couponCode
        } = req.body || {};

        const cleanName = String(name || "").trim();
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanVoters = Math.min(1000000, Math.max(1, parseInt(votersCount, 10) || 0));

        if (!cleanName || cleanName.length < 2) {
            return res.status(400).json({ success: false, message: "El nombre de contacto es obligatorio." });
        }
        if (!isValidEmail(cleanEmail)) {
            return res.status(400).json({ success: false, message: "Ingresa un correo electrónico válido." });
        }
        if (cleanVoters < 1) {
            return res.status(400).json({ success: false, message: "Ingresa una cantidad válida de participantes." });
        }

        let discountPercentage = 0;
        const cleanCoupon = couponCode ? String(couponCode).trim().toUpperCase() : "";
        if (cleanCoupon) {
            const coupon = await Coupon.findOne({ code: cleanCoupon, isActive: true });
            const isExpired = coupon?.validUntil && new Date() > new Date(coupon.validUntil);
            if (coupon && !isExpired) {
                discountPercentage = coupon.discountPercentage;
            }
        }

        const resolvedKind =
            processKind === "survey" ||
            ["Encuesta Ciudadana", "Encuesta Organizacional", "Consultas"].includes(eventType)
                ? "survey"
                : "election";

        const pricing = calculateProcessPricing({
            processKind: resolvedKind,
            votersCount: cleanVoters,
            modules: {
                virtualAssembly: Array.isArray(modules) ? modules.includes("virtual_assembly") : Boolean(modules?.virtualAssembly),
                technicalSupport: Boolean(technicalSupport || modules?.technicalSupport),
                fullAuditPackage: Boolean(fullAuditPackage || modules?.fullAuditPackage || (Array.isArray(modules) && modules.includes("full_audit_package")))
            },
            discountPercentage,
            freeSchoolBenefit: eventType === "Colegios" && resolvedKind === "election"
        });

        const newQuote = await Quote.create({
            name: cleanName,
            email: cleanEmail,
            phone: String(phone || "").trim(),
            processKind: resolvedKind,
            votersCount: cleanVoters,
            eventType: String(eventType || "Otro").trim(),
            modules: Array.isArray(modules) ? modules.map((m) => String(m)) : [],
            technicalSupport: pricing.normalizedModules.technicalSupport,
            fullAuditPackage: pricing.normalizedModules.fullAuditPackage,
            estimatedCost: pricing.total
        });

        res.status(201).json({
            success: true,
            data: newQuote,
            pricing,
            message: "Quote request received successfully! We'll contact you soon."
        });
    } catch (error) {
        console.error("Error creating quote request:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
