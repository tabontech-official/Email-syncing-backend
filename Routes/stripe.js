import express from "express";
import {
  createCheckoutSession,
  updateUserPlanDirect,
  stripeWebhook,
  cancelSubscription,
  getPaymentHistory,
} from "../controller/stripe.js";
import { authMiddleware } from "../middleware/authmiddleware.js";

const stripeRouter = express.Router();

// --- Authenticated User Endpoints ---
stripeRouter.get("/payment-history/:userId", authMiddleware, getPaymentHistory);
stripeRouter.post(
  "/create-checkout-session/:userId",
  authMiddleware,
  express.json(),
  createCheckoutSession
);
stripeRouter.post(
  "/update-plan/:userId",
  authMiddleware,
  express.json(),
  updateUserPlanDirect
);
stripeRouter.post(
  "/cancel-subscription/:userId",
  authMiddleware,
  express.json(),
  cancelSubscription
);

// --- Public Webhook ---
stripeRouter.post("/webhook", stripeWebhook);

export default stripeRouter;
