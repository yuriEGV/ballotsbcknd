import express from "express";
import {
    getPricingCatalog,
    getPublicSurveys,
    getPublicSurveyResults,
    respondToSurvey,
    upsertCitizenProfile,
    getCitizenProfile,
    redeemPlazaReward
} from "../controllers/plazaController.js";

const router = express.Router();

router.get("/pricing", getPricingCatalog);
router.get("/surveys", getPublicSurveys);
router.get("/surveys/:id/results", getPublicSurveyResults);
router.post("/surveys/:id/respond", respondToSurvey);
router.post("/profile", upsertCitizenProfile);
router.get("/profile/me", getCitizenProfile);
router.post("/rewards/redeem", redeemPlazaReward);

export default router;
