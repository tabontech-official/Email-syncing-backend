import express from "express";
import { getEmails, mailHookWebhook } from "../controller/smtpServer.js";
import multer from "multer";

const upload = multer();
const emailRouter = express.Router();

// Inbound Parse webhook
emailRouter.post("/", upload.none(), mailHookWebhook);

export default emailRouter;
