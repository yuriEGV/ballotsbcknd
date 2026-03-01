/*import ElectionService from "../services/electionService.js";

export const createElection = async (req, res) => {
    try {
        const election = await ElectionService.createElection(
            req.body,
            req.user.id
        );

        res.status(201).json({
            success: true,
            data: election
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};

export const getElections = async (req, res) => {
    try {
        const elections = await ElectionService.getElections();
        res.status(200).json({
            success: true,
            data: elections
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};

export const getElectionById = async (req, res) => {
    try {
        const election = await ElectionService.getElectionById(req.params.id);

        if (!election) {
            return res.status(404).json({
                success: false,
                message: "Election not found"
            });
        }

        res.status(200).json({
            success: true,
            data: election
        });
    } catch (err) {
        res.status(400).json({
            success: false,
            error: err.message
        });
    }
};*/

import Election from "../models/Election.js";

const createElection = async (data, organizerId) => {
    return await Election.create({
        ...data,
        organizer: organizerId
    });
};

const getElections = async () => {
    return await Election.find();
};

const getElectionById = async (id) => {
    return await Election.findById(id);
};

export default {
    createElection,
    getElections,
    getElectionById
};

