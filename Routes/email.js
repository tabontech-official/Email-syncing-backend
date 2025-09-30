import express from "express";
import { getEmails, getEmailsForUsers, mailHookWebhook } from "../controller/smtpServer.js";
import multer from "multer";

const upload = multer();
const emailRouter = express.Router();

// Inbound Parse webhook
emailRouter.post("/", upload.none(), mailHookWebhook);
emailRouter.get('/getAllEmails/:userId',getEmailsForUsers)
export default emailRouter;
