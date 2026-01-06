import Stripe from 'stripe';
import { authModel } from '../Models/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ================== CREATE CHECKOUT ================== */
export const createCheckoutSession = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await authModel.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: user._id.toString() },
      });

      user.stripeCustomerId = customer.id;
      await user.save();
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          price: process.env.PRICE_ID_PRO,
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/organization`,
      cancel_url: `${process.env.CLIENT_URL}/pricing`,
      metadata: {
        userId: user._id.toString(),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ message: err.message });
  }
}

export const stripeWebhook = async (req, res) => {
  const event = req.body;

  console.log('🔥 STRIPE EVENT:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;

    if (userId) {
      const user = await authModel.findById(userId);
      if (user) {
        user.subscription = {
          id: session.subscription,
          status: 'active',
          plan: 'pro',
        };
        user.locked = false;
        await user.save();
        console.log('✅ USER UPGRADED:', user.email);
      }
    }
  }

  res.status(200).json({ received: true });
};
