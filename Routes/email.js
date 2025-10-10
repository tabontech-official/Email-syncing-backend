import express from "express";
import { getEmailDataforUser, getEmails, getEmailsForUsers, getTestEmail, mailHookWebhook, RunTestMode } from "../controller/smtpServer.js";
import multer from "multer";

const upload = multer();
const emailRouter = express.Router();

emailRouter.post("/", upload.none(), mailHookWebhook);
emailRouter.get('/getAllEmails/:userId',getEmailsForUsers)
emailRouter.get('/getAllEmailsData/:userId',getEmailDataforUser)
emailRouter.post("/Run-test-mode/", RunTestMode);
emailRouter.get('/get-test-email/:userId',getTestEmail)

export default emailRouter;
