import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import passport from "passport";

import connectDB from "./config/db.js";
import { sanitizeNoSqlPayload, setCacheControl } from "./middleware/security.js";

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
app.disable("x-powered-by");

const STATIC_ALLOWED_ORIGINS = new Set(
    [
        "https://ballotsfrntnd.vercel.app",
        "https://ballotsfrntnd-git-main-yuris-projects-6953a511.vercel.app",
        process.env.FRONTEND_URL,
        ...(process.env.CORS_ORIGINS || "").split(",")
    ]
        .map((o) => String(o || "").trim().replace(/\/+$/, ""))
        .filter(Boolean)
);

const ALLOWED_ORIGIN_PATTERNS = [
    /^https:\/\/ballotsfrntnd(-[a-z0-9-]+)?\.vercel\.app$/i
];

function isAllowedOrigin(origin) {
    if (!origin) return true; // server-to-server, Postman/curl, healthchecks
    const normalized = String(origin).trim().replace(/\/+$/, "");
    if (STATIC_ALLOWED_ORIGINS.has(normalized)) return true;
    if (ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(normalized))) return true;
    if (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized)) {
        return true;
    }
    return false;
}

// Security Middleware
app.use(
    helmet({
        crossOriginResourcePolicy: { policy: "cross-origin" },
        referrerPolicy: { policy: "strict-origin-when-cross-origin" },
        hsts: { maxAge: 31536000, includeSubDomains: true }
    })
);
app.use(
    cors({
        origin(origin, callback) {
            if (isAllowedOrigin(origin)) {
                return callback(null, true);
            }
            const corsError = new Error("Origen no permitido por política CORS.");
            corsError.statusCode = 403;
            return callback(corsError);
        },
        credentials: true,
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    })
);
app.use(express.json({ limit: "512kb" }));
app.use(express.urlencoded({ extended: false, limit: "512kb" }));
app.use(sanitizeNoSqlPayload);
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
            ...(process.env.NODE_ENV !== "production" ? { error: error.message } : {})
        });
    }
});

// Prevent caching of sensitive authenticated responses
const noStore = setCacheControl("no-store");
app.use("/api/auth", noStore, authRoutes);
app.use("/api/elections", electionRoutes);
app.use("/api/ballots", ballotRoutes);
app.use("/api/voters", noStore, voterRoutes);
app.use("/api/quotes", quoteRoutes);
app.use("/api/coupons", couponRoutes);
app.use("/api/payments", noStore, paymentRoutes);
app.use("/api/users", noStore, userRoutes);
app.use("/api/plaza", plazaRoutes);
app.get("/api/pricing", setCacheControl("public, max-age=60, stale-while-revalidate=300"), getPricingCatalog);

// Health check
app.get("/", (_req, res) => {
    res.send("Voting System API is running...");
});

// Safe error handler (suppress internal stack traces in production)
app.use((err, _req, res, _next) => {
    if (err?.type === "entity.too.large") {
        return res.status(413).json({ success: false, message: "El tamaño de la solicitud supera el límite permitido." });
    }
    if (err?.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, message: "Formato JSON inválido." });
    }
    const status = err.statusCode || 500;
    const message =
        status < 500
            ? err.message
            : process.env.NODE_ENV === "production"
                ? "Error interno del servidor."
                : err.message || "Internal Server Error";
    res.status(status).json({ success: false, message });
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
