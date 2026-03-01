import mongoose from "mongoose";

const electionSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    organizer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false
    },
    adminNote: { type: String, default: '' },
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
        default: "pending"
    },
    candidates: [
        {
            name: { type: String, required: true },
            description: String,
            imageUrl: String
        }
    ],
    settings: {
        anonymous: { type: Boolean, default: true },
        publicResults: { type: Boolean, default: false },
        weightedVoting: { type: Boolean, default: false },
        virtualAssembly: { type: Boolean, default: false },
        allowAutoRegistration: { type: Boolean, default: false }
    },
    approvedBy: { type: String, default: '' },
    approvedAt: { type: Date },
    isPaid: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    votersCount: { type: Number, default: 0 },
    modules: {
        virtualAssembly: { type: Boolean, default: false },
        technicalSupport: { type: Boolean, default: false }
    },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model("Election", electionSchema);
