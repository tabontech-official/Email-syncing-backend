import Stripe from 'stripe';
import { authModel } from '../Models/auth.js';

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key';
const stripe = new Stripe(stripeSecret);

/* ================== CREATE CHECKOUT SESSION ================== */
export const createCheckoutSession = async (req, res) => {
  try {
    const { userId } = req.params;
    const { planName = 'Elevate', quantity = 10, billingCycle = 'monthly' } = req.body;

    const user = await authModel.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let customerId = user.stripeCustomerId;

    if (!customerId && process.env.STRIPE_SECRET_KEY) {
      try {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { userId: user._id.toString() },
        });

        user.stripeCustomerId = customer.id;
        await user.save();
        customerId = customer.id;
      } catch (stripeErr) {
        console.warn('Stripe customer creation warning:', stripeErr.message);
      }
    }

    // Determine line item pricing
    let lineItems = [];
    let sessionMode = 'payment';

    if (planName === 'Elevate') {
      const priceCents = billingCycle === 'yearly' ? 850 : 999; // $9.99/mo or $8.50/mo
      lineItems = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Elevate Plan - 500 AI Replies/mo, 5 Active Scenarios',
              description: 'Up to 3 Connections, Up to 5 Team Members, Shared Inbox, Visual Scenario Builder',
            },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ];
    } else if (planName === 'Unite') {
      const priceCents = billingCycle === 'yearly' ? 1275 : 1499; // $14.99/mo or $12.75/mo
      lineItems = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Unite Plan - 1,000 AI Replies/mo, 15 Active Scenarios',
              description: 'Up to 10 Connections, Up to 20 Team Members, AI Fallback Rules & Priority Support',
            },
            unit_amount: priceCents,
          },
          quantity: 1,
        },
      ];
    } else if (planName === 'ExtraCredits') {
      const qty = Number(quantity) || 250;
      let packPriceCents = 399; // 250 = $3.99
      if (qty === 500) packPriceCents = 699;
      else if (qty === 1000) packPriceCents = 1199;
      else if (qty === 2500) packPriceCents = 2499;
      else if (qty === 5000) packPriceCents = 4499;

      lineItems = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Extra AI Replies Pack (${qty.toLocaleString()} AI Replies)`,
              description: 'Add-on AI replies buffer added to your account instantly',
            },
            unit_amount: packPriceCents,
          },
          quantity: 1,
        },
      ];
    }

    const clientUrl = process.env.CLIENT_URL || 'https://email-syncing-backend.vercel.app';

    if (process.env.STRIPE_SECRET_KEY) {
      const session = await stripe.checkout.sessions.create({
        mode: sessionMode,
        customer: customerId || undefined,
        line_items: lineItems,
        success_url: `${clientUrl}/pricing?success=true&plan=${planName}&qty=${quantity}`,
        cancel_url: `${clientUrl}/pricing?canceled=true`,
        metadata: {
          userId: user._id.toString(),
          planName,
          quantity: String(quantity),
        },
      });

      return res.json({ success: true, url: session.url });
    } else {
      // Mock local fallback response if STRIPE_SECRET_KEY is not configured
      return res.json({
        success: true,
        mock: true,
        message: 'Stripe test mode initialized',
        planName,
        quantity,
      });
    }
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ message: err.message });
  }
};

/* ================== DIRECT PLAN & EXTRA CREDITS UPDATE ================== */
export const updateUserPlanDirect = async (req, res) => {
  try {
    const { userId } = req.params;
    const { planName, action, quantity } = req.body;

    const user = await authModel.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.subscription) {
      user.subscription = { plan: 'Explore', aiRepliesUsed: 0, extraAiReplies: 0, status: 'active' };
    }

    if (action === 'buy_credits') {
      const addQty = Number(quantity) || 10;
      user.subscription.extraAiReplies = (user.subscription.extraAiReplies || 0) + addQty;
    } else if (planName) {
      user.subscription.plan = planName;
      user.subscription.status = 'active';
    }

    user.markModified('subscription');
    await user.save();

    return res.json({
      success: true,
      message: action === 'buy_credits' ? `Added ${quantity} extra AI replies!` : `Upgraded to ${planName} plan!`,
      data: user.subscription,
      user,
    });
  } catch (err) {
    console.error('Update plan error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== CANCEL SUBSCRIPTION ================== */
export const cancelSubscription = async (req, res) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await authModel.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.subscription) {
      user.subscription = { plan: 'Explore', aiRepliesUsed: 0, extraAiReplies: 0, status: 'canceled' };
    } else {
      user.subscription.plan = 'Explore';
      user.subscription.status = 'canceled';
      user.subscription.cancelReason = reason || 'User requested cancellation';
      user.subscription.canceledAt = new Date();
    }

    user.markModified('subscription');
    await user.save();

    return res.json({
      success: true,
      message: 'Subscription canceled successfully. Reverted to Explore (Free) plan.',
      data: user.subscription,
      user,
    });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== STRIPE WEBHOOK ================== */
export const stripeWebhook = async (req, res) => {
  const event = req.body;

  console.log('🔥 STRIPE EVENT:', event.type);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const planName = session.metadata?.planName;
    const quantity = Number(session.metadata?.quantity) || 0;

    if (userId) {
      const user = await authModel.findById(userId);
      if (user) {
        if (!user.subscription) {
          user.subscription = { plan: 'Explore', aiRepliesUsed: 0, extraAiReplies: 0, status: 'active' };
        }

        if (planName === 'ExtraCredits' && quantity > 0) {
          user.subscription.extraAiReplies = (user.subscription.extraAiReplies || 0) + quantity;
        } else if (planName) {
          user.subscription.plan = planName;
          user.subscription.status = 'active';
        }

        user.locked = false;
        user.markModified('subscription');
        await user.save();
        console.log(`✅ USER SUBSCRIPTION UPDATED: ${user.email} (${planName || 'Credits'})`);
      }
    }
  }

  res.status(200).json({ received: true });
};
