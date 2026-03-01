import mongoose from "mongoose";

const ballotSchema = new mongoose.Schema({
    voter: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Voter",
        required: true
    },
    election: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Election",
        required: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Candidate",
        required: false // Allow null for blank votes
    },
    ipAddress: {
        type: String,
        required: true
    },
    device: {
        type: String
    },
    weight: {
        type: Number,
        default: 1
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    // Web3 / Blockchain simulation fields
    previousHash: {
        type: String,
        default: '0'
    },
    hash: {
        type: String,
        required: true
    },
    isNulo: {
        type: Boolean,
        default: false
    }
});

const Ballot = mongoose.model("Ballot", ballotSchema);
export default Ballot;
