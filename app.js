import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import morgan from 'morgan';
import authRouter from './Routes/auth.js';
import productRouter from './Routes/product.js';
import orderRouter from './Routes/order.js';
import Connect from './connection/connect.js';
import setupSwagger from './swaggerConfig.js';
import { productSubscriptionExpiration } from './controller/scheduleFunction.js';
import promoRouter from './Routes/promotion.js';
import consultationRouter from './Routes/consultation.js';
import apiCredentialsRouter from './Routes/apiCredentials.js';
import notificationRouter from './Routes/notification.js';
import { financeScheduler } from './controller/financeDateSheduler.js';
import categoryRouter from './Routes/category.js';
import approvalRouter from './Routes/approval.js';
import templateRouter from './Routes/template.js';
import { startSMTPServer } from './controller/smtpServer.js';
import emailRouter from './Routes/email.js';
import scenarioRouter from './Routes/Scenario.js';
import { startDelayWorker } from './controller/delayWorker.js';
import mailhookRouter from './Routes/mailhook.js';
import { mailhookModel } from './Models/MailhookSchema.js';
import stripeRouter from './Routes/stripe.js';
import { stripeWebhook } from './controller/stripe.js';
import SalesRouter from './Routes/talkToSales.js';
import scenarioRunLogRouter from './Routes/scenarioRunLog.js';
import landingPageRouter from './Routes/landingPageRoutes.js';
import scriptRouter from './Routes/scriptRoutes.js';
import productPageRouter from './Routes/productPage.js';
import { gmailWebhook } from './middleware/gmailWebhook.js';
import connectionRouter from './Routes/connection.js';
import companyProfileRouter from './Routes/companyProfileRoutes.js';
import aiConfigRouter from './Routes/aiConfigRoutes.js';
import teamRouter from './Routes/team.js';
import organizationUtilitiesRouter from './Routes/organizationUtilitiesRoutes.js';
import { outlookWebhook } from './middleware/outlookWebhook.js';
import { adminPlatformRouter } from './Routes/adminPlatform.js';
import { authModel } from './Models/auth.js';
import { OrganizationModel } from './Models/Organization.js';
import mongoose from 'mongoose';
import { startAllGmailListeners } from './middleware/gmailImapListener.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';

const app = express();
app.set('trust proxy', 1);
setupSwagger(app);

// ⚠️ STRIPE WEBHOOK — RAW BODY ONLY (EXCLUDED FROM RATE LIMITING & BODY PARSER DEFAULT LIMITS)
app.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json', limit: '2mb' }),
  stripeWebhook
);

// Bounded JSON & URL-encoded request body limits (10MB max)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(morgan('combined'));
app.use(helmet());
app.use(compression());
app.use(cors());

app.use('/uploads', express.static('uploads'));

// Apply general API rate limiter to standard resource routes
app.use('/product', generalApiLimiter, productRouter);
app.use('/order', generalApiLimiter, orderRouter);
app.use('/template', generalApiLimiter, templateRouter);
app.use('/scenario', generalApiLimiter, scenarioRouter);
app.use('/organization', generalApiLimiter, organizationUtilitiesRouter);
app.use('/api/connection', generalApiLimiter, connectionRouter);
app.use('/api/company-profile', generalApiLimiter, companyProfileRouter);
app.use('/api/ai-config', generalApiLimiter, aiConfigRouter);

app.use('/auth', authRouter);
app.use('/admin', adminPlatformRouter);
app.use('/team', teamRouter);
app.use('/stripe', stripeRouter);
app.use('/talk', SalesRouter);
app.use('/product', productRouter);
app.use('/order', orderRouter);
app.use('/promo', promoRouter);
app.use('/consultation', consultationRouter);
app.use('/generateAcessKeys', apiCredentialsRouter);
app.use('/notifications', notificationRouter);
app.use('/category', categoryRouter);
app.use('/approval', approvalRouter);
app.use('/template', templateRouter);
app.use('/mailhook', emailRouter);
app.use('/scenario', scenarioRouter);
app.use('/admin/scripts', scriptRouter);
app.use('/mailhookcard', mailhookRouter);
app.use('/scenario-run-log', scenarioRunLogRouter);
app.use('/api/landing-page', landingPageRouter);
app.use('/api/product-page', productPageRouter);
app.use('/api/connection', connectionRouter);
app.use('/api/company-profile', companyProfileRouter);
app.use('/api/ai-config', aiConfigRouter);
app.use('/organization', organizationUtilitiesRouter);
app.post('/gmail/webhook', gmailWebhook);

// ---------------- TEAM API ENDPOINTS ----------------
app.get('/team/getUserTeams/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    let teamName = "My Team";
    let orgId = "default_team";

    if (mongoose.Types.ObjectId.isValid(userId)) {
      const user = await authModel.findById(userId);
      const org = await OrganizationModel.findOne({ userId });
      if (org) {
        orgId = org._id.toString();
        teamName = org.organizationName || user?.organizationName || user?.companyName || "My Team";
      } else if (user) {
        teamName = user.organizationName || user.companyName || "My Team";
      }
    }

    return res.json({
      success: true,
      data: [{ _id: orgId, name: teamName, creditsUsed: 0, membersCount: 1 }],
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.put(['/team/updateUserTeam/:userId', '/team/update/:id'], async (req, res) => {
  try {
    const userId = req.params.userId || req.params.id;
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: "Team name is required" });
    }

    let targetUserId = userId;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      const userObj = await authModel.findById(userId);
      if (!userObj) {
        const orgObj = await OrganizationModel.findById(userId);
        if (orgObj) targetUserId = orgObj.userId.toString();
      }
    }

    if (targetUserId && mongoose.Types.ObjectId.isValid(targetUserId)) {
      await authModel.findByIdAndUpdate(targetUserId, {
        organizationName: name,
        companyName: name,
      });

      const updatedOrg = await OrganizationModel.findOneAndUpdate(
        { userId: targetUserId },
        { organizationName: name, userId: targetUserId },
        { upsert: true, new: true }
      );

      return res.json({
        success: true,
        data: { _id: updatedOrg._id.toString(), name, creditsUsed: 0, membersCount: 1 },
      });
    }

    return res.json({
      success: true,
      data: { _id: userId || "default_team", name, creditsUsed: 0, membersCount: 1 },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/outlook/webhook', outlookWebhook);

(async () => {
  try {
    const indexes = await mailhookModel.collection.indexes();
    const hasUnique = indexes.find((i) => i.name === 'mailhook_1');
    if (hasUnique) {
      await mailhookModel.collection.dropIndex('mailhook_1');
      console.log('✅ Dropped unique index on mailhook field');
    }
  } catch (err) {
    console.log('No duplicate index to drop or already removed:', err.message);
  }
})();

app.use((req, res, next) => {
  res.setTimeout(300000, () => {
    res.status(504).send('Request timed out');
  });
  next();
});

app.get('/', (req, res) => {
  res.send('API is running...');
});

// Express Error Handling Middleware for Payload Size & Entity Too Large Errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large' || err.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'Payload Too Large: The request payload exceeds the maximum allowed limit of 10MB.',
      message: 'Payload Too Large: The request payload exceeds the maximum allowed limit of 10MB.',
    });
  }
  next(err);
});

const initializeApplication = async () => {
  try {
    console.log('========================================');
    console.log('Starting application services...');
    console.log('========================================');

    /*
     * Database must connect before Gmail listeners
     * are loaded from the Connection collection.
     */
    console.log('Connecting to database...');

    await Connect();

    console.log('Database connected successfully');

    /*
     * Start delayed scenario worker.
     */
    console.log('Starting delay worker...');

    startDelayWorker();

    console.log('Delay worker started');

    /*
     * Start finance scheduler.
     */
    console.log('Starting finance scheduler...');

    financeScheduler.start();

    console.log('Finance scheduler started');

    /*
     * Restore real-time Gmail IMAP listeners
     * for all active Gmail connections.
     */
    console.log('Starting active Gmail listeners...');

    const gmailListenerResults =
      await startAllGmailListeners();

    const successfulListeners =
      gmailListenerResults.filter(
        (result) => result.success
      );

    const failedListeners =
      gmailListenerResults.filter(
        (result) => !result.success
      );

    console.log(
      `Gmail listeners initialized: ${successfulListeners.length} successful, ${failedListeners.length} failed`
    );

    if (failedListeners.length > 0) {
      console.error(
        'Some Gmail listeners failed to start:',
        failedListeners.map((result) => ({
          connectionId:
            result.connectionId,
          email:
            result.email,
          error:
            result.error,
        }))
      );
    }

    console.log('========================================');
    console.log('Application services initialized');
    console.log('========================================');
  } catch (error) {
    console.error(
      'Application initialization failed:',
      {
        name: error?.name,
        code: error?.code,
        message: error?.message,
        stack:
          process.env.NODE_ENV ===
          'development'
            ? error?.stack
            : undefined,
      }
    );

    /*
     * Do not continue when database initialization fails.
     */
    process.exit(1);
  }
};

initializeApplication();

export default app;
