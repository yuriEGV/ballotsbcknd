import mongoose from "mongoose";

const voterSchema = new mongoose.Schema({
    election: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Election",
        required: true
    },
    cedula: {
        type: String,
        required: true,
        trim: true
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String
    },
    weight: {
        type: Number,
        default: 1
    },
    hasVoted: {
        type: Boolean,
        default: false
    },
    votedAt: {
        type: Date
    },
    auditIp: {
        type: String
    },
    auditDevice: {
        type: String
    },
    magicLinkToken: {
        type: String
    },
    votingKey: {
        type: String
    }
}, {
    timestamps: true
});

// A voter's cedula must be unique within a single election
voterSchema.index({ election: 1, cedula: 1 }, { unique: true });

const Voter = mongoose.model("Voter", voterSchema);
export default Voter;
