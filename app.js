import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import {
  requestLogger,
  markSensitiveBodies,
} from './middleware/requestLogger.js';
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
import { startMicrosoftPollingScheduler } from './middleware/microsoftGraphService.js';
import { generalApiLimiter } from './middleware/rateLimiter.js';
import mcpRouter from './Routes/mcp.js';
import {
  protectedResourceMetadata,
  authorizationServerMetadata,
} from './mcp/oauth.js';

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

/*
 * Tags requests whose BODY carries secrets (webhook payloads, mailbox
 * credentials) as req.sensitiveBody, so any body-logging added later
 * can skip them by default. See requestLogger.js for the rationale.
 */
app.use(markSensitiveBodies);
app.use(requestLogger);
app.use(helmet());
app.use(compression());
/*
|--------------------------------------------------------------------------
| CORS
|--------------------------------------------------------------------------
|
| Was cors() with no options: every origin allowed. The API carries a
| bearer token rather than cookies, so this is not classic CSRF — but it
| does let any website on the internet call this API directly from a
| victim's browser with a token it has obtained, and it removes a useful
| layer of defence for no benefit.
|
| Origins come from CORS_ORIGINS (comma separated). With none configured
| the previous permissive behaviour is kept, so nothing breaks before the
| variable is set — the startup warning says what to do.
*/
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  console.warn(
    '⚠️  CORS_ORIGINS is not set — allowing all origins. Set it to your frontend URL(s), comma separated.'
  );
}

app.use(
  cors({
    origin(origin, callback) {
      /* No Origin header: same-origin, curl, server-to-server, health checks. */
      if (!origin) return callback(null, true);

      if (allowedOrigins.length === 0) return callback(null, true);

      if (allowedOrigins.includes(origin)) return callback(null, true);

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  })
);

app.use('/uploads', express.static('uploads'));

// Apply general API rate limiter to standard resource routes

/*
|--------------------------------------------------------------------------
| DISABLED: marketplace routers (dead code from a previous product)
|--------------------------------------------------------------------------
|
| These routers serve a dropshipping/marketplace app, not Replex Engine.
| The frontend makes ZERO requests to any of them, yet they exposed roughly
| 80 endpoints with no authentication at all — including unauthenticated
| destructive operations:
|
|   DELETE /product/deleteAll   -> listingModel.deleteMany()   (all users)
|   DELETE /order/              -> orderModel.deleteMany()     (all users)
|   DELETE /promo/              -> deletes every promotion
|
| Unmounted rather than deleted, so the code is still in the repo if any of
| it turns out to be needed. Re-enabling any of these requires adding
| authMiddleware and ownership checks first.
*/
// app.use('/product', generalApiLimiter, productRouter);   // disabled: unused + unauthenticated
// app.use('/order', generalApiLimiter, orderRouter);   // disabled: unused + unauthenticated
app.use('/template', generalApiLimiter, templateRouter);
app.use('/scenario', generalApiLimiter, scenarioRouter);
app.use('/organization', generalApiLimiter, organizationUtilitiesRouter);
app.use('/api/connection', generalApiLimiter, connectionRouter);
app.use('/api/company-profile', generalApiLimiter, companyProfileRouter);
app.use('/api/ai-config', generalApiLimiter, aiConfigRouter);

app.use('/auth', authRouter);
app.use('/admin', adminPlatformRouter);

/*
|--------------------------------------------------------------------------
| OAuth discovery for the MCP connector
|--------------------------------------------------------------------------
|
| These live at the ROOT, not under /mcp, because that is where the specs
| say clients look: RFC 9728 and RFC 8414 both define well-known paths on
| the origin. Claude fetches them before it holds any credential, so they
| are unauthenticated and openly readable — they describe endpoints, never
| data.
|
| The path-suffixed variants ("/.well-known/oauth-protected-resource/mcp")
| are what a client derives for a server mounted at /mcp; the bare ones
| are what a client derives for one at the origin. Serving both means
| discovery succeeds whichever rule the client applies.
*/
const discoveryCors = (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
};

app.get('/.well-known/oauth-protected-resource', discoveryCors, protectedResourceMetadata);
app.get('/.well-known/oauth-protected-resource/mcp', discoveryCors, protectedResourceMetadata);
app.get('/.well-known/oauth-authorization-server', discoveryCors, authorizationServerMetadata);
app.get('/.well-known/oauth-authorization-server/mcp', discoveryCors, authorizationServerMetadata);

/* Some clients probe OpenID discovery first; same document answers it. */
app.get('/.well-known/openid-configuration', discoveryCors, authorizationServerMetadata);

/*
 * The MCP connector. Rate limited like every other API surface — an MCP
 * client is driven by a model and can loop, so it needs the same ceiling
 * as anything else.
 */
app.use('/mcp', generalApiLimiter, mcpRouter);
app.use('/team', teamRouter);
app.use('/stripe', stripeRouter);
app.use('/talk', SalesRouter);
// app.use('/product', productRouter);   // disabled: unused + unauthenticated
// app.use('/order', orderRouter);   // disabled: unused + unauthenticated
// app.use('/promo', promoRouter);   // disabled: unused + unauthenticated
// app.use('/consultation', consultationRouter);   // disabled: unused + unauthenticated
app.use('/generateAcessKeys', apiCredentialsRouter);
app.use('/notifications', notificationRouter);
// app.use('/category', categoryRouter);   // disabled: unused + unauthenticated
// app.use('/approval', approvalRouter);   // disabled: unused + unauthenticated
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

    /*
     * Microsoft Graph inbox polling. Unlike the Gmail IMAP listeners this
     * is a scheduled sweep rather than a live connection per mailbox.
     */
    startMicrosoftPollingScheduler();

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
     |------------------------------------------------------------------
     | Exiting is right on a server, and catastrophic in serverless
     |------------------------------------------------------------------
     |
     | On a long-running host, failing fast is correct: a process with no
     | database is useless and should die so the supervisor restarts it.
     |
     | On Vercel there is no supervisor and no separate process. This
     | module is initialised INSIDE the same invocation that is already
     | serving an HTTP request, and initialisation opens Gmail IMAP
     | listeners — long-lived TCP connections that a serverless sandbox
     | frequently refuses. So a single failed mailbox listener called
     | process.exit and took the in-flight response down with it, which
     | the client sees as FUNCTION_INVOCATION_FAILED rather than any
     | error this code chose to return.
     |
     | That is what made cold requests fail intermittently while an
     | immediate retry succeeded — and why adding an MCP connector could
     | not get past registration: that POST is usually the first request
     | to reach a cold instance.
     |
     | In serverless we log and carry on. Anything that genuinely needs
     | the database still surfaces its own error, on the request that
     | needed it, instead of destroying an unrelated one.
     */
    const isServerless = Boolean(
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    );

    if (isServerless) {
      console.error(
        'Continuing despite initialization failure: exiting would abort the request currently being served.'
      );
      return;
    }

    process.exit(1);
  }
};

initializeApplication();

export default app;
