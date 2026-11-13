import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import passport from "passport";

import connectDB from "./config/db.js";

// Load Models
import "./models/User.js";
import "./models/Voter.js";
import "./models/Election.js";
import "./models/Ballot.js";
import "./models/CitizenProfile.js";

// Passport config
import "./config/passport.js";

// Routes
import authRoutes from "./routes/auth.routes.js";
import electionRoutes from "./routes/election.routes.js";
import ballotRoutes from "./routes/ballot.routes.js";
import voterRoutes from "./routes/voter.routes.js";
import quoteRoutes from "./routes/quote.routes.js";
import couponRoutes from "./routes/coupon.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import userRoutes from "./routes/user.routes.js";
import plazaRoutes from "./routes/plaza.routes.js";
import { getPricingCatalog } from "./controllers/plazaController.js";

const app = express();

// Middleware
app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(passport.initialize());

// Ensure database connection on serverless cold starts
app.use("/api", async (_req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        res.status(503).json({
            success: false,
            message: "Database connection unavailable",
            error: error.message
        });
    }
});

app.use("/api/auth", authRoutes);
app.use("/api/elections", electionRoutes);
app.use("/api/ballots", ballotRoutes);
app.use("/api/voters", voterRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/plaza", plazaRoutes);
app.get("/api/pricing", getPricingCatalog);

// Health check
app.get("/", (_req, res) => {
    res.send("Voting System API is running...");
});

// Local development server only (Vercel & tests import `app` directly)
if (!process.env.VERCEL && process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test") {
    const PORT = process.env.PORT || 3000;
    connectDB()
        .then(() => {
            app.listen(PORT, () => {
                console.log(`Server running on port ${PORT}`);
            });
        })
        .catch((err) => {
            console.error("Failed to start server:", err.message);
            process.exit(1);
        });
}

export default app;
