import mongoose from "mongoose";
import { GENESIS_HASH } from "../utils/crypto.js";

const surveyOptionSchema = new mongoose.Schema(
    {
        label: { type: String, required: true, trim: true }
    },
    { _id: true }
);

const surveyQuestionSchema = new mongoose.Schema(
    {
        prompt: { type: String, required: true, trim: true },
        allowMultiple: { type: Boolean, default: false },
        options: [surveyOptionSchema]
    },
    { _id: true }
);

const electionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    processKind: {
        type: String,
        enum: ["election", "survey"],
        default: "election"
    },
    organizer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false
    },
    adminNote: { type: String, default: "" },
    requiresAdminReview: { type: Boolean, default: false },
    electionType: {
        type: String,
        enum: [
            "Sindicatos",
            "Asociaciones",
            "Juntas de Vecinos",
            "Copropiedades",
            "Empresas",
            "Colegios",
            "Comité Paritario",
            "Directiva",
            "Negociación Colectiva",
            "Votación de Censura",
            "Cambio de Caja de Compensación",
            "Reforma de Estatutos",
            "Afiliación a Federación",
            "Consultas",
            "Encuesta Ciudadana",
            "Encuesta Organizacional",
            "Otro",
            "Otras"
        ],
        default: "Otras"
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
        type: String,
        enum: ["draft", "active", "ended"],
        default: "draft"
    },
    approvalStatus: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "approved"
    },
    candidates: [
        {
            name: { type: String, required: true },
            description: String,
            imageUrl: String
        }
    ],
    questions: [surveyQuestionSchema],
    settings: {
        anonymous: { type: Boolean, default: true },
        publicResults: { type: Boolean, default: false },
        weightedVoting: { type: Boolean, default: false },
        virtualAssembly: { type: Boolean, default: false },
        allowAutoRegistration: { type: Boolean, default: false },
        requireVotingKey: { type: Boolean, default: false }
    },
    plaza: {
        featuredInPlaza: { type: Boolean, default: false },
        category: { type: String, default: "Ciudadanía" },
        rewardPoints: { type: Number, default: 50, min: 0, max: 1000 }
    },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date },
    isPaid: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    pricingBreakdown: {
        baseFee: { type: Number, default: 0 },
        perVoterRate: { type: Number, default: 0 },
        participantsFee: { type: Number, default: 0 },
        modulesFee: { type: Number, default: 0 },
        subtotal: { type: Number, default: 0 },
        discountPercentage: { type: Number, default: 0 },
        discountAmount: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
    },
    votersCount: { type: Number, default: 0 },
    modules: {
        virtualAssembly: { type: Boolean, default: false },
        technicalSupport: { type: Boolean, default: false },
        fullAuditPackage: { type: Boolean, default: false }
    },
    ballotSequence: { type: Number, default: 0 },
    chainTip: { type: String, default: GENESIS_HASH },
    web3: {
        electionKey: { type: String, default: "" },
        registered: { type: Boolean, default: false },
        registerTxHash: { type: String, default: "" },
        finalized: { type: Boolean, default: false },
        finalizeTxHash: { type: String, default: "" },
        padronRoot: { type: String, default: GENESIS_HASH },
        tallyRoot: { type: String, default: GENESIS_HASH },
        contractAddress: { type: String, default: "" },
        chainId: { type: Number, default: null },
        network: { type: String, default: "" }
    },
    createdAt: { type: Date, default: Date.now }
});

electionSchema.index({ organizer: 1, createdAt: -1 });
electionSchema.index({ processKind: 1, "plaza.featuredInPlaza": 1, status: 1 });
electionSchema.index({ requiresAdminReview: 1, approvalStatus: 1 });

export default mongoose.model("Election", electionSchema);
