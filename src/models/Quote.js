import mongoose from "mongoose";

const quoteSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
    processKind: {
        type: String,
        enum: ["election", "survey"],
        default: "election"
    },
    votersCount: { type: Number, required: true },
    eventType: {
        type: String,
        enum: [
            "Sindicatos",
            "Asociaciones",
            "Juntas de Vecinos",
            "Copropiedades",
            "Empresas",
            "Colegios",
            "Consultas",
            "Encuesta Ciudadana",
            "Encuesta Organizacional",
            "Otro"
        ],
        required: true
    },
    modules: [{ type: String }],
    technicalSupport: { type: Boolean, default: false },
    fullAuditPackage: { type: Boolean, default: false },
    estimatedCost: { type: Number, default: 0 },
    status: {
        type: String,
        enum: ["pending", "contacted", "closed"],
        default: "pending"
    }
}, { timestamps: true });

export default mongoose.model("Quote", quoteSchema);
