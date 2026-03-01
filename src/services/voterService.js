import Voter from "../models/Voter.js";

const addVoter = async (electionId, data) => {
    return await Voter.create({
        election: electionId,
        ...data
    });
};

const bulkAddVoters = async (electionId, votersData) => {
    const voters = votersData.map(v => ({
        ...v,
        election: electionId
    }));
    return await Voter.insertMany(voters);
};

const getVoters = async (electionId) => {
    return await Voter.find({ election: electionId }).sort({ createdAt: -1 });
};

export default {
    addVoter,
    bulkAddVoters,
    getVoters
};
