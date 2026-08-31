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
  getThreadMessages,
  validateTestEmail,
  verifyConnection,
} from '../controller/smtpServer.js';
import {
  setLeadArchived,
  processLeadScenario,
} from '../controller/leadActions.js';
import multer from 'multer';
import { authMiddleware, adminMiddleware } from '../middleware/authmiddleware.js';
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
/*
 * PLATFORM-WIDE DESTRUCTIVE OPERATIONS — admin only.
 *
 * Both call deleteMany({}) with no user filter: they wipe every email,
 * connection and automation status belonging to EVERY account. They were
 * behind authMiddleware alone, so any signed-in customer could destroy the
 * whole platform's data with a single request.
 *
 * adminMiddleware is the minimum. Neither is called by the frontend at
 * all — if they are not needed for operations, delete them outright.
 */
emailRouter.delete('/delete', adminMiddleware, deleteAllConnections);
emailRouter.delete('/clear-all-data', adminMiddleware, clearAllEmailsAndConnections);
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

/*
 * Message bodies for one conversation. The list endpoint omits them —
 * see getThreadMessages() for why.
 *
 * Declared above the catch-all GET '/:id' further down, which would
 * otherwise swallow nothing here (two segments), but keeping the lead
 * routes together is clearer.
 */
emailRouter.get('/thread/:rootId', authMiddleware, getThreadMessages);

/*
 * Inbox context-menu actions. Archiving is a flag of its own rather than
 * a lead status — see Models/Email.js — and processing runs the lead's
 * own scenario against it on demand.
 */
emailRouter.patch('/lead-archive/:emailId', authMiddleware, setLeadArchived);
emailRouter.post(
  '/lead-process-scenario/:emailId',
  authMiddleware,
  processLeadScenario
);
emailRouter.patch('/lead-status/:emailId', authMiddleware, updateLeadStatus);
emailRouter.put('/lead-status/:emailId', authMiddleware, updateLeadStatus);

export default emailRouter;
