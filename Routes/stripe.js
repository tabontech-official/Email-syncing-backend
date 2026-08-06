import express from "express";
import { createCheckoutSession, updateUserPlanDirect, stripeWebhook } from "../controller/stripe.js";

const stripeRouter = express.Router();

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

stripeRouter.post("/webhook", stripeWebhook);

export default stripeRouter;
