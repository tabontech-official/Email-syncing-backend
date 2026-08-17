import { authModel } from '../Models/auth.js';
import { PlanModel } from '../Models/Plan.js';
import { StripeConfigModel } from '../Models/StripeConfig.js';
import { AuditLogModel } from '../Models/AuditLog.js';
import { PaymentHistoryModel } from '../Models/PaymentHistory.js';
import { sanitizeUser } from './auth.js';
import { encrypt, decrypt } from '../middleware/encryption.js';

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
      if (!orgMap[orgName]) {
        orgMap[orgName] = {
          name: orgName,
          ownerEmail: u.email,
          ownerName: u.fullName || u.email,
          membersCount: 1,
          plan: u.subscription?.plan || 'Explore',
          country: u.country || u.Region || 'US',
          createdAt: u.createdAt,
        };
      } else {
        orgMap[orgName].membersCount += 1;
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
