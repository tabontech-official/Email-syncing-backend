import { OrganizationModel } from '../Models/Organization.js';
import { isOwnerOrAdmin } from '../middleware/authmiddleware.js';

/* ================== SAVE ORGANIZATION UTILITIES ================== */
export const saveOrganizationUtilities = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot modify organization utilities for another user" });
    }

    const { scenarioProperties, notificationOptions } = req.body;

    let org = await OrganizationModel.findOne({ userId });
    if (!org) {
      org = new OrganizationModel({ userId, organizationName: 'My Organization' });
    }

    if (scenarioProperties) {
      org.scenarioProperties = { ...org.scenarioProperties, ...scenarioProperties };
    }
    if (notificationOptions) {
      org.notificationOptions = { ...org.notificationOptions, ...notificationOptions };
    }

    await org.save();

    return res.json({
      success: true,
      message: 'Organization utility settings saved successfully!',
      data: {
        scenarioProperties: org.scenarioProperties,
        notificationOptions: org.notificationOptions,
      },
    });
  } catch (err) {
    console.error('Error saving organization utilities:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== GET ORGANIZATION UTILITIES ================== */
export const getOrganizationUtilities = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot access organization utilities for another user" });
    }

    const org = await OrganizationModel.findOne({ userId });
    return res.json({
      success: true,
      data: {
        scenarioProperties: org?.scenarioProperties || {
          maxRetries: 3,
          delayTimeoutMinutes: 5,
          autoAiFallback: true,
          logLevel: 'Detailed',
          deduplicateIncomingEmails: true,
        },
        notificationOptions: org?.notificationOptions || {
          emailOnNewLead: true,
          emailOnCustomerReply: true,
          desktopPushAlerts: true,
          soundAlerts: false,
          dailySummaryEmail: true,
        },
        paymentMethod: org?.paymentMethod || {
          cardholderName: '',
          last4: '4242',
          brand: 'Visa',
          expMonth: '12',
          expYear: '28',
          billingAddress: '',
          country: 'United States',
          isSaved: false,
        },
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== SAVE PAYMENT METHOD ================== */
export const savePaymentMethod = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot save payment method for another user" });
    }

    const { cardholderName, cardNumber, expMonth, expYear, cvc, billingAddress, country } = req.body;

    let org = await OrganizationModel.findOne({ userId });
    if (!org) {
      org = new OrganizationModel({ userId, organizationName: 'My Organization' });
    }

    const cleanCard = (cardNumber || '').replace(/\s+/g, '');
    const last4 = cleanCard.length >= 4 ? cleanCard.slice(-4) : '4242';

    // Simple brand detection
    let brand = 'Visa';
    if (cleanCard.startsWith('5') || cleanCard.startsWith('2')) brand = 'MasterCard';
    else if (cleanCard.startsWith('3')) brand = 'American Express';
    else if (cleanCard.startsWith('6')) brand = 'Discover';

    org.paymentMethod = {
      cardholderName: cardholderName || 'Cardholder',
      last4,
      brand,
      expMonth: expMonth || '12',
      expYear: expYear || '28',
      billingAddress: billingAddress || '',
      country: country || 'United States',
      isSaved: true,
    };

    await org.save();

    return res.json({
      success: true,
      message: 'Payment method saved successfully!',
      data: org.paymentMethod,
    });
  } catch (err) {
    console.error('Error saving payment method:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
};

/* ================== GET PAYMENT METHOD ================== */
export const getPaymentMethod = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ success: false, message: "Forbidden: Cannot access payment method for another user" });
    }

    const org = await OrganizationModel.findOne({ userId });
    return res.json({
      success: true,
      data: org?.paymentMethod || {
        cardholderName: '',
        last4: '4242',
        brand: 'Visa',
        expMonth: '12',
        expYear: '28',
        billingAddress: '',
        country: 'United States',
        isSaved: false,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
