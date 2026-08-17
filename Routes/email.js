import express from 'express';
import {
  addLeadDiscussion,
  clearAllEmailsAndConnections,
  deleteAllConnections,
  deleteConnectionById,
  deleteMultipleLeads,
  deleteSingleLead,
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
  updateLeadStatus,
  validateTestEmail,
  verifyConnection,
} from '../controller/smtpServer.js';
import multer from 'multer';
import { authMiddleware } from '../middleware/authmiddleware.js';
import { uploadAttachmentsMulter } from '../middleware/cloudinary.js';

const upload = multer({
  limits: {
    fileSize: 15 * 1024 * 1024,
    fieldSize: 10 * 1024 * 1024,
  },
});
const emailRouter = express.Router();

// --- Public Webhook ---
emailRouter.post(
  "/",
  (req, res, next) => {
    const type = req.headers["content-type"] || "";
    if (type.includes("multipart/form-data")) {
      return upload.any()(req, res, next);    
    }
    return express.text({ type: "*/*", limit: "10mb" })(req, res, next); 
  },
  mailHookWebhook
);

// --- Authenticated User Endpoints ---
emailRouter.get('/getAllEmails/:userId', authMiddleware, getEmailsForUsers);
emailRouter.get('/getAllEmailsData/:userId', authMiddleware, getEmailDataforUser);
emailRouter.post('/Run-test-mode/', authMiddleware, RunTestMode);
emailRouter.get('/get-test-email/:userId', authMiddleware, getTestEmail);
emailRouter.delete('/delete', authMiddleware, deleteAllConnections);
emailRouter.delete('/clear-all-data', authMiddleware, clearAllEmailsAndConnections);
emailRouter.get('/verification/:userId', authMiddleware, getLatestVerificationEmail);
emailRouter.post('/validate-forwarding/:userId', authMiddleware, validateTestEmail);
emailRouter.get('/validateTest/:userId/', authMiddleware, getValidateEmail);
emailRouter.get('/get-test-data/:userId', authMiddleware, getTestEmailData);
emailRouter.delete('/deleteConnection/:id', authMiddleware, deleteConnectionById);
emailRouter.post('/sendTestEmail', authMiddleware, sendTestEmail);
emailRouter.post("/verify", authMiddleware, verifyConnection);
emailRouter.get("/:id", authMiddleware, getConnectionById);
emailRouter.post("/test/custom", authMiddleware, RunCustomTestMode);

emailRouter.post(
  '/send-thread-reply/:emailId',
  authMiddleware,
  uploadAttachmentsMulter.array('attachments', 10),
  addLeadDiscussion
);
emailRouter.post('/leads/delete-many', authMiddleware, deleteMultipleLeads);
emailRouter.patch('/lead-status/:emailId', authMiddleware, updateLeadStatus);
emailRouter.put('/lead-status/:emailId', authMiddleware, updateLeadStatus);

export default emailRouter;
