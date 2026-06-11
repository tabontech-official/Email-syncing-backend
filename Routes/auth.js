import express from 'express';
import {
  addSmtpConnection,
  bulkDeleteUsers,
  completeSetup,
  createOrganization,
  deleteConnectionByAdmin,
  deleteUser,
  forgotPassword,
  getAllConnections,
  getAllUsers,
  getConnections,
  getEmailTrackingForAdmin,
  getGuideStatus,
  getOrganizationByUserId,
  getSetupProgress,
  getSummaryForAdmin,
  getTemplateUsageForAdmin,
  getUserActivity,
  getUserById,
  giveProPlan,
  googleAuth,
  googleAuthCallback,
  logout,
  outlookOAuthCallback,
  requestLogin,
  revokeProPlan,
  setPassword,
  signIn,
  signUp,
  skipAllSteps,
  startOutlookOAuth,
  updateAiStatus,
  updateGuideStatus,
  updateUserAndOrganization,
  verifyLogin,
  verifyUser,
} from '../controller/auth.js';
import { cpUpload } from '../middleware/cloudinary.js';

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
authRouter.get('/outlook', startOutlookOAuth);
authRouter.get('/outlook/callback', outlookOAuthCallback);
authRouter.put(
  '/updateUserAndOrganization/:id',
  cpUpload,
  updateUserAndOrganization
);
authRouter.post('/skip-all/:userId', skipAllSteps);
authRouter.post('/forgot-password', forgotPassword);
authRouter.post('/set-password', setPassword);
authRouter.post('/request-login', requestLogin);
authRouter.post('/verify-login/:token', verifyLogin); // Step 1
authRouter.patch('/user/ai', updateAiStatus);

authRouter.get('/guide/:userId', getGuideStatus);
authRouter.post('/guide/:userId', updateGuideStatus);
// authRouter.get('/sync-emails', getEmail);
// authRouter.post('/pubsub', EmailWebhook);
authRouter.get('/getConnection/:userId', getConnections);
// authRouter.post('/addPlatform', savePlatformForUser);

// Admin Routes ///
authRouter.get('/template-usage', getTemplateUsageForAdmin);

authRouter.get('/summary', getSummaryForAdmin);
authRouter.get('/users', getAllUsers);
authRouter.get('/connections', getAllConnections);
authRouter.get('/user-activity', getUserActivity);
authRouter.get('/email-tracking', getEmailTrackingForAdmin);
authRouter.delete('/user/:id', deleteUser);
authRouter.post('/users/bulk-delete', bulkDeleteUsers);
authRouter.put('/admin/give-pro/:id', giveProPlan);
authRouter.delete('/connection/:id ', deleteConnectionByAdmin);
authRouter.put(
  '/admin/revoke-pro/:id',

  revokeProPlan
);
export default authRouter;
