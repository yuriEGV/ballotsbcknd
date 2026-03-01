import mongoose from 'mongoose';
import Coupon from './src/models/Coupon.js';
import dotenv from 'dotenv';
dotenv.config();

const seedCoupons = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB Atlas for seeding coupons...');

        const coupons = [
            { code: 'EINSOFT10', discountPercentage: 10, validUntil: new Date('2026-12-31') },
            { code: 'BIENVENIDA20', discountPercentage: 20, validUntil: new Date('2026-12-31') },
            { code: 'PREMIUM40', discountPercentage: 40, validUntil: new Date('2026-12-31') },
            { code: 'LAUNCH2026', discountPercentage: 50, validUntil: new Date('2026-06-01') }
        ];

        for (const c of coupons) {
            await Coupon.findOneAndUpdate({ code: c.code }, c, { upsert: true, new: true });
            console.log(`Coupon ${c.code} seeded/updated.`);
        }

        console.log('Seeding completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding coupons:', error);
        process.exit(1);
    }
};

seedCoupons();
