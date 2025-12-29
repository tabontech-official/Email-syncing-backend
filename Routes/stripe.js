import express from 'express'
import { createCheckoutSession } from '../controller/stripe.js';

const stripeRouter =express.Router()


stripeRouter.post(
  "/create-checkout-session/:userId",
  createCheckoutSession
);


export default stripeRouter