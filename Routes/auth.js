import express from 'express';
import { getUserById, googleAuth, googleAuthCallback, signIn, signUp, verifyUser } from '../controller/auth.js';

const authRouter = express.Router();

authRouter.post('/signIn', signIn);

authRouter.post('/signUp', signUp);
authRouter.get('/getUsers/:id', getUserById);
authRouter.patch('/verify/:id', verifyUser);


authRouter.get('/google', googleAuth);

authRouter.get('/google/callback', googleAuthCallback);

// authRouter.get('/sync-emails', getEmail);
// authRouter.post('/pubsub', EmailWebhook);
// authRouter.get('/getConnection/:userId', getConnections);
// authRouter.post('/addPlatform', savePlatformForUser);

export default authRouter;
