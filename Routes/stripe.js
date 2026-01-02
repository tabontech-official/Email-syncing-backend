import express from 'express'
import { createCheckoutSession, stripeWebhook } from '../controller/stripe.js';

const stripeRouter =express.Router()


stripeRouter.post(
  "/create-checkout-session/:userId",
  createCheckoutSession
);
stripeRouter.post(
  "/stripe/webhook",
  stripeWebhook
);



export default stripeRouter