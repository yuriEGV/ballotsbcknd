import express from "express";
import { createQuoteRequest } from "../controllers/quoteController.js";
import { publicActionRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

router.post("/", publicActionRateLimiter, createQuoteRequest);

export default router;
