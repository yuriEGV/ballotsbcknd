import Quote from "../models/Quote.js";

// @desc    Create a new quote request (Lead Capture)
// @route   POST /api/quotes
// @access  Public
export const createQuoteRequest = async (req, res) => {
    try {
        const { name, email, phone, votersCount, eventType, modules, technicalSupport } = req.body;

        const newQuote = await Quote.create({
            name,
            email,
            phone,
            votersCount,
            eventType,
            modules,
            technicalSupport
        });

        res.status(201).json({
            success: true,
            data: newQuote,
            message: "Quote request received successfully! We'll contact you soon."
        });
    } catch (error) {
        console.error("Error creating quote request:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
};
