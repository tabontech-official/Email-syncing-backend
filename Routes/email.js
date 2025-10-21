import express from "express";
import { deleteAllConnections, getEmailDataforUser, getEmails, getEmailsForUsers, getLatestVerificationEmail, getTestEmail, getValidateEmail, mailHookWebhook, RunTestMode, validateTestEmail } from "../controller/smtpServer.js";
import multer from "multer";

const upload = multer();
const emailRouter = express.Router();

emailRouter.post("/", upload.none(), mailHookWebhook);
emailRouter.get('/getAllEmails/:userId',getEmailsForUsers)
emailRouter.get('/getAllEmailsData/:userId',getEmailDataforUser)
emailRouter.post("/Run-test-mode/", RunTestMode);
emailRouter.get('/get-test-email/:userId',getTestEmail)
emailRouter.delete("/delete",deleteAllConnections)
emailRouter.get("/verification/:userId", getLatestVerificationEmail);
emailRouter.post("/validate-forwarding/:userId", validateTestEmail);
emailRouter.get("/validateTest/:userId", getValidateEmail);

export default emailRouter;
