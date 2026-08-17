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
  getDashboardSummary,
} from '../controller/auth.js';
import { cpUpload } from '../middleware/cloudinary.js';
import { authMiddleware, adminMiddleware } from '../middleware/authmiddleware.js';
import { authLimiter, sensitiveAuthLimiter } from '../middleware/rateLimiter.js';
import { addLeadDiscussion, deleteMultipleLeads, deleteSingleLead, updateLeadStatus } from '../controller/smtpServer.js';
import { connectGmailWithAppPassword } from '../controller/gmailAppPasswordController.js';
import { generateAiReplyEndpoint } from '../controller/smtpServer.js';

const authRouter = express.Router();

// --- Public Endpoints ---
authRouter.post('/signIn', authLimiter, signIn);
authRouter.post('/signUp', sensitiveAuthLimiter, signUp);
authRouter.post('/google-login', authLimiter, googleLogin);
authRouter.get('/google', googleAuth);
authRouter.get('/google/callback', googleAuthCallback);
authRouter.get('/outlook', startOutlookOAuth);
authRouter.get('/outlook/callback', outlookOAuthCallback);
authRouter.post('/forgot-password', sensitiveAuthLimiter, forgotPassword);
authRouter.post('/set-password', sensitiveAuthLimiter, setPassword);
authRouter.post('/request-login', sensitiveAuthLimiter, requestLogin);
authRouter.post('/verify-login/:token', sensitiveAuthLimiter, verifyLogin);
authRouter.post("/2fa/verify-login", authLimiter, verifyLoginTwoFactor);
authRouter.post('/organization/accept-invitation', acceptInvitation);

// --- Authenticated User Endpoints ---
authRouter.post('/logout/:userId', authMiddleware, logout);
authRouter.get('/getUsers/:id', authMiddleware, getUserById);
authRouter.patch('/verify/:id', authMiddleware, verifyUser);
authRouter.post('/saveSmtpConnection', authMiddleware, addSmtpConnection);
authRouter.post('/organization/create', authMiddleware, createOrganization);
authRouter.get('/organization/get/:userId', authMiddleware, getOrganizationByUserId);
authRouter.get('/organization/members/:userId', authMiddleware, getOrgMembers);
authRouter.post('/organization/add-member/:userId', authMiddleware, addOrgMember);
authRouter.post("/2fa/setup", authMiddleware, authLimiter, setupTwoFactor);
authRouter.post("/2fa/verify-setup", authMiddleware, authLimiter, verifyTwoFactorSetup);
authRouter.post("/2fa/disable", authMiddleware, authLimiter, disableTwoFactor);
authRouter.put("/change-password", authMiddleware, sensitiveAuthLimiter, updatePassword);
authRouter.post("/gmail/app-password", authMiddleware, connectGmailWithAppPassword);
authRouter.put('/setup/:id', authMiddleware, completeSetup);
authRouter.get('/setup/:id', authMiddleware, getSetupProgress);
authRouter.put('/updateUserAndOrganization/:id', authMiddleware, cpUpload, updateUserAndOrganization);
authRouter.post('/skip-all/:userId', authMiddleware, skipAllSteps);
authRouter.patch('/user/ai', authMiddleware, updateAiStatus);
authRouter.post('/toggle-ai-replies/:userId', authMiddleware, toggleAiReplies);
authRouter.post('/toggle-ai-replies', authMiddleware, toggleAiReplies);
authRouter.post('/generate-ai-reply', authMiddleware, generateAiReplyEndpoint);
authRouter.get('/guide/:userId', authMiddleware, getGuideStatus);
authRouter.post('/guide/:userId', authMiddleware, updateGuideStatus);
authRouter.get('/getConnection/:userId', authMiddleware, getConnections);
authRouter.get('/dashboard-summary/:userId', authMiddleware, getDashboardSummary);

// --- Admin-Only Endpoints ---
authRouter.get('/template-usage', adminMiddleware, getTemplateUsageForAdmin);
authRouter.get('/summary', adminMiddleware, getSummaryForAdmin);
authRouter.get('/users', adminMiddleware, getAllUsers);
authRouter.get('/connections', adminMiddleware, getAllConnections);
authRouter.get('/user-activity', adminMiddleware, getUserActivity);
authRouter.get('/email-tracking', adminMiddleware, getEmailTrackingForAdmin);
authRouter.delete('/user/:id', adminMiddleware, deleteUser);
authRouter.post('/users/bulk-delete', adminMiddleware, bulkDeleteUsers);
authRouter.put('/admin/give-pro/:id', adminMiddleware, giveProPlan);
authRouter.delete('/connection/:id ', adminMiddleware, deleteConnectionByAdmin);
authRouter.put('/connection/:id', adminMiddleware, updateConnectionById);
authRouter.put('/admin/revoke-pro/:id', adminMiddleware, revokeProPlan);
authRouter.post('/admin/login-as/:userId', adminMiddleware, loginAsUserByAdmin);

export default authRouter;
