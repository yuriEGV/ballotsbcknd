import mongoose from 'mongoose';
import User from '../models/User.js';
import dotenv from 'dotenv';
dotenv.config();

const seedAdmins = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const admins = [
            {
                username: 'yuri',
                email: 'yuri@ballots.cl',
                password: '123456',
                role: 'admin'
            },
            {
                username: 'sarem',
                email: 'sarem@ballots.cl',
                password: '123456',
                role: 'admin'
            }
        ];

        for (const admin of admins) {
            const existing = await User.findOne({ email: admin.email });
            if (!existing) {
                await User.create(admin);
                console.log(`Created admin: ${admin.email}`);
            } else {
                console.log(`Admin already exists: ${admin.email}`);
            }
        }

        console.log('Seeding complete.');
        process.exit();
    } catch (error) {
        console.error('Error seeding admins:', error);
        process.exit(1);
    }
};

seedAdmins();
