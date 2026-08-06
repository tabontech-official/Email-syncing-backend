import express from "express";
import {
  createCheckoutSession,
  updateUserPlanDirect,
  stripeWebhook,
  cancelSubscription,
  getPaymentHistory,
} from "../controller/stripe.js";

const stripeRouter = express.Router();

stripeRouter.get("/payment-history/:userId", getPaymentHistory);

stripeRouter.post(
  "/create-checkout-session/:userId",
  express.json(),
  createCheckoutSession
);

stripeRouter.post(
  "/update-plan/:userId",
  express.json(),
  updateUserPlanDirect
);

stripeRouter.post(
  "/cancel-subscription/:userId",
  express.json(),
  cancelSubscription
);

stripeRouter.post("/webhook", stripeWebhook);

export default stripeRouter;
