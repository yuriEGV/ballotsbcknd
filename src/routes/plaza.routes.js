import express from "express";
import {
    getPricingCatalog,
    registerCitizen,
    loginCitizen,
    bridgeUserToPlaza,
    getPublicSurveys,
    getPublicSurveyResults,
    respondToSurvey,
    upsertCitizenProfile,
    getCitizenProfile,
    redeemPlazaReward
} from "../controllers/plazaController.js";
import {
    requireAuth,
    requireCitizen,
    requirePlatformOrCitizen
} from "../middleware/authMiddleware.js";
import { authRateLimiter, publicActionRateLimiter } from "../middleware/rateLimiter.js";
import { setCacheControl, validateObjectIdParam } from "../middleware/security.js";

const router = express.Router();

// Public pricing catalog for landing quote estimator
router.get("/pricing", setCacheControl("public, max-age=60, stale-while-revalidate=300"), getPricingCatalog);

// Citizen authentication endpoints (rate-limited)
router.post("/auth/register", authRateLimiter, registerCitizen);
router.post("/auth/login", authRateLimiter, loginCitizen);
router.post("/auth/bridge", requireAuth, bridgeUserToPlaza);

// Protected Plaza Ciudadana endpoints (require login to enter/browse/vote/redeem)
router.get("/surveys", requireAuth, requirePlatformOrCitizen, getPublicSurveys);
router.get(
    "/surveys/:id/results",
    requireAuth,
    requirePlatformOrCitizen,
    validateObjectIdParam("id"),
    getPublicSurveyResults
);
router.post(
    "/surveys/:id/respond",
    publicActionRateLimiter,
    requireAuth,
    requireCitizen,
    validateObjectIdParam("id"),
    respondToSurvey
);
router.post("/profile", publicActionRateLimiter, requireAuth, requireCitizen, upsertCitizenProfile);
router.get("/profile/me", requireAuth, requireCitizen, getCitizenProfile);
router.post("/rewards/redeem", publicActionRateLimiter, requireAuth, requireCitizen, redeemPlazaReward);

export default router;
