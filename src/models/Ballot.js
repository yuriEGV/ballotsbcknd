import mongoose from "mongoose";

/**
 * Anonymous ballot record.
 * Deliberately excludes voter ObjectId, IP address, and User-Agent so
 * ballot secrecy cannot be broken even with full database access.
 * Uniqueness is enforced via `nullifierHash` (unique per election) and
 * `BallotsRegistry` smart contract on-chain.
 */
const ballotSchema = new mongoose.Schema({
    election: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Election",
        required: true
    },
    candidate: {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
        default: null
    },
    isNulo: {
        type: Boolean,
        default: false
    },
    weight: {
        type: Number,
        default: 1,
        min: 1
    },
    sequenceIndex: {
        type: Number,
        required: true
    },
    timestampMs: {
        type: Number,
        required: true
    },
    nullifierHash: {
        type: String,
        required: true
    },
    ballotNonce: {
        type: String,
        required: true
    },
    choiceHash: {
        type: String,
        required: true
    },
    ballotCommitment: {
        type: String,
        required: true
    },
    previousHash: {
        type: String,
        required: true
    },
    hash: {
        type: String,
        required: true
    },
    web3: {
        anchored: { type: Boolean, default: false },
        network: { type: String, default: "" },
        chainId: { type: Number, default: null },
        contractAddress: { type: String, default: "" },
        txHash: { type: String, default: "" },
        blockNumber: { type: Number, default: null },
        explorerUrl: { type: String, default: "" },
        onChainVoteIndex: { type: Number, default: null },
        error: { type: String, default: "" }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

ballotSchema.index({ election: 1, nullifierHash: 1 }, { unique: true });
ballotSchema.index({ election: 1, sequenceIndex: 1 }, { unique: true });
ballotSchema.index({ ballotCommitment: 1 });

const Ballot = mongoose.model("Ballot", ballotSchema);
export default Ballot;
