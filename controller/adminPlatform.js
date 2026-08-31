import { authModel } from '../Models/auth.js';
import { OrganizationModel } from '../Models/Organization.js';
import { EmailModel } from '../Models/Email.js';
import { PlanModel } from '../Models/Plan.js';
import { StripeConfigModel } from '../Models/StripeConfig.js';
import { AuditLogModel } from '../Models/AuditLog.js';
import { PaymentHistoryModel } from '../Models/PaymentHistory.js';
import { sanitizeUser } from './auth.js';
import { encrypt, decrypt } from '../middleware/encryption.js';
import { ScenarioTriggerConfigModel } from '../Models/ScenarioTriggerConfig.js';
import {
  BUILT_IN_INBOX_RULES,
  BUILT_IN_REPLY_RULES,
  BUILT_IN_SERVICE_ROUTING,
  BUILT_IN_TRIGGERS,
  invalidateTriggerDefaults,
  loadPlatformRules,
} from '../utils/platformScenarioConfig.js';
import { scenarioModel } from '../Models/Scenario.js';
import { PlatformEmailConfigModel } from '../Models/PlatformEmailConfig.js';
import {
  invalidatePlatformMailer,
  loadPlatformEmailSettings,
  verifyPlatformEmail,
} from '../utils/platformMailer.js';

// Helper for recording SaaS Owner / Admin audit logs
export const recordAuditLog = async ({
  adminId,
  adminEmail,
  action,
  targetType,
  targetId = '',
  details = {},
  status = 'SUCCESS',
  req = null,
}) => {
  try {
    const ipAddress = req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '') : '';
    // Strip any sensitive properties from details
    const safeDetails = { ...details };
    delete safeDetails.password;
    delete safeDetails.secretKey;
    delete safeDetails.webhookSecret;
    delete safeDetails.twoFactorSecret;
    delete safeDetails.token;

    await AuditLogModel.create({
      adminId,
      adminEmail,
      action,
      targetType,
      targetId,
      details: safeDetails,
      status,
      ipAddress,
    });
  } catch (err) {
    console.error('Failed to create audit log:', err);
  }
};

/* ================== DASHBOARD METRICS ================== */
export const getAdminPlatformDashboard = async (req, res) => {
  try {
    const totalUsers = await authModel.countDocuments({});
    const totalOrganizations = await authModel.distinct('organizationName');

    const activeSubscriptions = await authModel.countDocuments({
      'subscription.status': 'active',
      'subscription.plan': { $in: ['Elevate', 'Unite', 'Pro', 'Enterprise'] },
    });

    const trialUsers = await authModel.countDocuments({
      $or: [
        { 'subscription.plan': 'Explore' },
        { subscription: { $exists: false } },
        { 'subscription.plan': { $exists: false } },
      ],
    });

    const proUsers = await authModel.countDocuments({
      'subscription.plan': { $in: ['Elevate', 'Unite', 'Pro', 'Enterprise'] },
    });

    const activePlans = await PlanModel.countDocuments({ active: true });

    // Calculate MRR from active subscription counts
    const elevateCount = await authModel.countDocuments({ 'subscription.plan': 'Elevate', 'subscription.status': 'active' });
    const uniteCount = await authModel.countDocuments({ 'subscription.plan': 'Unite', 'subscription.status': 'active' });
    const mrr = (elevateCount * 9.99) + (uniteCount * 14.99);

    const recentRegistrations = await authModel
      .find({})
      .select('-password -twoFactorSecret -twoFactorTempSecret')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const recentPayments = await PaymentHistoryModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    const failedPayments = await PaymentHistoryModel.countDocuments({ status: 'Failed' });

    return res.status(200).json({
      success: true,
      metrics: {
        totalUsers,
        totalOrganizations: totalOrganizations.length || 1,
        activeSubscriptions,
        trialUsers,
        proUsers,
        mrr: Number(mrr.toFixed(2)),
        activePlans,
        failedPayments,
      },
      recentRegistrations: recentRegistrations.map(sanitizeUser),
      recentPayments,
    });
  } catch (error) {
    console.error('Error fetching admin platform dashboard metrics:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================== PLAN MANAGEMENT ================== */
const DEFAULT_PLANS = [
  {
    name: 'Explore',
    description: 'Free tier for small setups and testing',
    monthlyPrice: 0,
    yearlyPrice: 0,
    currency: 'USD',
    aiRepliesLimit: 50,
    scenariosLimit: 1,
    connectionsLimit: 1,
    teamMembersLimit: 1,
    trialDays: 0,
    features: ['50 AI replies/month', '1 Active Scenario', '1 Email Connection', 'Standard support'],
    active: true,
    public: true,
  },
  {
    name: 'Elevate',
    description: 'Growing businesses needing automation',
    monthlyPrice: 9.99,
    yearlyPrice: 8.50,
    currency: 'USD',
    aiRepliesLimit: 500,
    scenariosLimit: 5,
    connectionsLimit: 3,
    teamMembersLimit: 5,
    trialDays: 14,
    features: ['500 AI replies/month', '5 Active Scenarios', '3 Email Connections', '5 Team Members', 'Priority support'],
    active: true,
    public: true,
  },
  {
    name: 'Unite',
    description: 'High volume lead response automation',
    monthlyPrice: 14.99,
    yearlyPrice: 12.75,
    currency: 'USD',
    aiRepliesLimit: 1000,
    scenariosLimit: 15,
    connectionsLimit: 10,
    teamMembersLimit: 20,
    trialDays: 14,
    features: ['1,000 AI replies/month', '15 Active Scenarios', '10 Email Connections', '20 Team Members', 'Dedicated SLA'],
    active: true,
    public: true,
  },
];

export const getPlans = async (req, res) => {
  try {
    let plans = await PlanModel.find({}).sort({ monthlyPrice: 1 }).lean();

    if (!plans || plans.length === 0) {
      await PlanModel.insertMany(DEFAULT_PLANS);
      plans = await PlanModel.find({}).sort({ monthlyPrice: 1 }).lean();
    }

    return res.status(200).json({ success: true, data: plans });
  } catch (error) {
    console.error('Error fetching plans:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPlan = async (req, res) => {
  try {
    const planData = req.body;
    if (!planData.name) {
      return res.status(400).json({ success: false, message: 'Plan name is required' });
    }

    const existing = await PlanModel.findOne({ name: planData.name });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A plan with this name already exists' });
    }

    const newPlan = await PlanModel.create(planData);

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'CREATE_PLAN',
      targetType: 'PLAN',
      targetId: newPlan._id.toString(),
      details: { name: newPlan.name, monthlyPrice: newPlan.monthlyPrice },
      req,
    });

    return res.status(201).json({ success: true, data: newPlan, message: 'Plan created successfully' });
  } catch (error) {
    console.error('Error creating plan:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await PlanModel.findByIdAndUpdate(id, req.body, { new: true });
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'UPDATE_PLAN',
      targetType: 'PLAN',
      targetId: id,
      details: { name: plan.name, monthlyPrice: plan.monthlyPrice, active: plan.active },
      req,
    });

    return res.status(200).json({ success: true, data: plan, message: 'Plan updated successfully' });
  } catch (error) {
    console.error('Error updating plan:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await PlanModel.findByIdAndDelete(id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'DELETE_PLAN',
      targetType: 'PLAN',
      targetId: id,
      details: { name: plan.name },
      req,
    });

    return res.status(200).json({ success: true, message: 'Plan deleted successfully' });
  } catch (error) {
    console.error('Error deleting plan:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================== STRIPE CONFIGURATION ================== */
const maskSecret = (secret) => {
  if (!secret || secret.length < 8) return '••••••••••••';
  const prefix = secret.slice(0, 7);
  const suffix = secret.slice(-4);
  return `${prefix}••••••••${suffix}`;
};

export const getStripeConfig = async (req, res) => {
  try {
    let config = await StripeConfigModel.findOne({}).lean();
    if (!config) {
      config = {
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
        mode: 'test',
        isConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
      };
    }

    let maskedSecretKey = 'sk_test_••••••••';
    let maskedWebhookSecret = 'whsec_••••••••';

    if (config.secretKeyEncrypted) {
      try {
        const decrypted = decrypt(config.secretKeyEncrypted);
        maskedSecretKey = maskSecret(decrypted);
      } catch (e) {
        maskedSecretKey = 'sk_test_••••••••';
      }
    } else if (process.env.STRIPE_SECRET_KEY) {
      maskedSecretKey = maskSecret(process.env.STRIPE_SECRET_KEY);
    }

    if (config.webhookSecretEncrypted) {
      try {
        const decrypted = decrypt(config.webhookSecretEncrypted);
        maskedWebhookSecret = maskSecret(decrypted);
      } catch (e) {
        maskedWebhookSecret = 'whsec_••••••••';
      }
    } else if (process.env.STRIPE_WEBHOOK_SECRET) {
      maskedWebhookSecret = maskSecret(process.env.STRIPE_WEBHOOK_SECRET);
    }

    return res.status(200).json({
      success: true,
      config: {
        publishableKey: config.publishableKey || process.env.STRIPE_PUBLISHABLE_KEY || '',
        secretKeyMasked: maskedSecretKey,
        webhookSecretMasked: maskedWebhookSecret,
        mode: config.mode || 'test',
        isConfigured: Boolean(config.secretKeyEncrypted || process.env.STRIPE_SECRET_KEY),
        updatedAt: config.updatedAt || new Date(),
      },
    });
  } catch (error) {
    console.error('Error fetching Stripe config:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateStripeConfig = async (req, res) => {
  try {
    const { publishableKey, secretKey, webhookSecret, mode } = req.body;

    let config = await StripeConfigModel.findOne({});
    if (!config) {
      config = new StripeConfigModel({});
    }

    if (publishableKey !== undefined) {
      config.publishableKey = publishableKey;
    }
    if (mode !== undefined) {
      config.mode = mode;
    }

    if (secretKey && !secretKey.includes('••••')) {
      config.secretKeyEncrypted = encrypt(secretKey);
    }
    if (webhookSecret && !webhookSecret.includes('••••')) {
      config.webhookSecretEncrypted = encrypt(webhookSecret);
    }

    config.isConfigured = Boolean(config.secretKeyEncrypted || process.env.STRIPE_SECRET_KEY);
    await config.save();

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'UPDATE_STRIPE_CONFIG',
      targetType: 'STRIPE_CONFIG',
      targetId: config._id.toString(),
      details: { mode: config.mode, publishableKey: config.publishableKey },
      req,
    });

    return res.status(200).json({
      success: true,
      message: 'Stripe configuration updated successfully',
    });
  } catch (error) {
    console.error('Error updating Stripe config:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/* ================== USER & ORGANIZATION MANAGEMENT ================== */
export const getAdminPlatformUsers = async (req, res) => {
  try {
    const { search, role, plan, locked } = req.query;
    const filter = {};

    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { organizationName: { $regex: search, $options: 'i' } },
      ];
    }
    if (role) filter.role = role;
    if (plan) filter['subscription.plan'] = plan;
    if (locked !== undefined) filter.locked = locked === 'true';

    const users = await authModel.find(filter).sort({ createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      count: users.length,
      data: users.map(sanitizeUser),
    });
  } catch (error) {
    console.error('Error fetching users for admin platform:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateUserPlanByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { planName, extraAiReplies } = req.body;

    const user = await authModel.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (!user.subscription) {
      user.subscription = { plan: 'Explore', aiRepliesUsed: 0, extraAiReplies: 0, status: 'active' };
    }

    if (planName) {
      user.subscription.plan = planName;
      user.subscription.status = 'active';
    }
    if (extraAiReplies !== undefined) {
      user.subscription.extraAiReplies = Number(extraAiReplies) || 0;
    }

    user.markModified('subscription');
    await user.save();

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'CHANGE_USER_PLAN',
      targetType: 'USER',
      targetId: id,
      details: { targetEmail: user.email, planName, extraAiReplies },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Updated plan for ${user.email} to ${planName}`,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error('Error updating user plan by admin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleUserLockByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await authModel.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.locked = !user.locked;
    await user.save();

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: user.locked ? 'LOCK_USER' : 'UNLOCK_USER',
      targetType: 'USER',
      targetId: id,
      details: { targetEmail: user.email, locked: user.locked },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `User account ${user.locked ? 'locked' : 'unlocked'} successfully`,
      locked: user.locked,
    });
  } catch (error) {
    console.error('Error toggling user lock:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminOrganizations = async (req, res) => {
  try {
    const users = await authModel.find({}).lean();
    const orgMap = {};

    users.forEach((u) => {
      const orgName = u.organizationName || u.companyName || 'Default Organization';
      const isAdminUser = u.role === 'admin';

      if (!orgMap[orgName]) {
        orgMap[orgName] = {
          name: orgName,
          ownerId: u._id.toString(),
          ownerEmail: u.email,
          ownerName: u.fullName || u.email,
          ownerRole: u.role || 'user',
          isAdminOrg: isAdminUser,
          membersCount: 1,
          plan: isAdminUser ? 'Platform Owner' : (u.subscription?.plan || 'Explore'),
          extraAiReplies: u.subscription?.extraAiReplies || 0,
          aiRepliesUsed: u.subscription?.aiRepliesUsed || 0,
          scenariosLimit: u.subscription?.scenariosLimit || (u.subscription?.plan?.toLowerCase() === 'unite' ? 15 : u.subscription?.plan?.toLowerCase() === 'elevate' ? 5 : 1),
          extraScenariosLimit: u.subscription?.extraScenariosLimit || 0,
          country: u.country || u.Region || 'US',
          createdAt: u.createdAt,
        };
      } else {
        orgMap[orgName].membersCount += 1;
        if (u.subscription?.extraAiReplies) {
          orgMap[orgName].extraAiReplies = Math.max(orgMap[orgName].extraAiReplies || 0, u.subscription.extraAiReplies);
        }
        if (u.subscription?.extraScenariosLimit) {
          orgMap[orgName].extraScenariosLimit = Math.max(orgMap[orgName].extraScenariosLimit || 0, u.subscription.extraScenariosLimit);
        }
        if (isAdminUser) {
          orgMap[orgName].isAdminOrg = true;
          orgMap[orgName].ownerRole = 'admin';
        }
      }
    });

    const orgs = Object.values(orgMap);

    return res.status(200).json({
      success: true,
      count: orgs.length,
      data: orgs,
    });
  } catch (error) {
    console.error('Error fetching organizations for admin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateOrganizationPlanByAdmin = async (req, res) => {
  try {
    const { orgName, ownerId, planName, extraAiReplies, extraScenariosLimit, scenariosLimit } = req.body;
    if (!planName) {
      return res.status(400).json({ success: false, message: 'Plan name is required' });
    }

    const query = {};
    if (orgName && orgName !== 'Default Organization') {
      query.$or = [{ organizationName: orgName }, { companyName: orgName }];
      if (ownerId) query.$or.push({ _id: ownerId });
    } else if (ownerId) {
      query._id = ownerId;
    } else {
      return res.status(400).json({ success: false, message: 'Organization name or owner ID is required' });
    }

    const users = await authModel.find(query);
    if (!users || users.length === 0) {
      return res.status(404).json({ success: false, message: 'No users found for this organization' });
    }

    for (const user of users) {
      if (!user.subscription) {
        user.subscription = { plan: 'Explore', aiRepliesUsed: 0, extraAiReplies: 0, status: 'active' };
      }
      user.subscription.plan = planName;
      user.subscription.status = 'active';
      if (extraAiReplies !== undefined) {
        user.subscription.extraAiReplies = Number(extraAiReplies) || 0;
      }
      if (extraScenariosLimit !== undefined) {
        user.subscription.extraScenariosLimit = Number(extraScenariosLimit) || 0;
      }
      if (scenariosLimit !== undefined) {
        user.subscription.scenariosLimit = Number(scenariosLimit) || 1;
      }
      user.markModified('subscription');
      await user.save();
    }

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'CHANGE_ORGANIZATION_PLAN',
      targetType: 'ORGANIZATION',
      targetId: orgName || ownerId,
      details: { orgName, planName, usersUpdated: users.length },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Updated plan for '${orgName || 'Organization'}' to ${planName}`,
      usersUpdated: users.length,
    });
  } catch (error) {
    console.error('Error updating organization plan by admin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteOrganizationByAdmin = async (req, res) => {
  try {
    const { orgName, ownerId, deleteUsers } = req.body;
    if (!orgName && !ownerId) {
      return res.status(400).json({ success: false, message: 'Organization name or owner ID is required' });
    }

    // 🛡️ Guard: Admin / SaaS Owner account organization cannot be deleted
    const checkQuery = {};
    if (orgName && orgName !== 'Default Organization') {
      checkQuery.$or = [{ organizationName: orgName }, { companyName: orgName }];
      if (ownerId) checkQuery.$or.push({ _id: ownerId });
    } else if (ownerId) {
      checkQuery._id = ownerId;
    }

    const orgUsers = await authModel.find(checkQuery).lean();
    const hasAdmin = orgUsers.some((u) => u.role === 'admin');
    if (hasAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Protected: Admin / SaaS Owner organization cannot be deleted.',
      });
    }

    // Delete OrganizationModel document if exists
    if (orgName) {
      await OrganizationModel.deleteMany({
        $or: [{ organizationName: orgName }, ...(ownerId ? [{ userId: ownerId }] : [])],
      });
    }

    if (deleteUsers) {
      const deleteQuery = orgName ? { $or: [{ organizationName: orgName }, { companyName: orgName }] } : { _id: ownerId };
      await authModel.deleteMany(deleteQuery);
    } else {
      const updateQuery = orgName ? { $or: [{ organizationName: orgName }, { companyName: orgName }] } : { _id: ownerId };
      await authModel.updateMany(updateQuery, {
        $set: { organizationName: 'My Organization', companyName: 'My Organization' },
      });
    }

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'DELETE_ORGANIZATION',
      targetType: 'ORGANIZATION',
      targetId: orgName || ownerId,
      details: { orgName, deleteUsers: Boolean(deleteUsers) },
      req,
    });

    return res.status(200).json({
      success: true,
      message: `Organization '${orgName}' deleted successfully`,
    });
  } catch (error) {
    console.error('Error deleting organization by admin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLogModel.find({}).sort({ createdAt: -1 }).limit(100).lean();
    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminLeads = async (req, res) => {
  try {
    const { status, orgName, search } = req.query;

    const query = {};
    if (status && status !== 'all') {
      if (status === 'new_leads' || status === 'new_lead') {
        query.leadStatus = { $in: ['new_lead', 'awaiting'] };
        query.scenarioExecuted = true;
      } else if (status === 'secured' || status === 'secured_leads') {
        query.leadStatus = 'secured';
      } else if (status === 'closed' || status === 'closed_leads') {
        query.leadStatus = 'closed';
      } else {
        query.leadStatus = status;
      }
    }

    const emails = await EmailModel.find(query)
      .populate('userId', 'fullName email organizationName companyName')
      .populate('templateId', 'name')
      .sort({ date: -1, createdAt: -1 })
      .limit(300)
      .lean();

    const leads = emails.map((email) => {
      const user = email.userId || {};
      const org = user.organizationName || user.companyName || 'Default Workspace';
      return {
        _id: email._id,
        threadId: email.threadId || email.providerThreadId || email._id,
        subject: email.subject || 'No Subject',
        senderAddress: email.senderAddress || email.forwardedMeta?.from || 'Unknown',
        senderName: email.senderFirstName
          ? `${email.senderFirstName} ${email.senderLastName || ''}`.trim()
          : (email.senderAddress || 'Unknown'),
        recipientAddress: email.recipientAddress || email.forwardedMeta?.to || 'Unknown',
        leadStatus: email.leadStatus || email.status || 'new_lead',
        direction: email.direction || 'incoming',
        service: email.service || 'Default Service',
        date: email.date || email.createdAt,
        textBody: email.textBody || '',
        htmlBody: email.htmlBody || '',
        organizationName: org,
        userId: user._id,
        userEmail: user.email || 'Unknown',
        userName: user.fullName || user.email || 'Unknown',
        templateName: email.templateId?.name || email.matchedTemplate || 'None',
        attachmentsCount: email.attachments?.length || 0,
        discussionCount: email.discussion?.length || 0,
      };
    });

    const filteredLeads = search
      ? leads.filter(
          (l) =>
            l.subject?.toLowerCase().includes(search.toLowerCase()) ||
            l.senderAddress?.toLowerCase().includes(search.toLowerCase()) ||
            l.organizationName?.toLowerCase().includes(search.toLowerCase()) ||
            l.userEmail?.toLowerCase().includes(search.toLowerCase())
        )
      : leads;

    return res.status(200).json({
      success: true,
      count: filteredLeads.length,
      data: filteredLeads,
    });
  } catch (error) {
    console.error('Error fetching admin leads:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminLeadThread = async (req, res) => {
  try {
    const { id } = req.params;
    const rootEmail = await EmailModel.findById(id)
      .populate('userId', 'fullName email organizationName companyName')
      .populate('templateId', 'name')
      .lean();

    if (!rootEmail) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const threadIdentifier = rootEmail.threadId || rootEmail.providerThreadId;
    let threadEmails = [];

    if (threadIdentifier) {
      threadEmails = await EmailModel.find({
        $or: [
          { threadId: threadIdentifier },
          { providerThreadId: threadIdentifier },
          { parentEmailId: id },
          { _id: id },
        ],
      })
        .populate('userId', 'fullName email organizationName companyName')
        .sort({ date: 1, createdAt: 1 })
        .lean();
    } else {
      threadEmails = await EmailModel.find({
        $or: [
          { _id: id },
          { parentEmailId: id },
          { inReplyTo: rootEmail.messageId },
        ],
      })
        .populate('userId', 'fullName email organizationName companyName')
        .sort({ date: 1, createdAt: 1 })
        .lean();
    }

    if (!threadEmails.some((e) => e._id.toString() === rootEmail._id.toString())) {
      threadEmails.unshift(rootEmail);
    }

    const user = rootEmail.userId || {};
    const org = user.organizationName || user.companyName || 'Default Workspace';

    return res.status(200).json({
      success: true,
      lead: {
        ...rootEmail,
        organizationName: org,
        userName: user.fullName || user.email,
        userEmail: user.email,
      },
      thread: threadEmails,
    });
  } catch (error) {
    console.error('Error fetching lead thread for admin:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/*
|--------------------------------------------------------------------------
| Scenario trigger configuration (SaaS owner)
|--------------------------------------------------------------------------
|
| Every account ships with a built-in Shopify scenario, and the subject
| that identifies a Partner Directory lead used to be hardcoded. These two
| endpoints put it in the owner's hands: change the subject Shopify sends,
| and leads keep flowing without a deploy.
|
| See utils/platformScenarioConfig.js for how the values are consumed and
| cached on the mail path.
*/
export const getScenarioTriggerConfig = async (req, res) => {
  try {
    const config = await ScenarioTriggerConfigModel.findOne({}).lean();

    /*
     * Present the built-ins for any scenario type the owner has not
     * configured, so the page always shows what the platform is actually
     * doing rather than an empty form.
     */
    const configured = new Map(
      (config?.triggers || []).map((t) => [
        String(t.scenarioType || '').toLowerCase(),
        t,
      ])
    );

    const triggers = [...BUILT_IN_TRIGGERS, ...(config?.triggers || [])].reduce(
      (acc, trigger) => {
        const key = String(trigger.scenarioType || '').toLowerCase();
        if (!key || acc.some((t) => t.scenarioType === key)) return acc;

        const source = configured.get(key) || trigger;

        acc.push({
          scenarioType: key,
          label: source.label || trigger.label || '',
          subjectFilter: source.subjectFilter || '',
          matchMode: source.matchMode === 'startsWith' ? 'startsWith' : 'contains',
          enabled: source.enabled !== false,
          isCustomised: configured.has(key),
        });

        return acc;
      },
      []
    );

    return res.status(200).json({
      success: true,
      config: {
        triggers,
        reply: { ...BUILT_IN_REPLY_RULES, ...(config?.reply || {}) },
        inbox: { ...BUILT_IN_INBOX_RULES, ...(config?.inbox || {}) },
        services: config?.services?.list?.length
          ? config.services
          : BUILT_IN_SERVICE_ROUTING,
        updatedAt: config?.updatedAt || null,
      },
      /* Shown in the UI so an owner can see what they are diverging from. */
      builtIn: {
        reply: BUILT_IN_REPLY_RULES,
        inbox: BUILT_IN_INBOX_RULES,
        services: BUILT_IN_SERVICE_ROUTING,
      },
    });
  } catch (error) {
    console.error('❌ [getScenarioTriggerConfig] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load scenario trigger configuration',
      error: error.message,
    });
  }
};

export const updateScenarioTriggerConfig = async (req, res) => {
  try {
    const incoming = Array.isArray(req.body?.triggers) ? req.body.triggers : null;

    if (!incoming) {
      return res.status(400).json({
        success: false,
        message: 'triggers must be an array',
      });
    }

    const seen = new Set();
    const triggers = [];

    for (const trigger of incoming) {
      const scenarioType = String(trigger?.scenarioType || '')
        .trim()
        .toLowerCase();

      if (!scenarioType) {
        return res.status(400).json({
          success: false,
          message: 'Every trigger needs a scenario type.',
        });
      }

      if (seen.has(scenarioType)) {
        return res.status(400).json({
          success: false,
          message: `Duplicate trigger for scenario type "${scenarioType}".`,
        });
      }

      const subjectFilter = String(trigger?.subjectFilter || '').trim();
      const enabled = trigger?.enabled !== false;

      /*
       * An enabled trigger with no subject would match every message and
       * turn the Lead Inbox back into a raw mailbox. Disabling it is the
       * supported way to switch a trigger off.
       */
      if (enabled && !subjectFilter) {
        return res.status(400).json({
          success: false,
          message: `"${scenarioType}" is enabled but has no subject filter. Add one, or disable the trigger.`,
        });
      }

      seen.add(scenarioType);

      triggers.push({
        scenarioType,
        label: String(trigger?.label || '').trim(),
        subjectFilter,
        matchMode: trigger?.matchMode === 'startsWith' ? 'startsWith' : 'contains',
        enabled,
      });
    }

    /*
     * Captured before the write so scenarios still carrying the OUTGOING
     * default can be identified below.
     */
    const previousRules = await loadPlatformRules();

    /*
     * Reply and inbox rules are optional in the request: a client editing
     * only the triggers must not silently reset them, so an absent section
     * keeps what is stored.
     */
    const cleanList = (values) =>
      Array.isArray(values)
        ? values.map((v) => String(v || '').trim()).filter(Boolean)
        : null;

    const replyInput = req.body?.reply;
    const inboxInput = req.body?.inbox;

    const update = {
      triggers,
      updatedBy: req.user?._id || null,
    };

    if (replyInput && typeof replyInput === 'object') {
      const prefixes = cleanList(replyInput.subjectPrefixes);

      /*
       * With no prefixes nothing is ever recognised as a reply and every
       * response starts its own thread. Refuse rather than accept a
       * setting that quietly breaks threading.
       */
      if (prefixes && prefixes.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            'At least one reply prefix is required — without one, replies would each start a new thread.',
        });
      }

      const seconds = Number(replyInput.duplicateWindowSeconds);

      if (
        replyInput.duplicateWindowSeconds !== undefined &&
        (!Number.isFinite(seconds) || seconds < 0 || seconds > 600)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Duplicate window must be between 0 and 600 seconds.',
        });
      }

      update.reply = {
        subjectPrefixes:
          prefixes || BUILT_IN_REPLY_RULES.subjectPrefixes,
        stripBracketTags: replyInput.stripBracketTags !== false,
        requireReplyMarkerForSubjectMatch:
          replyInput.requireReplyMarkerForSubjectMatch !== false,
        duplicateWindowSeconds: Number.isFinite(seconds)
          ? seconds
          : BUILT_IN_REPLY_RULES.duplicateWindowSeconds,
      };
    }

    if (inboxInput && typeof inboxInput === 'object') {
      const internalDomains = cleanList(inboxInput.internalDomains);

      /*
       * The internal-domain list decides which side of a conversation is
       * the lead. Emptying it would make our own replies look like new
       * leads and split every thread.
       */
      if (internalDomains && internalDomains.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            'At least one internal domain is required — it identifies your own replies inside a thread.',
        });
      }

      update.inbox = {
        excludedSubjects: cleanList(inboxInput.excludedSubjects) || [],
        excludedSenders: cleanList(inboxInput.excludedSenders) || [],
        internalDomains:
          internalDomains || BUILT_IN_INBOX_RULES.internalDomains,
      };
    }

    const servicesInput = req.body?.services;

    if (servicesInput && typeof servicesInput === 'object') {
      const list = cleanList(servicesInput.list);

      /*
       * An empty list classifies every lead as the fallback, collapsing
       * all routing onto a single template.
       */
      if (list && list.length === 0) {
        return res.status(400).json({
          success: false,
          message:
            'At least one service is required — an empty list routes every lead to the fallback template.',
        });
      }

      const fallback = String(servicesInput.fallback || '').trim();

      if (!fallback) {
        return res.status(400).json({
          success: false,
          message: 'A fallback service is required for leads that name none.',
        });
      }

      /*
       * Templates are looked up by service name, so a fallback outside the
       * list has no template behind it and every unmatched lead would find
       * nothing to send.
       */
      const effectiveList = list || BUILT_IN_SERVICE_ROUTING.list;

      if (
        !effectiveList.some(
          (service) => service.toLowerCase() === fallback.toLowerCase()
        )
      ) {
        return res.status(400).json({
          success: false,
          message: `The fallback "${fallback}" must also appear in the service list.`,
        });
      }

      update.services = { list: effectiveList, fallback };
    }

    const config = await ScenarioTriggerConfigModel.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    /* Take effect immediately in this process rather than at TTL expiry. */
    invalidateTriggerDefaults();

    /*
     * Earlier versions of the scenario builder saved the hardcoded subject
     * onto every scenario, and a stored filter takes precedence over the
     * platform default. Those scenarios would ignore this change forever.
     *
     * Clear the stored value on scenarios still holding the exact previous
     * default: an empty filter means "follow the platform trigger", so they
     * pick up this change and every future one. Scenarios whose owner typed
     * something different are left alone — that is a deliberate override.
     */
    let realignedScenarios = 0;

    for (const trigger of triggers) {
      const previousFilter =
        previousRules?.triggers?.[trigger.scenarioType]?.subjectFilter;

      if (!previousFilter || previousFilter === trigger.subjectFilter) continue;

      const result = await scenarioModel.updateMany(
        {
          type: trigger.scenarioType,
          'incomingLead.subjectFilter': previousFilter,
        },
        { $set: { 'incomingLead.subjectFilter': '' } }
      );

      realignedScenarios += result.modifiedCount || 0;
    }

    if (realignedScenarios > 0) {
      console.log(
        `🔁 Realigned ${realignedScenarios} scenario(s) still pinned to the previous trigger subject.`
      );
    }

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'UPDATE_SCENARIO_TRIGGERS',
      targetType: 'SCENARIO_TRIGGER_CONFIG',
      targetId: config?._id?.toString() || '',
      details: {
        realignedScenarios,
        triggers: triggers.map((t) => ({
          scenarioType: t.scenarioType,
          subjectFilter: t.subjectFilter,
          matchMode: t.matchMode,
          enabled: t.enabled,
        })),
        reply: update.reply || 'unchanged',
        inbox: update.inbox || 'unchanged',
        services: update.services
          ? { count: update.services.list.length, fallback: update.services.fallback }
          : 'unchanged',
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message:
        realignedScenarios > 0
          ? `Scenario triggers updated. ${realignedScenarios} scenario(s) realigned to the new subject.`
          : 'Scenario triggers updated.',
      realignedScenarios,
      config: {
        triggers,
        reply: config?.reply || BUILT_IN_REPLY_RULES,
        inbox: config?.inbox || BUILT_IN_INBOX_RULES,
        services: config?.services || BUILT_IN_SERVICE_ROUTING,
        updatedAt: config?.updatedAt || new Date(),
      },
    });
  } catch (error) {
    console.error('❌ [updateScenarioTriggerConfig] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update scenario trigger configuration',
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| Platform email configuration (SaaS owner)
|--------------------------------------------------------------------------
|
| The mailbox Replex Engine sends its own mail from. See
| utils/platformMailer.js for how these values are resolved and cached, and
| for the environment fallback that applies until this is enabled.
*/
const maskAddress = (address = '') => {
  const [local = '', domain = ''] = String(address).split('@');
  if (!local || !domain) return address || '';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
};

export const getPlatformEmailConfig = async (req, res) => {
  try {
    const config = await PlatformEmailConfigModel.findOne({}).lean();

    /*
     * Passwords are never returned — only whether one is stored, so the
     * form can show "leave blank to keep" instead of an empty field that
     * looks like no password is set.
     */
    return res.status(200).json({
      success: true,
      config: {
        enabled: Boolean(config?.enabled),
        fromName: config?.fromName || 'Replex Engine',
        fromEmail: config?.fromEmail || '',
        replyTo: config?.replyTo || '',
        smtp: {
          host: config?.smtp?.host || '',
          port: config?.smtp?.port ?? 587,
          secure: Boolean(config?.smtp?.secure),
          username: config?.smtp?.username || '',
          hasPassword: Boolean(config?.smtp?.passwordEncrypted),
          rejectUnauthorized: config?.smtp?.rejectUnauthorized !== false,
        },
        inbound: {
          protocol: config?.inbound?.protocol || 'none',
          host: config?.inbound?.host || '',
          port: config?.inbound?.port ?? 993,
          secure: config?.inbound?.secure !== false,
          username: config?.inbound?.username || '',
          hasPassword: Boolean(config?.inbound?.passwordEncrypted),
          rejectUnauthorized: config?.inbound?.rejectUnauthorized !== false,
        },
        lastTestedAt: config?.lastTestedAt || null,
        lastTestOk: config?.lastTestOk ?? null,
        lastTestError: config?.lastTestError || '',
        updatedAt: config?.updatedAt || null,
      },
      /*
       * What is in effect right now, so an owner can see whether the
       * platform is running on this config or still on the environment.
       */
      active: {
        source: config?.enabled && config?.smtp?.host ? 'config' : 'env',
        envFrom: maskAddress(process.env.EMAIL_USER || ''),
      },
    });
  } catch (error) {
    console.error('[getPlatformEmailConfig] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to load platform email configuration',
      error: error.message,
    });
  }
};

export const updatePlatformEmailConfig = async (req, res) => {
  try {
    const body = req.body || {};
    const smtp = body.smtp || {};
    const inbound = body.inbound || {};

    const enabled = Boolean(body.enabled);
    const fromEmail = String(body.fromEmail || '').trim();
    const host = String(smtp.host || '').trim();

    const existing = await PlatformEmailConfigModel.findOne({});

    /*
     * Enabling without a complete configuration would send every system
     * mail into a failed transport, so the requirements are checked here
     * rather than discovered by a user who never gets a password reset.
     */
    if (enabled) {
      if (!fromEmail) {
        return res.status(400).json({
          success: false,
          message: 'A from address is required to enable platform email.',
        });
      }

      if (!host) {
        return res.status(400).json({
          success: false,
          message: 'An SMTP host is required to enable platform email.',
        });
      }

      const hasPassword =
        Boolean(smtp.password) || Boolean(existing?.smtp?.passwordEncrypted);

      if (!hasPassword) {
        return res.status(400).json({
          success: false,
          message: 'An SMTP password is required to enable platform email.',
        });
      }
    }

    const port = Number(smtp.port);
    const inboundPort = Number(inbound.port);

    const update = {
      enabled,
      fromName: String(body.fromName || 'Replex Engine').trim(),
      fromEmail,
      replyTo: String(body.replyTo || '').trim(),
      smtp: {
        host,
        port: Number.isFinite(port) && port > 0 ? port : 587,
        secure: Boolean(smtp.secure),
        username: String(smtp.username || '').trim(),
        rejectUnauthorized: smtp.rejectUnauthorized !== false,
        /* Blank keeps the stored password — see the read endpoint. */
        passwordEncrypted: smtp.password
          ? encrypt(String(smtp.password))
          : existing?.smtp?.passwordEncrypted || '',
      },
      inbound: {
        protocol: ['imap', 'pop3'].includes(inbound.protocol)
          ? inbound.protocol
          : 'none',
        host: String(inbound.host || '').trim(),
        port:
          Number.isFinite(inboundPort) && inboundPort > 0 ? inboundPort : 993,
        secure: inbound.secure !== false,
        username: String(inbound.username || '').trim(),
        rejectUnauthorized: inbound.rejectUnauthorized !== false,
        passwordEncrypted: inbound.password
          ? encrypt(String(inbound.password))
          : existing?.inbound?.passwordEncrypted || '',
      },
      updatedBy: req.user?._id || null,
    };

    await PlatformEmailConfigModel.findOneAndUpdate(
      {},
      { $set: update },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    /* Drop the pooled transport built on the old credentials. */
    invalidatePlatformMailer();

    await recordAuditLog({
      adminId: req.user._id,
      adminEmail: req.user.email,
      action: 'UPDATE_PLATFORM_EMAIL',
      targetType: 'PLATFORM_EMAIL_CONFIG',
      details: {
        enabled,
        fromEmail,
        smtpHost: host,
        smtpPort: update.smtp.port,
        smtpSecure: update.smtp.secure,
        inboundProtocol: update.inbound.protocol,
        passwordChanged: Boolean(smtp.password),
      },
      req,
    });

    return res.status(200).json({
      success: true,
      message: enabled
        ? 'Platform email saved and enabled.'
        : 'Platform email saved. It is disabled, so system mail still uses the environment settings.',
    });
  } catch (error) {
    console.error('[updatePlatformEmailConfig] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save platform email configuration',
      error: error.message,
    });
  }
};

/*
 * Verifies the SMTP credentials and optionally sends a test message.
 *
 * Tests what is SAVED, so the result reflects what system mail will
 * actually do — testing unsaved form values could report success for a
 * configuration that is never used.
 */
export const testPlatformEmailConfig = async (req, res) => {
  try {
    const recipient = String(req.body?.to || '').trim();

    const settings = await loadPlatformEmailSettings({ force: true });

    if (!settings.smtp.host || !settings.smtp.username) {
      return res.status(400).json({
        success: false,
        message:
          'No platform email settings to test. Save an SMTP host and password first.',
      });
    }

    const result = await verifyPlatformEmail(settings, recipient);

    await PlatformEmailConfigModel.findOneAndUpdate(
      {},
      {
        $set: {
          lastTestedAt: new Date(),
          lastTestOk: result.ok,
          lastTestError: result.ok
            ? ''
            : String(result.error || '').slice(0, 500),
        },
      },
      { upsert: true }
    );

    return res.status(200).json({
      success: result.ok,
      message: result.ok
        ? recipient
          ? `Connection verified and a test message was sent to ${recipient}.`
          : 'Connection verified.'
        : `Could not connect: ${result.error}`,
      usingSource: settings.source,
    });
  } catch (error) {
    console.error('[testPlatformEmailConfig] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to test platform email configuration',
      error: error.message,
    });
  }
};
