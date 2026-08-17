import express from 'express';
import {
  getAdminPlatformDashboard,
  getPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getStripeConfig,
  updateStripeConfig,
  getAdminPlatformUsers,
  updateUserPlanByAdmin,
  toggleUserLockByAdmin,
  getAdminOrganizations,
  updateOrganizationPlanByAdmin,
  deleteOrganizationByAdmin,
  getAuditLogs,
  getAdminLeads,
  getAdminLeadThread,
} from '../controller/adminPlatform.js';
import { adminMiddleware } from '../middleware/authmiddleware.js';

export const adminPlatformRouter = express.Router();

// Protect ALL SaaS Owner / Platform Admin routes with adminMiddleware
adminPlatformRouter.use(adminMiddleware);

// Dashboard Metrics
adminPlatformRouter.get('/dashboard', getAdminPlatformDashboard);
adminPlatformRouter.get('/master-dashboard', getAdminPlatformDashboard);

// Plan Management
adminPlatformRouter.get('/plans', getPlans);
adminPlatformRouter.post('/plans', createPlan);
adminPlatformRouter.put('/plans/:id', updatePlan);
adminPlatformRouter.delete('/plans/:id', deletePlan);

// Stripe Configuration
adminPlatformRouter.get('/stripe-config', getStripeConfig);
adminPlatformRouter.put('/stripe-config', updateStripeConfig);

// User & Organization Management
adminPlatformRouter.get('/users', getAdminPlatformUsers);
adminPlatformRouter.get('/platform-users', getAdminPlatformUsers);
adminPlatformRouter.put('/users/:id/plan', updateUserPlanByAdmin);
adminPlatformRouter.put('/users/:id/lock', toggleUserLockByAdmin);
adminPlatformRouter.get('/organizations', getAdminOrganizations);
adminPlatformRouter.put('/organizations/plan', updateOrganizationPlanByAdmin);
adminPlatformRouter.delete('/organizations', deleteOrganizationByAdmin);
adminPlatformRouter.delete('/organizations/:name', deleteOrganizationByAdmin);

// Platform Leads & Thread Reports
adminPlatformRouter.get('/leads', getAdminLeads);
adminPlatformRouter.get('/leads/thread/:id', getAdminLeadThread);

// Audit Logging
adminPlatformRouter.get('/audit-logs', getAuditLogs);
