import express from 'express';
import {
  deleteAllConnections,
  deleteConnectionById,
  getConnectionById,
  getEmailDataforUser,
  getEmails,
  getEmailsForUsers,
  getLatestServiceEmail,
  getLatestVerificationEmail,
  getTestEmail,
  getTestEmailData,
  getValidateEmail,
  mailHookWebhook,
  RunCustomTestMode,
  RunTestMode,
  sendTestEmail,
  updateConnectionById,
  validateTestEmail,
  verifyConnection,
} from '../controller/smtpServer.js';
import multer from 'multer';

const upload = multer();
const emailRouter = express.Router();

emailRouter.post(
  "/",
  (req, res, next) => {
    const type = req.headers["content-type"] || "";
    if (type.includes("multipart/form-data")) {
      return upload.any()(req, res, next);    
    }
    return express.text({ type: "*/*", limit: "50mb" })(req, res, next); 
  },
  mailHookWebhook
);

emailRouter.get('/getAllEmails/:userId', getEmailsForUsers);
emailRouter.get('/getAllEmailsData/:userId', getEmailDataforUser);
emailRouter.post('/Run-test-mode/', RunTestMode);
emailRouter.get('/get-test-email/:userId', getTestEmail);
emailRouter.delete('/delete', deleteAllConnections);
emailRouter.get('/verification/:userId', getLatestVerificationEmail);
emailRouter.post('/validate-forwarding/:userId', validateTestEmail);
emailRouter.get('/validateTest/:userId/', getValidateEmail);
emailRouter.get('/get-test-data/:userId', getTestEmailData);
emailRouter.delete('/deleteConnection/:id', deleteConnectionById);
emailRouter.post('/sendTestEmail', sendTestEmail);
emailRouter.post("/verify", verifyConnection);
emailRouter.get("/:id", getConnectionById);
emailRouter.post("/test/custom", RunCustomTestMode);
emailRouter.get("/email/latest/:userId", getLatestServiceEmail);
emailRouter.put("/connection/:id", updateConnectionById);
export default emailRouter;
