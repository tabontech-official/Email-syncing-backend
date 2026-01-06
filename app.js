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
const app = express();
setupSwagger(app);
Connect();

startDelayWorker()
financeScheduler.start();
// ⚠️ STRIPE WEBHOOK — RAW BODY ONLY
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhook
);
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(morgan('combined'));
app.use(helmet());
app.use(compression());
app.use(cors());

app.use('/uploads', express.static('uploads'));
app.use(express.json({limit:"5000000mb"}));
app.use('/auth', authRouter);
app.use('/stripe', stripeRouter);

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
app.use('/mailhookcard', mailhookRouter);

(async () => {
  try {
    const indexes = await mailhookModel.collection.indexes();
    const hasUnique = indexes.find((i) => i.name === "mailhook_1");
    if (hasUnique) {
      await mailhookModel.collection.dropIndex("mailhook_1");
      console.log("✅ Dropped unique index on mailhook field");
    }
  } catch (err) {
    console.log("No duplicate index to drop or already removed:", err.message);
  }
})();
app.use((req, res, next) => {
  res.setTimeout(300000, () => {  
    res.status(504).send('Request timed out');
  });
  next();
});
app.get('/', (req, res) => {
  res.send('API is running...')
});



export default app;


// {
//   "version": 2,
//   "builds": [{ "src": "app.js", "use": "@vercel/node" }],
//   "routes": [{ "src": "/(.*)", "dest": "/app.js" }]
// }
