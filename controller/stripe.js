import Stripe from 'stripe';
import { authModel } from '../Models/auth.js';
import { PaymentHistoryModel } from '../Models/PaymentHistory.js';
import { isOwnerOrAdmin } from '../middleware/authmiddleware.js';
import { sanitizeUser } from './auth.js';

const stripeSecret = process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key';
const stripe = new Stripe(stripeSecret);

/* ================== GET PAYMENT HISTORY ================== */
export const getPaymentHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: You cannot access another user's payment history" });
    }

    let payments = await PaymentHistoryModel.find({ userId }).sort({ createdAt: -1 }).lean();

    if (!payments || payments.length === 0) {
      // Check user plan
      const user = await authModel.findById(userId);
      const plan = user?.subscription?.plan || 'Explore';
      const sample = [
        {
          _id: 'sample_inv_1',
          userId,
          invoiceId: `INV-${Date.now().toString().slice(-6)}`,
          description: `${plan} Plan Subscription`,
          amount: plan === 'Elevate' ? 9.99 : plan === 'Unite' ? 14.99 : 0.0,
          currency: 'USD',
          status: 'Paid',
          paymentMethod: plan === 'Explore' ? 'Free Tier' : 'Stripe (Visa •••• 4242)',
          createdAt: user?.createdAt || new Date(),
        },
      ];
      return res.json({ success: true, data: sample });
    }

    return res.json({ success: true, data: payments });
  } catch (err) {
    console.error('Error fetching payment history:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== CREATE STRIPE CHECKOUT SESSION ================== */
export const createCheckoutSession = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: You cannot create checkout sessions for another user" });
    }
    const { planName, quantity, billingCycle } = req.body;

    const user = await authModel.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    let lineItems = [];
    const isYearly = billingCycle === 'yearly';

    if (planName === 'Elevate') {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Elevate Plan - Replex Engine',
            description: '500 AI replies/mo, 5 Active Scenarios, 3 Connections, 5 Team Members',
          },
          unit_amount: isYearly ? 850 : 999, // $8.50/mo or $9.99/mo
          recurring: { interval: isYearly ? 'year' : 'month' },
        },
        quantity: 1,
      });
    } else if (planName === 'Unite') {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Unite Plan - Replex Engine',
            description: '1,000 AI replies/mo, 15 Active Scenarios, 10 Connections, 20 Team Members',
          },
          unit_amount: isYearly ? 1275 : 1499, // $12.75/mo or $14.99/mo
          recurring: { interval: isYearly ? 'year' : 'month' },
        },
        quantity: 1,
      });
    } else if (planName === 'ExtraCredits') {
      const qtyNum = Number(quantity) || 500;
      let unitPriceCents = 699;
      if (qtyNum === 250) unitPriceCents = 399;
      if (qtyNum === 500) unitPriceCents = 699;
      if (qtyNum === 1000) unitPriceCents = 1199;
      if (qtyNum === 2500) unitPriceCents = 2499;
      if (qtyNum === 5000) unitPriceCents = 4499;

      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: {
            name: `${qtyNum.toLocaleString()} Extra AI Replies Pack`,
            description: 'One-time AI reply credit pack',
          },
          unit_amount: unitPriceCents,
        },
        quantity: 1,
      });
    }

    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

    if (process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY !== 'sk_test_mock_key') {
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: planName === 'ExtraCredits' ? 'payment' : 'subscription',
        customer_email: user.email,
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
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: You cannot update another user's plan" });
    }
    const { planName, action, quantity } = req.body;

    const user = await authModel.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (!user.subscription) {
      user.subscription = { plan: 'Explore', aiRepliesUsed: 0, extraAiReplies: 0, status: 'active' };
    }

    let itemDesc = `${planName || 'Explore'} Plan Upgrade`;
    let itemAmt = planName === 'Elevate' ? 9.99 : planName === 'Unite' ? 14.99 : 0.0;

    if (action === 'buy_credits') {
      const addQty = Number(quantity) || 10;
      user.subscription.extraAiReplies = (user.subscription.extraAiReplies || 0) + addQty;
      let packAmt = 3.99;
      if (addQty === 500) packAmt = 6.99;
      else if (addQty === 1000) packAmt = 11.99;
      else if (addQty === 2500) packAmt = 24.99;
      else if (addQty === 5000) packAmt = 44.99;
      itemDesc = `Extra AI Replies Pack (${addQty.toLocaleString()} Credits)`;
      itemAmt = packAmt;
    } else if (planName) {
      user.subscription.plan = planName;
      user.subscription.status = 'active';
    }

    user.markModified('subscription');
    await user.save();

    // Record Payment Entry in DB
    await PaymentHistoryModel.create({
      userId,
      invoiceId: `INV-${Date.now().toString().slice(-6)}`,
      description: itemDesc,
      amount: itemAmt,
      currency: 'USD',
      status: 'Paid',
      paymentMethod: 'Stripe (Visa •••• 4242)',
    });

    return res.json({
      success: true,
      message: action === 'buy_credits' ? `Added ${quantity} extra AI replies!` : `Upgraded to ${planName} plan!`,
      data: user.subscription,
      user: sanitizeUser(user),
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
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: You cannot cancel another user's subscription" });
    }
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
      user: sanitizeUser(user),
    });
  } catch (err) {
    console.error('Cancel subscription error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== STRIPE WEBHOOK ================== */
export const stripeWebhook = async (req, res) => {
  /*
   |--------------------------------------------------------------------
   | Signature verification
   |--------------------------------------------------------------------
   |
   | This handler used to do `const event = req.body` and trust it. The
   | route is public by necessity, so anyone could POST a forged
   | checkout.session.completed with any userId and planName and grant
   | themselves a paid plan or unlimited AI credits.
   |
   | It also could not have worked as written: app.js mounts this route
   | with express.raw(), so req.body is a Buffer and `event.type` was
   | always undefined — every event fell through unprocessed.
   |
   | Fails CLOSED when no secret is configured. An unverifiable payment
   | webhook is worse than a rejected one.
   */
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers['stripe-signature'];

  if (!webhookSecret) {
    console.error(
      '[stripeWebhook] STRIPE_WEBHOOK_SECRET is not set — rejecting. ' +
        'Copy the signing secret from the Stripe dashboard webhook settings.'
    );
    return res.status(500).send('Webhook secret not configured');
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripeWebhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('🔥 STRIPE EVENT (verified):', event.type);

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

        let itemDesc = `${planName || 'Explore'} Plan Upgrade`;
        let itemAmt = planName === 'Elevate' ? 9.99 : planName === 'Unite' ? 14.99 : 0.0;

        if (planName === 'ExtraCredits' && quantity > 0) {
          user.subscription.extraAiReplies = (user.subscription.extraAiReplies || 0) + quantity;
          let packAmt = 3.99;
          if (quantity === 500) packAmt = 6.99;
          else if (quantity === 1000) packAmt = 11.99;
          else if (quantity === 2500) packAmt = 24.99;
          else if (quantity === 5000) packAmt = 44.99;
          itemDesc = `Extra AI Replies Pack (${quantity.toLocaleString()} Credits)`;
          itemAmt = packAmt;
        } else if (planName) {
          user.subscription.plan = planName;
          user.subscription.status = 'active';
        }

        user.locked = false;
        user.markModified('subscription');
        await user.save();

        await PaymentHistoryModel.create({
          userId,
          invoiceId: `INV-${Date.now().toString().slice(-6)}`,
          description: itemDesc,
          amount: itemAmt,
          currency: 'USD',
          status: 'Paid',
          paymentMethod: 'Stripe (Visa •••• 4242)',
        });

        console.log(`✅ USER SUBSCRIPTION UPDATED & PAYMENT RECORDED: ${user.email} (${planName || 'Credits'})`);
      }
    }
  }

  res.status(200).json({ received: true });
};
