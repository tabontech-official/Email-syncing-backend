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
  toggleAiReplies,
  updateAiStatus,
  updateGuideStatus,
  updateUserAndOrganization,
  verifyLogin,
  verifyUser,
  updateConnectionById,
  setupTwoFactor,
  verifyTwoFactorSetup,
  disableTwoFactor,
  verifyLoginTwoFactor,
  googleLogin,
  loginAsUserByAdmin,
  updatePassword,
  getOrgMembers,
  addOrgMember,
  acceptInvitation,
} from '../controller/auth.js';
import { cpUpload } from '../middleware/cloudinary.js';
import { authMiddleware } from '../middleware/authmiddleware.js';
import { addLeadDiscussion, deleteMultipleLeads, deleteSingleLead, updateLeadStatus } from '../controller/smtpServer.js';
import { connectGmailWithAppPassword } from '../controller/gmailAppPasswordController.js';

const authRouter = express.Router();

authRouter.post('/signIn', signIn);

authRouter.post('/signUp', signUp);
authRouter.post('/logout/:userId', logout);

authRouter.get('/getUsers/:id', getUserById);
authRouter.patch('/verify/:id', verifyUser);
authRouter.post('/saveSmtpConnection', addSmtpConnection);
authRouter.post('/organization/create', createOrganization);
authRouter.get('/organization/get/:userId', getOrganizationByUserId);
authRouter.get('/organization/members/:userId', getOrgMembers);
authRouter.post('/organization/add-member/:userId', addOrgMember);
authRouter.post('/organization/accept-invitation', acceptInvitation);
authRouter.post("/2fa/setup", setupTwoFactor);
authRouter.post("/2fa/verify-setup", verifyTwoFactorSetup);
authRouter.post("/2fa/disable", disableTwoFactor);
authRouter.post("/2fa/verify-login", verifyLoginTwoFactor);
authRouter.put("/change-password", updatePassword);
authRouter.get('/google', googleAuth);
authRouter.post(
  "/gmail/app-password",
  connectGmailWithAppPassword
);

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
authRouter.post('/toggle-ai-replies/:userId', toggleAiReplies);
authRouter.post('/toggle-ai-replies', toggleAiReplies);

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
authRouter.put('/connection/:id', updateConnectionById);
authRouter.put(
  '/admin/revoke-pro/:id',

  revokeProPlan
);
authRouter.post('/google-login', googleLogin);
authRouter.post('/admin/login-as/:userId', authMiddleware,loginAsUserByAdmin);

export default authRouter;
