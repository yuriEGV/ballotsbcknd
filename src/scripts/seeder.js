import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import Election from '../models/Election.js';
import Voter from '../models/Voter.js';
import Ballot from '../models/Ballot.js';
import connectDB from '../config/db.js';

// Load env vars
dotenv.config();

const seedData = async () => {
    try {
        await connectDB();

        console.log('Clearing old data...');
        await User.deleteMany();
        await Election.deleteMany();
        await Voter.deleteMany();
        await Ballot.deleteMany();

        console.log('Creating Users...');
        const admin = await User.create({
            username: 'admin',
            email: 'admin@example.com',
            password: 'password123',
            role: 'admin'
        });

        const organizer = await User.create({
            username: 'organizer',
            email: 'organizer@example.com',
            password: 'password123',
            role: 'organizer'
        });

        console.log('Creating Election...');
        // Create dates relative to now
        const now = new Date();
        const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

        const election = await Election.create({
            title: 'Student Body President 2025',
            description: 'Election for the new student council president',
            organizer: organizer._id,
            startDate: now,
            endDate: nextWeek,
            status: 'active',
            candidates: [
                { name: 'Alice Johnson', description: 'Experienced leader', imageUrl: 'http://example.com/alice.jpg' },
                { name: 'Bob Smith', description: 'Voice of the students', imageUrl: 'http://example.com/bob.jpg' }
            ],
            settings: { anonymous: true, publicResults: true }
        });

        console.log('Creating Voters...');
        // Note: Voter model now expects 'user' (ObjectId) not just identifiers as per updated schema in Step 156?
        // Wait, let's allow string identifier if the schema supports it.
        // Step 156 Schema: user: { type: ObjectId, ref: 'User', required: true }
        // This implies Voters MUST be users now?
        // The original plan allowed simple identifier. The USER changed it in Step 156 to require User reference.
        // We need to create Users for these voters first!

        // Let's create user accounts for voters
        const voter1User = await User.create({ username: 'student1', email: 'student1@school.edu', password: 'password123', role: 'observer' });
        const voter2User = await User.create({ username: 'student2', email: 'student2@school.edu', password: 'password123', role: 'observer' });
        const voter3User = await User.create({ username: 'student3', email: 'student3@school.edu', password: 'password123', role: 'observer' });

        const voters = await Voter.create([
            { election: election._id, user: voter1User._id, hasVoted: false },
            { election: election._id, user: voter2User._id, hasVoted: false },
            { election: election._id, user: voter3User._id, hasVoted: false }
        ]);

        console.log('Data Imported!');
        console.log('--------------------------');
        console.log(`Admin Login: admin@example.com / password123`);
        console.log(`Organizer Login: organizer@example.com / password123`);
        console.log(`Voter Login: student1@school.edu / password123`);
        console.log(`Election ID: ${election._id}`);
        console.log(`Voter 1 ID: ${voters[0]._id}`);
        console.log('--------------------------');

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

seedData();
