import mongoose from "mongoose";

const quoteSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String },
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
            "Otro"
        ],
        required: true
    },
    modules: [{ type: String }],
    technicalSupport: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ["pending", "contacted", "closed"],
        default: "pending"
    }
}, { timestamps: true });

export default mongoose.model("Quote", quoteSchema);
