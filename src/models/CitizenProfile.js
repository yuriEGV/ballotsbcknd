import mongoose from "mongoose";

/**
 * Plaza Ciudadana participant profile.
 * Tracks civic points, participation receipts (never vote choices),
 * and redeemed rewards/coupons keyed by normalized cédula/RUT.
 */
const participationHistorySchema = new mongoose.Schema(
    {
        election: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Election",
            required: true
        },
        electionTitle: { type: String, default: "" },
        category: { type: String, default: "Ciudadanía" },
        pointsEarned: { type: Number, default: 0 },
        ballotCommitment: { type: String, default: "" },
        txHash: { type: String, default: "" },
        explorerUrl: { type: String, default: "" },
        participatedAt: { type: Date, default: Date.now }
    },
    { _id: true }
);

const rewardRedemptionSchema = new mongoose.Schema(
    {
        rewardId: { type: String, required: true },
        rewardTitle: { type: String, required: true },
        pointsCost: { type: Number, required: true },
        code: { type: String, default: "" },
        discountPercentage: { type: Number, default: 0 },
        redeemedAt: { type: Date, default: Date.now }
    },
    { _id: true }
);

const citizenProfileSchema = new mongoose.Schema(
    {
        cedulaNormalized: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        displayName: {
            type: String,
            default: "Ciudadano",
            trim: true
        },
        email: {
            type: String,
            default: "",
            trim: true
        },
        commune: {
            type: String,
            default: "",
            trim: true
        },
        region: {
            type: String,
            default: "",
            trim: true
        },
        points: {
            type: Number,
            default: 0,
            min: 0
        },
        participationsCount: {
            type: Number,
            default: 0,
            min: 0
        },
        history: [participationHistorySchema],
        redemptions: [rewardRedemptionSchema]
    },
    { timestamps: true }
);

export default mongoose.model("CitizenProfile", citizenProfileSchema);

