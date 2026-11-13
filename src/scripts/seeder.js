import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../models/User.js";
import Election from "../models/Election.js";
import Voter from "../models/Voter.js";
import Ballot from "../models/Ballot.js";
import connectDB from "../config/db.js";
import { normalizeCedula } from "../utils/crypto.js";

dotenv.config();

const seedData = async () => {
    try {
        await connectDB();

        console.log("Clearing old data...");
        await User.deleteMany();
        await Election.deleteMany();
        await Voter.deleteMany();
        await Ballot.deleteMany();

        console.log("Creating Users...");
        await User.create({
            username: "admin",
            email: "admin@example.com",
            password: "password123",
            role: "admin"
        });

        const organizer = await User.create({
            username: "organizer",
            email: "organizer@example.com",
            password: "password123",
            role: "organizer"
        });

        console.log("Creating Election...");
        const now = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const election = await Election.create({
            title: "Student Body President 2026",
            description: "Election for the new student council president",
            organizer: organizer._id,
            startDate: now,
            endDate: nextWeek,
            status: "active",
            approvalStatus: "approved",
            isPaid: true,
            candidates: [
                { name: "Alice Johnson", description: "Experienced leader", imageUrl: "" },
                { name: "Bob Smith", description: "Voice of the students", imageUrl: "" }
            ],
            settings: { anonymous: true, publicResults: true }
        });

        console.log("Creating Voters...");
        const voters = await Voter.create([
            {
                election: election._id,
                name: "Student One",
                cedula: "11.111.111-1",
                cedulaNormalized: normalizeCedula("11.111.111-1"),
                email: "student1@school.edu",
                hasVoted: false
            },
            {
                election: election._id,
                name: "Student Two",
                cedula: "22.222.222-2",
                cedulaNormalized: normalizeCedula("22.222.222-2"),
                email: "student2@school.edu",
                hasVoted: false
            },
            {
                election: election._id,
                name: "Student Three",
                cedula: "33.333.333-3",
                cedulaNormalized: normalizeCedula("33.333.333-3"),
                email: "student3@school.edu",
                hasVoted: false
            }
        ]);

        console.log("Data Imported!");
        console.log("--------------------------");
        console.log("Admin Login: admin@example.com / password123");
        console.log("Organizer Login: organizer@example.com / password123");
        console.log(`Election ID: ${election._id}`);
        console.log(`Voter 1 ID: ${voters[0]._id} (RUT: 11.111.111-1)`);
        console.log("--------------------------");

        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

seedData();
