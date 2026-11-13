import mongoose from "mongoose";

let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

/**
 * Connect to MongoDB using connection caching suitable for both
 * long-lived servers and Vercel serverless functions.
 */
const connectDB = async () => {
    if (mongoose.connection.readyState === 1) {
        cached.conn = mongoose;
        return cached.conn;
    }

    if (cached.conn && mongoose.connection.readyState !== 0) {
        return cached.conn;
    }

    if (!process.env.MONGO_URI) {
        throw new Error("MONGO_URI is not defined in environment variables");
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false
        };
        cached.promise = mongoose.connect(process.env.MONGO_URI, opts).then((mongooseInstance) => {
            console.log(`MongoDB connected: ${mongooseInstance.connection.host}`);
            return mongooseInstance;
        });
    }

    try {
        cached.conn = await cached.promise;
    } catch (error) {
        cached.promise = null;
        console.error("MongoDB connection error:", error.message);
        throw error;
    }

    return cached.conn;
};

export default connectDB;
