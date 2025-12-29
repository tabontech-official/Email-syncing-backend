import Stripe from "stripe";
import { authModel } from "../Models/auth.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);


export const createCheckoutSession = async (req, res) => {
  try {
    const { userId } = req.params; // 🔁 FIXED
    const user = await authModel.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let customerId = user.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.fullName || user.email,
        metadata: {
          userId: user._id.toString(),
        },
      });

      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.PRICE_ID_PRO,
          quantity: 1,
        },
      ],
      success_url: `${process.env.CLIENT_URL}/success`,
      cancel_url: `${process.env.CLIENT_URL}/pricing`,
      metadata: {
        userId: user._id.toString(),
        plan: "pro",
      },
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error("❌ Stripe checkout error:", error);
    return res.status(500).json({ message: error.message });
  }
};


export const stripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.metadata.userId;

        const user = await authModel.findById(userId);
        if (!user) break;

        user.subscription = {
          id: session.subscription,
          status: "active",
          plan: "pro",
        };

        user.locked = false;
        await user.save();

        console.log("✅ User upgraded to PRO:", user.email);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;

        const user = await authModel.findOne({
          stripeCustomerId: invoice.customer,
        });

        if (!user) break;

        user.subscription.status = "past_due";
        user.locked = true;
        await user.save();

        console.log("⚠️ Payment failed, account locked:", user.email);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        const user = await authModel.findOne({
          stripeCustomerId: subscription.customer,
        });

        if (!user) break;

        user.subscription = {
          id: null,
          status: "canceled",
          plan: "free",
        };

        user.locked = false;
        await user.save();

        console.log("🔁 Subscription canceled:", user.email);
        break;
      }

      default:
        console.log("Unhandled Stripe event:", event.type);
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: err.message });
  }
};
