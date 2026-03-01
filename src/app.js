import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import passport from "passport";

import connectDB from "./config/db.js";

// Connect to database
connectDB();

// Load Models (IMPORTANTE: se cargan una sola vez)
import "./models/User.js";
import "./models/Voter.js";
import "./models/Election.js";
import "./models/Ballot.js";

// Passport config
import "./config/passport.js";

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(passport.initialize());

// Routes
import authRoutes from "./routes/auth.routes.js";
import electionRoutes from "./routes/election.routes.js";
import ballotRoutes from "./routes/ballot.routes.js";
import voterRoutes from "./routes/voter.routes.js";
import quoteRoutes from "./routes/quote.routes.js";
import couponRoutes from "./routes/coupon.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import userRoutes from "./routes/user.routes.js";

app.use("/api/auth", authRoutes);
app.use("/api/elections", electionRoutes);
app.use("/api/ballots", ballotRoutes);
app.use("/api/voters", voterRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);

// Health check
app.get("/", (req, res) => {
    res.send("Voting System API is running...");
});

/**
 * SOLO para desarrollo local
 * En Vercel NO se usa app.listen
 */
if (process.env.NODE_ENV !== "production") {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}


export default app;
