import express from 'express';
import {
  addSmtpConnection,
  completeSetup,
  createOrganization,
  getConnections,
  getOrganizationByUserId,
  getSetupProgress,
  getUserById,
  googleAuth,
  googleAuthCallback,
  logout,
  outlookOAuthCallback,
  signIn,
  signUp,
  startOutlookOAuth,
  verifyUser,
} from '../controller/auth.js';

const authRouter = express.Router();

authRouter.post('/signIn', signIn);

authRouter.post('/signUp', signUp);
authRouter.post('/logout/:userId', logout);

authRouter.get('/getUsers/:id', getUserById);
authRouter.patch('/verify/:id', verifyUser);
authRouter.post('/saveSmtpConnection', addSmtpConnection);
authRouter.post('/organization/create', createOrganization);
authRouter.get('/organization/get/:userId', getOrganizationByUserId);

authRouter.get('/google', googleAuth);

authRouter.get('/google/callback', googleAuthCallback);
authRouter.put('/setup/:id', completeSetup);
authRouter.get('/setup/:id', getSetupProgress);
authRouter.get("/outlook", startOutlookOAuth);
authRouter.get("/outlook/callback", outlookOAuthCallback);
// authRouter.get('/sync-emails', getEmail);
// authRouter.post('/pubsub', EmailWebhook);
authRouter.get('/getConnection/:userId', getConnections);
// authRouter.post('/addPlatform', savePlatformForUser);

export default authRouter;
