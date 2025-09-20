import express from 'express';
import { EmailWebhook, getConnections, getEmail,  googleAuth, googleAuthCallback, savePlatformForUser, signIn, signUp } from '../controller/auth.js';


const authRouter = express.Router();

authRouter.post('/signIn', signIn);

authRouter.post('/signUp', signUp);
authRouter.get('/google', googleAuth);

authRouter.get('/google/callback', googleAuthCallback);

authRouter.get('/sync-emails', getEmail); 
authRouter.post('/pubsub', EmailWebhook);
authRouter.get('/getConnection/:userId', getConnections);
authRouter.post('/addPlatform', savePlatformForUser);

export default authRouter;
