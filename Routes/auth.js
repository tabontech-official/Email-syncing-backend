import express from 'express';
import {
  addSmtpConnection,
  completeSetup,
  createOrganization,
  forgotPassword,
  getAllConnections,
  getAllUsers,
  getConnections,
  getEmailTrackingForAdmin,
  getOrganizationByUserId,
  getSetupProgress,
  getSummaryForAdmin,
  getTemplateUsageForAdmin,
  getUserActivity,
  getUserById,
  googleAuth,
  googleAuthCallback,
  logout,
  outlookOAuthCallback,
  requestLogin,
  setPassword,
  signIn,
  signUp,
  skipAllSteps,
  startOutlookOAuth,
  updateUserAndOrganization,
  verifyLogin,
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
authRouter.put("/updateUserAndOrganization/:id", updateUserAndOrganization);
authRouter.post("/skip-all/:userId", skipAllSteps);
authRouter.post("/forgot-password", forgotPassword);
authRouter.post("/set-password", setPassword)
authRouter.post("/request-login", requestLogin)
authRouter.post("/verify-login/:token", verifyLogin);  // Step 1

// authRouter.get('/sync-emails', getEmail);
// authRouter.post('/pubsub', EmailWebhook);
authRouter.get('/getConnection/:userId', getConnections);
// authRouter.post('/addPlatform', savePlatformForUser);


// Admin Routes ///
authRouter.get("/template-usage",getTemplateUsageForAdmin)

authRouter.get("/summary",getSummaryForAdmin)
authRouter.get("/users", getAllUsers);
authRouter.get("/connections", getAllConnections);
authRouter.get("/user-activity", getUserActivity);
authRouter.get("/email-tracking", getEmailTrackingForAdmin);


export default authRouter;
