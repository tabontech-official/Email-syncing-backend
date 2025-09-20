import express from 'express';
import { EmailWebhook, getEmail, getEmails, googleAuth, googleAuthCallback, signIn, signUp } from '../controller/auth.js';


const authRouter = express.Router();

authRouter.post('/signIn', signIn);

authRouter.post('/signUp', signUp);
authRouter.get('/google', googleAuth);

// Google Authentication Callback Route
authRouter.get('/google/callback', googleAuthCallback);

// Sync Gmail Emails Route
authRouter.get('/sync-emails', getEmail); // Ensu
authRouter.post('/pubsub', EmailWebhook); // Ensu
authRouter.get('/get', getEmails); // Ensu

export default authRouter;
