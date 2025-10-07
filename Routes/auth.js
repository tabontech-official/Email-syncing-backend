import express from 'express';
import {
  addSmtpConnection,
  completeSetup,
  getConnections,
  getUserById,
  googleAuth,
  googleAuthCallback,
  logout,
  signIn,
  signUp,
  verifyUser,
} from '../controller/auth.js';

const authRouter = express.Router();

authRouter.post('/signIn', signIn);

authRouter.post('/signUp', signUp);
authRouter.post('/logout/:userId', logout);

authRouter.get('/getUsers/:id', getUserById);
authRouter.patch('/verify/:id', verifyUser);
authRouter.post('/saveSmtpConnection', addSmtpConnection);

authRouter.get('/google', googleAuth);

authRouter.get('/google/callback', googleAuthCallback);
authRouter.put('/setup/:id', completeSetup);
// authRouter.get('/sync-emails', getEmail);
// authRouter.post('/pubsub', EmailWebhook);
authRouter.get('/getConnection/:userId', getConnections);
// authRouter.post('/addPlatform', savePlatformForUser);

export default authRouter;
