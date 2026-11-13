import Voter from "../models/Voter.js";
import Election from "../models/Election.js";
import { computeMerkleRoot, computePadronLeaf, normalizeCedula } from "../utils/crypto.js";
import web3Service from "./web3Service.js";

/**
 * Recompute the anonymized Merkle root of all voters in an election
 * and synchronize it on-chain when registered.
 */
export const refreshElectionPadronRoot = async (electionId) => {
    const voters = await Voter.find({ election: electionId }).select("cedula").lean();
    const leaves = voters.map((v) => computePadronLeaf(electionId, v.cedula));
    const padronRoot = computeMerkleRoot(leaves);

    const election = await Election.findByIdAndUpdate(
        electionId,
        { $set: { "web3.padronRoot": padronRoot } },
        { new: true }
    );

    if (election?.web3?.registered) {
        try {
            await web3Service.syncPadronRoot({ electionId, padronRoot });
        } catch (err) {
            console.warn("[Web3] Failed to sync padronRoot on-chain:", err.message);
        }
    }

    return padronRoot;
};

const addVoter = async (electionId, data) => {
    const election = await Election.findById(electionId);
    if (!election) throw new Error("Election not found");

    const cedulaNormalized = normalizeCedula(data.cedula);
    if (!cedulaNormalized) throw new Error("Cédula/RUT es requerido");

    const existing = await Voter.findOne({ election: electionId, cedulaNormalized });
    if (existing) {
        throw new Error("Este RUT/Cédula ya está registrado en el padrón de esta elección");
    }

    const voter = await Voter.create({
        election: electionId,
        ...data,
        cedula: String(data.cedula).trim(),
        cedulaNormalized
    });

    await refreshElectionPadronRoot(electionId);
    return voter;
};

const bulkAddVoters = async (electionId, votersData) => {
    const election = await Election.findById(electionId);
    if (!election) throw new Error("Election not found");

    const seen = new Set();
    const voters = [];

    for (const v of votersData) {
        const cedulaNormalized = normalizeCedula(v.cedula);
        if (!cedulaNormalized || seen.has(cedulaNormalized)) continue;
        seen.add(cedulaNormalized);

        voters.push({
            ...v,
            cedula: String(v.cedula).trim(),
            cedulaNormalized,
            election: electionId
        });
    }

    if (voters.length === 0) {
        throw new Error("No se encontraron votantes válidos para importar");
    }

    const existing = await Voter.find({
        election: electionId,
        cedulaNormalized: { $in: Array.from(seen) }
    }).select("cedulaNormalized").lean();
    const existingSet = new Set(existing.map((e) => e.cedulaNormalized));

    const toInsert = voters.filter((v) => !existingSet.has(v.cedulaNormalized));
    if (toInsert.length === 0) {
        return [];
    }

    const inserted = await Voter.insertMany(toInsert);
    await refreshElectionPadronRoot(electionId);
    return inserted;
};

const getVoters = async (electionId) => {
    return await Voter.find({ election: electionId })
        .select("-votingKey -magicLinkToken")
        .sort({ createdAt: -1 });
};

export default {
    addVoter,
    bulkAddVoters,
    getVoters,
    refreshElectionPadronRoot
};
