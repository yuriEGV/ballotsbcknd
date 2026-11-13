import Quote from "../models/Quote.js";
import Coupon from "../models/Coupon.js";
import { calculateProcessPricing } from "../utils/pricing.js";

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
        } = req.body;

        let discountPercentage = 0;
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: String(couponCode).toUpperCase(), isActive: true });
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
            votersCount,
            modules: {
                virtualAssembly: Array.isArray(modules) ? modules.includes("virtual_assembly") : Boolean(modules?.virtualAssembly),
                technicalSupport: Boolean(technicalSupport || modules?.technicalSupport),
                fullAuditPackage: Boolean(fullAuditPackage || modules?.fullAuditPackage || (Array.isArray(modules) && modules.includes("full_audit_package")))
            },
            discountPercentage,
            freeSchoolBenefit: eventType === "Colegios" && resolvedKind === "election"
        });

        const newQuote = await Quote.create({
            name,
            email,
            phone,
            processKind: resolvedKind,
            votersCount,
            eventType,
            modules: Array.isArray(modules) ? modules : [],
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
