import { authModel } from '../Models/auth.js';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fetch from 'node-fetch';
import { AuthorizationCode } from 'simple-oauth2';
import geoip from 'geoip-lite';
import fs from 'fs';
import { PubSub } from '@google-cloud/pubsub';
import axios from 'axios';
import { EmailModel } from '../Models/Email.js';
import { ConnectionModel } from '../Models/Connection.js';
import { TemplateModel } from '../Models/Template.js';
import nodemailer from 'nodemailer';
import path from 'path';
import { scenarioModel } from '../Models/Scenario.js';
import { OrganizationModel } from '../Models/Organization.js';
import bcrypt from 'bcrypt';
import { mailhookModel } from '../Models/MailhookSchema.js';
import { sendProPlanActivatedEmail } from '../utils/sendProPlanEmail.js';
import { sendProPlanRevokedEmail } from '../utils/sendProPlanRevokedEmail.js';
import mongoose from 'mongoose';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { encrypt } from '../middleware/encryption.js';

export const defaultServices = [
  'General',
  'Troubleshooting',
  'Theme customization',
  'Store build or redesign',
  'Store migration',
  'Website and marketing content',
  'SEO',
  'Site performance and speed',
  'Custom apps and integrations',
  'Store settings configuration',
  'Product and collection setup',
  'Social media marketing',
  'Product descriptions',
  'Search engine advertising',
  'POS setup and migration',
  'Custom domain setup',
  'Conversion rate optimization',
  'Analytics and tracking',
  'Sales channel setup',
  'Logo and visual branding',
  'Business strategy guidance',
  'Website audit and optimization strategy',
  'Sales tax guidance',
  'Product photography',
  'Email marketing',
  '3D modelling',
  'Banner ads',
  'Video and illustrations',
  'Content marketing',
  'Product sourcing guidance',
];

const welcomeEmailTemplate = (user) => `
  <div style="font-family: Inter, Arial, sans-serif; background:#f9fafb; padding:40px">
    <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
      
      <h2 style="color:#111827;font-size:24px;margin-bottom:16px">
        Welcome to Replex Engine 🚀
      </h2>

      <p style="color:#374151;font-size:15px">
        Hi <strong>${user.fullName || 'there'}</strong>,
      </p>

      <p style="color:#374151;font-size:15px">
        Your Replex Engine account has been successfully created.
        You’re just a few steps away from automating your inbox.
      </p>

      <p style="color:#374151;font-size:15px;margin-top:18px">
        Your unique <strong>Mailhook</strong> is:
      </p>

      <div style="
        background:#f3f4f6;
        padding:14px;
        border-radius:8px;
        font-family:monospace;
        font-size:14px;
        color:#111827;
        border:1px dashed #d1d5db;
        word-break:break-all;
      ">
        ${user.mailhook || 'N/A'}
      </div>

      <p style="margin-top:20px;color:#374151;font-size:15px">
        Use this address to forward your emails and start building powerful
        automation workflows.
      </p>

      <a href="https://replexengine.com"
        style="
          display:inline-block;
          margin-top:22px;
          background:#4F46E5;
          color:#ffffff;
          padding:12px 22px;
          border-radius:8px;
          text-decoration:none;
          font-size:14px;
          font-weight:600;
        ">
        Go to Replex Engine Dashboard
      </a>

      <p style="margin-top:32px;font-size:13px;color:#6b7280">
        — Team Replex Engine
      </p>
    </div>
  </div>
`;

const welcomeEmailText = (user) => `
Hi ${user.fullName || 'there'},

Your Replex Engine account has been successfully created.

Your unique Mailhook is:
${user.mailhook || 'N/A'}

Use this address to forward your emails and start building automation workflows.

Go to Replex Engine Dashboard:
https://replexengine.com

— Team Replex Engine
`;

export const welComeEmail = async ({ to, subject, html, text }) => {
  if (!to) {
    throw new Error('Recipient email is required');
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  return transporter.sendMail({
    from:
      process.env.SMTP_FROM || `"Replex Engine" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    text,
  });
};

export const sendWelcomeEmail = async ({ to, fullName, mailhook }) => {
  const user = {
    fullName,
    mailhook,
  };

  return welComeEmail({
    to,
    subject: 'Welcome to Replex Engine',
    html: welcomeEmailTemplate(user),
    text: welcomeEmailText(user),
  });
};

const createToken = (payLoad) => {
  const token = jwt.sign({ payLoad }, process.env.SECRET_KEY, {
    expiresIn: '1d',
  });
  return token;
};

export const signUp = async (req, res) => {
  try {
    const { fullName, email, password, country, website } = req.body;

    const userExist = await authModel.findOne({ email });
    if (userExist) {
      throw new Error('User already exists with this email');
    }

    // ✅ Controlled + mapped data
    const newUser = new authModel({
      fullName,
      email,
      password,
      country,
      PartnerLink: website || '', // 🔥 mapping fix
    });

    const savedUser = await newUser.save();
    await OrganizationModel.create({
      userId: savedUser._id,

      // basic info
      organizationName: fullName || 'My Organization',
      website: website || '',
      address: '',

      // location
      country: country || 'Unknown',
      Region: 'Unknown',

      // contact
      PartnerLink: website || '',
      phone: '',
      whatsapp: '',

      // defaults
      TimeZone: 'UTC',
    });
    savedUser.mailhook = `${savedUser._id}@mail.replexengine.com`;
    await savedUser.save();

    // --- Default Templates ---
    const templates = [];
    defaultServices.forEach((service) => {
      ['Initial Email', 'First Email', 'Second Email'].forEach(
        (emailName, idx) => {
          templates.push({
            userId: savedUser._id,
            platform: 'shopify',
            service,
            name: `${service} - ${emailName}`,
            type: idx === 0 ? 'initial' : idx === 1 ? 'first' : 'second',
            conditions: [],
            content: `This is the ${emailName.toUpperCase()} template for ${service}. You can edit this content.`,
            active: true,
            locked: service === 'General',
          });
        }
      );
    });

    await TemplateModel.insertMany(templates);

    // --- Default OTHER Templates ---
    const otherTemplates = [];

    ['Initial Email', 'First Email', 'Second Email', 'Third Email'].forEach(
      (emailName, idx) => {
        otherTemplates.push({
          userId: savedUser._id,
          platform: 'other',
          service: 'General',
          name: `General - ${emailName}`,
          type:
            idx === 0
              ? 'initial'
              : idx === 1
                ? 'first'
                : idx === 2
                  ? 'second'
                  : 'third',
          conditions: [],
          content: `This is the ${emailName.toUpperCase()} template for General service. You can edit this content.`,
          active: true,
          locked: true,
        });
      }
    );

    await TemplateModel.insertMany(otherTemplates);

    const defaultScenario = {
      userId: savedUser._id,
      name: 'Shopify Scenario',
      description: '',
      type: 'shopify',
      scenarioActive: false,
      routerBranches: [
        {
          id: Date.now(),
          hasModule: false,
          condition: null,
          modules: [
            {
              id: `${Date.now()}_1`,
              app: {
                name: 'Initial Email',
                color: 'bg-red-500',
                icon: 'Gmail',
              },
              type: 'Send an Email',
              template: 'Initial Email',
              delayValue: 5,
              delayUnit: 'seconds',
              emailType: 'Gmail',
              filter: { conditions: [] },
            },
            // {
            //   id: `${Date.now()}_2`,
            //   app: { name: 'Delay', color: 'bg-blue-500', icon: 'Delay' },
            //   type: 'Delay',
            //   delayValue: 5,
            //   delayUnit: 'seconds',
            //   emailType: 'Delay',
            //   filter: { conditions: [] },
            // },
            // {
            //   id: `${Date.now()}_3`,
            //   app: {
            //     name: 'First Follow-up',
            //     color: 'bg-red-500',
            //     icon: 'Gmail',
            //   },
            //   type: 'Send an Email',
            //   template: 'First Follow-up',
            //   delayValue: 5,
            //   delayUnit: 'seconds',
            //   emailType: 'Gmail',
            //   filter: { conditions: [] },
            // },
            // {
            //   id: `${Date.now()}_4`,
            //   app: { name: 'Delay', color: 'bg-blue-500', icon: 'Delay' },
            //   type: 'Delay',
            //   delayValue: 5,
            //   delayUnit: 'seconds',
            //   emailType: 'Delay',
            //   filter: { conditions: [] },
            // },
            // {
            //   id: `${Date.now()}_5`,
            //   app: {
            //     name: 'Second Follow-up',
            //     color: 'bg-red-500',
            //     icon: 'Gmail',
            //   },
            //   type: 'Send an Email',
            //   template: 'Second Follow-up',
            //   delayValue: 5,
            //   delayUnit: 'seconds',
            //   emailType: 'Gmail',
            //   filter: { conditions: [] },
            // },
          ],
          filter: { conditions: [] },
        },
      ],
    };

    await scenarioModel.create(defaultScenario);

    try {
      await sendWelcomeEmail({
        to: savedUser.email,
        fullName: savedUser.fullName,
        mailhook: savedUser.mailhook,
      });
    } catch (emailError) {
      console.error('Welcome email failed:', emailError.message);
    }
    const token = createToken({ _id: savedUser._id, role: savedUser.role });

    res.send({
      message: 'Successfully registered',
      token,
      data: savedUser,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

// export const signIn = async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     const user = await authModel.findOne({ email });
//     if (!user) {
//       return res.status(404).json({ error: 'User does not exist' });
//     }

//     const isMatch = await user.comparePassword(password);
//     if (!isMatch) {
//       return res.status(400).json({ error: 'Password does not match' });
//     }
//     if (!user.guideStatus?.sidebar) {
//       user.guideStatus = {
//         sidebar: { completed: false, step: 1 },
//         navbar: { completed: false, step: 0 },
//       };
//     }

//     // ✅ Record login timestamp
//     user.lastLogin = new Date();
//     await user.save();

//     const token = createToken({ _id: user._id, role: user.role });

//     res.status(200).json({
//       message: 'Successfully logged in',
//       token,
//       data: user,
//     });
//   } catch (error) {
//     console.error('Error during login:', error);
//     res.status(500).json({ error: error.message });
//   }
// };

export const signIn = async (req, res) => {
  try {
    console.log('=======================================');
    console.log('🔐 [signIn] Login request received');
    console.log('📩 Request body:', {
      email: req.body?.email,
      hasPassword: Boolean(req.body?.password),
    });
    console.log('=======================================');

    const { email, password } = req.body;

    if (!email || !password) {
      console.warn('⚠️ [signIn] Missing email or password');
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    console.log('🔎 [signIn] Searching user by email:', email);

    const user = await authModel.findOne({ email });

    if (!user) {
      console.warn('❌ [signIn] User does not exist:', email);
      return res.status(404).json({
        success: false,
        error: 'User does not exist',
      });
    }

    console.log('✅ [signIn] User found:', {
      userId: user._id,
      email: user.email,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      hasTwoFactorSecret: Boolean(user.twoFactorSecret),
    });

    console.log('🔑 [signIn] Comparing password...');

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      console.warn('❌ [signIn] Password does not match for:', email);
      return res.status(400).json({
        success: false,
        error: 'Password does not match',
      });
    }

    console.log('✅ [signIn] Password matched successfully');

    if (!user.guideStatus?.sidebar) {
      console.log(
        '🧭 [signIn] guideStatus missing. Initializing default guideStatus...'
      );

      user.guideStatus = {
        sidebar: { completed: false, step: 1 },
        navbar: { completed: false, step: 0 },
      };
    } else {
      console.log('✅ [signIn] guideStatus already exists:', user.guideStatus);
    }

    if (user.twoFactorEnabled) {
      console.log(
        '🛡️ [signIn] 2FA is enabled. Login token will NOT be issued yet.'
      );

      await user.save();

      console.log('📤 [signIn] Sending requiresTwoFactor response:', {
        userId: user._id,
        requiresTwoFactor: true,
      });

      return res.status(200).json({
        success: true,
        requiresTwoFactor: true,
        userId: user._id,
        message: 'Two-step authentication code required',
      });
    }

    console.log('🟢 [signIn] 2FA not enabled. Proceeding with normal login...');

    user.lastLogin = new Date();
    await user.save();

    console.log('💾 [signIn] lastLogin updated:', user.lastLogin);

    const token = createToken({ _id: user._id, role: user.role });

    console.log('🎫 [signIn] JWT token created successfully');
    console.log('✅ [signIn] Login completed for:', {
      userId: user._id,
      email: user.email,
      role: user.role,
    });
    console.log('=======================================');

    return res.status(200).json({
      success: true,
      message: 'Successfully logged in',
      token,
      data: user,
    });
  } catch (error) {
    console.error('🔥 [signIn] Error during login:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await authModel.findById(id).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const latestEmail = await EmailModel.findOne({
      userId: id,
      verificationUrl: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .lean();

    const organization = await OrganizationModel.findOne({ userId: id }).lean();

    res.status(200).json({
      message: 'User fetched successfully',
      data: {
        ...user,

        verificationUrl: latestEmail?.verificationUrl || null,
        verificationCode: latestEmail?.verificationCode || null,

        organization: organization || null,
      },
    });
  } catch (error) {
    console.error('❌ Error fetching user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const updateUserAndOrganization = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      // ---------- USER ----------
      fullName,
      email,
      role,
      TimeZone,

      // ---------- ORGANIZATION ----------
      organizationName,
      Region,
      country,
      PartnerLink,
      website,
      address,
      phone,
      whatsapp,
      hourlyRate,
      experienceYears,
      services,
    } = req.body;

    // ---------------- USER ----------------
    const user = await authModel.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    if (fullName !== undefined) user.fullName = fullName;
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (TimeZone !== undefined) user.TimeZone = TimeZone;

    // 🔥 PROFILE IMAGE (Cloudinary via cpUpload)
    let imageUpdated = false;

    if (req.files?.image?.length) {
      user.profileImage = req.files.image[0].path; // Cloudinary URL
      imageUpdated = true;
    } else if (req.files?.images?.length) {
      user.profileImage = req.files.images[0].path;
      imageUpdated = true;
    }

    await user.save();

    // ---------------- ORGANIZATION ----------------
    let organization = await OrganizationModel.findOne({ userId: id });

    if (organization) {
      if (organizationName !== undefined)
        organization.organizationName = organizationName;
      if (Region !== undefined) organization.Region = Region;
      if (country !== undefined) organization.country = country;
      if (TimeZone !== undefined) organization.TimeZone = TimeZone;
      if (PartnerLink !== undefined) organization.PartnerLink = PartnerLink;

      // 🔥 NEWLY ADDED FIELDS
      if (website !== undefined) organization.website = website;
      if (address !== undefined) organization.address = address;
      if (phone !== undefined) organization.phone = phone;
      if (whatsapp !== undefined) organization.whatsapp = whatsapp;

      if (hourlyRate !== undefined)
        organization.hourlyRate = Number(hourlyRate);
      if (experienceYears !== undefined)
        organization.experienceYears = Number(experienceYears);
      if (services !== undefined) organization.services = services;

      await organization.save();
    } else {
      organization = await OrganizationModel.create({
        userId: id,
        organizationName:
          organizationName || user.organizationName || 'My Organization',
        Region: Region || 'US',
        country: country || 'USA',
        TimeZone: TimeZone || 'UTC',
        PartnerLink: PartnerLink || '',

        // 🔥 NEW FIELDS
        website: website || '',
        address: address || '',
        phone: phone || '',
        whatsapp: whatsapp || '',

        hourlyRate: Number(hourlyRate) || 0,
        experienceYears: Number(experienceYears) || 0,
        services: services || '',
      });
    }

    res.status(200).json({
      success: true,
      message: imageUpdated
        ? 'Profile & image updated successfully'
        : 'User and Organization updated successfully',
      imageUpdated,
      data: {
        user,
        organization,
      },
    });
  } catch (error) {
    console.error('❌ Error updating user and organization:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};

export const verifyUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await authModel.findByIdAndUpdate(
      id,
      { isVerified: true },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      message: 'User verified successfully',
      data: user,
    });
  } catch (error) {
    console.error('Error verifying user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const logout = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await authModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // ✅ Record logout timestamp
    user.lastLogout = new Date();
    await user.save();

    // Optional: if you use cookies for auth
    res.clearCookie('token', { path: '/' });

    res.status(200).json({
      message: 'Logout successful',
      userId,
      lastLogout: user.lastLogout,
    });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ error: 'An error occurred during logout' });
  }
};

export const completeSetup = async (req, res) => {
  try {
    const { id } = req.params;
    const { stepCompleted, setupCompleted = false, skipped = false } = req.body;

    const stepTitles = {
      1: 'Start Wizard',
      2: 'Mailhook instruction',
      3: 'Forwarding rules configured',
      4: 'Email Credential activated',
    };

    const user = await authModel.findById(id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });

    if (!user.setup) user.setup = { steps: [] };
    if (!user.setup.steps) user.setup.steps = [];

    if (skipped && stepCompleted === 1) {
      user.setup.steps = Object.entries(stepTitles).map(([num, title]) => ({
        step: Number(num),
        title,
        status: 'skipped',
        updatedAt: new Date(),
      }));

      user.setup.stepCompleted = 4;
      user.setup.skipped = true;
      user.setup.completed = false;
      user.setup.updatedAt = new Date();

      await user.save();
      return res.json({
        success: true,
        message: 'All steps marked as skipped',
        data: user.setup,
      });
    }

    for (let i = 1; i <= stepCompleted; i++) {
      const existing = user.setup.steps.find((s) => s.step === i);
      const isCurrent = i === stepCompleted;

      if (!existing) {
        user.setup.steps.push({
          step: i,
          title: stepTitles[i] || `Step ${i}`,
          status: isCurrent ? (skipped ? 'skipped' : 'completed') : 'completed',
          updatedAt: new Date(),
        });
      } else if (isCurrent) {
        existing.status = skipped ? 'skipped' : 'completed';
        existing.updatedAt = new Date();
      }
    }

    user.setup.stepCompleted = stepCompleted;
    user.setup.completed = setupCompleted;
    user.setup.skipped = skipped;
    user.setup.updatedAt = new Date();

    await user.save();

    res.json({
      success: true,
      message: 'Setup progress updated successfully',
      data: user.setup,
    });
  } catch (err) {
    console.error('Error updating setup:', err);
    res.status(500).json({ success: false, message: 'Failed to update setup' });
  }
};

export const getSetupProgress = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await authModel.findById(id).select('setup email name');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.setup) {
      user.setup = {
        stepCompleted: 0,
        completed: false,
        skipped: false,
        steps: [],
      };
    }

    res.json({
      success: true,
      message: 'Setup progress fetched successfully',
      data: {
        userId: user._id,
        name: user.name,
        email: user.email,
        ...(user.setup.toObject?.() || user.setup),
      },
    });
  } catch (err) {
    console.error('Error fetching setup progress:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch setup progress',
    });
  }
};

// export const createOrganization = async (req, res) => {
//   try {
//     const { organizationName, Region, country, PartnerLink, TimeZone, userId } =
//       req.body;

//     if (!organizationName || !userId) {
//       return res.status(400).json({
//         success: false,
//         message: 'organizationName and userId are required.',
//       });
//     }

//     const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
//     const geo = geoip.lookup(ip);

//     const detectedRegion = Region || geo?.region || 'Unknown';
//     const detectedCountry = country || geo?.country || 'Unknown';
//     const detectedTimeZone =
//       TimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

//     const organization = await OrganizationModel.create({
//       userId,
//       organizationName,
//       Region: detectedRegion,
//       country: detectedCountry,
//       TimeZone: detectedTimeZone,
//       PartnerLink: PartnerLink || '',
//     });

//     res.status(201).json({
//       success: true,
//       message: 'Organization created successfully',
//       data: organization,
//     });
//   } catch (error) {
//     console.error(' createOrganization Error:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Failed to create organization',
//       error: error.message,
//     });
//   }
// };

export const createOrganization = async (req, res) => {
  try {
    const {
      userId,
      organizationName,
      Region,
      region,
      country,
      TimeZone,
      timeZone,
      PartnerLink,
      partnerLink,
    } = req.body;

    if (!organizationName || !userId) {
      return res.status(400).json({
        success: false,
        message: 'organizationName and userId are required.',
      });
    }

    const finalRegion = Region || region || 'US';
    const finalCountry = country || 'USA';
    const finalTimeZone = TimeZone || timeZone || 'UTC';
    const finalPartnerLink = PartnerLink || partnerLink || '';

    const organization = await OrganizationModel.findOneAndUpdate(
      { userId },
      {
        userId,
        organizationName,
        Region: finalRegion,
        country: finalCountry,
        TimeZone: finalTimeZone,
        PartnerLink: finalPartnerLink,
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
      }
    );

    const updatedUser = await authModel.findByIdAndUpdate(
      userId,
      {
        organizationName,
        Region: finalRegion,
        country: finalCountry,
        TimeZone: finalTimeZone,
        PartnerLink: finalPartnerLink,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    return res.status(201).json({
      success: true,
      message: 'Organization created/updated successfully',
      data: {
        organization,
        user: updatedUser,
      },
    });
  } catch (error) {
    console.error('createOrganization Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to create organization',
      error: error.message,
    });
  }
};
export const getOrganizationByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required.',
      });
    }

    const organization = await OrganizationModel.findOne({ userId });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: 'No organization found for this user.',
      });
    }

    res.status(200).json({
      success: true,
      data: organization,
    });
  } catch (error) {
    console.error('getOrganizationByUserId Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch organization.',
      error: error.message,
    });
  }
};

export const getGuideStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await authModel.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const sidebar = user.guideStatus?.sidebar?.completed
      ? { completed: true, step: user.guideStatus.sidebar.step }
      : { completed: false, step: user.guideStatus?.sidebar?.step ?? 1 };

    const navbar = user.guideStatus?.navbar?.completed
      ? { completed: true, step: 0 }
      : { completed: false, step: user.guideStatus?.navbar?.step ?? 1 };

    res.status(200).json({ sidebar, navbar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const updateGuideStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { type, step, completed } = req.body;

    if (!['sidebar', 'navbar'].includes(type)) {
      return res.status(400).json({ error: 'Invalid guide type' });
    }

    const user = await authModel.findById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // 🔒 Already completed → do nothing
    if (user.guideStatus?.[type]?.completed) {
      return res.status(200).json({
        message: 'Guide already completed',
        guide: user.guideStatus[type],
      });
    }

    // Init if missing
    if (!user.guideStatus) {
      user.guideStatus = {
        sidebar: { completed: false, step: 1 },
        navbar: { completed: false, step: 0 },
      };
    }

    if (completed === true) {
      user.guideStatus[type] = {
        completed: true,
        step: 0,
      };
    } else if (typeof step === 'number') {
      user.guideStatus[type].step = step;
    }

    await user.save();

    res.status(200).json({
      message: 'Guide updated',
      guide: user.guideStatus[type],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const skipAllSteps = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await authModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    // Mark all steps as skipped
    const updatedSteps = user.setup.steps.map((step) => ({
      ...step.toObject(),
      status: 'skipped',
      updatedAt: new Date(),
    }));

    user.setup.steps = updatedSteps;
    user.setup.skipped = true;
    user.setup.completed = false;
    user.setup.stepCompleted = 0;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'All steps marked as skipped successfully',
      setup: user.setup,
    });
  } catch (error) {
    console.error('Error skipping setup steps:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
};

// const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;


const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  // 'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  // 'https://mail.google.com/',
];

export const googleAuth = (req, res) => {
  const { userId, redirect } = req.query;

  if (!userId) return res.status(400).send('userId is required');

  // Include redirect in the state
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: JSON.stringify({ userId, redirect }), // ✅ Added redirect info
  });

  res.redirect(authUrl);
};



export const googleAuthCallback = async (req, res) => {
  const { code, state } = req.query;

  console.log('🚀 [STEP 1] OAuth callback hit');
  console.log('📩 Code received:', !!code);
  console.log('📦 State raw:', state);

  let userId, redirectPath;

  // -------------------------------
  // STATE PARSE
  // -------------------------------
  try {
    const parsedState = JSON.parse(state);

    console.log('📦 [STEP 2] Parsed state:', parsedState);

    userId = parsedState.userId;
    redirectPath = parsedState.redirect || 'connection';

    console.log('👤 User ID:', userId);
    console.log('🔁 Redirect path:', redirectPath);
  } catch (err) {
    console.log('❌ [STATE ERROR]', err.message);
    return res.status(400).send('Invalid state parameter');
  }

  try {
    // -------------------------------
    // OAUTH CLIENT INIT
    // -------------------------------
    console.log('🔐 [STEP 3] Creating OAuth client');

    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    console.log('🔐 CLIENT_ID:', CLIENT_ID);
    console.log('🔐 REDIRECT_URI:', REDIRECT_URI);

    // -------------------------------
    // TOKEN EXCHANGE
    // -------------------------------
    console.log('🔄 [STEP 4] Exchanging code for tokens...');

    const { tokens } = await oauth2Client.getToken(code);

    console.log('🎟️ Tokens received:');
    console.log('   access_token:', !!tokens.access_token);
    console.log('   refresh_token:', !!tokens.refresh_token);

    oauth2Client.setCredentials(tokens);

    // -------------------------------
    // PEOPLE API
    // -------------------------------
    console.log('👤 [STEP 5] Fetching Google profile...');

    const peopleApi = google.people({ version: 'v1', auth: oauth2Client });

    const response = await peopleApi.people.get({
      resourceName: 'people/me',
      personFields: 'emailAddresses,names',
    });

    console.log('📨 People API response:', response.data);

    const userEmail = response.data.emailAddresses?.[0]?.value;
    const userName = response.data.names?.[0]?.displayName || '';

    console.log('📧 Email:', userEmail);
    console.log('👤 Name:', userName);

    if (!userEmail) {
      console.log('❌ No email found');
      return res.status(400).send('No email found in Google profile');
    }

    // -------------------------------
    // CONNECTION FIND / CREATE
    // -------------------------------
    console.log('🗄️ [STEP 6] Finding connection');

    let connection = await ConnectionModel.findOne({
      userId,
      email: userEmail,
    });

    if (!connection) {
      console.log('🆕 Creating new connection');

      connection = new ConnectionModel({
        userId,
        provider: 'gmail',
        email: userEmail,
        name: userName,
        // tokens,
        tokens: {
          access_token: tokens.access_token
            ? encrypt(tokens.access_token)
            : null,

          refresh_token: tokens.refresh_token
            ? encrypt(tokens.refresh_token)
            : null,

          expiry_date: tokens.expiry_date,
        },
        status: 'active',
        createdAt: new Date(),
      });
    } else {
      console.log('♻️ Updating existing connection');

      // connection.tokens = tokens;
      connection.tokens = {
        access_token: tokens.access_token
          ? encrypt(tokens.access_token)
          : connection.tokens.access_token,

        refresh_token: tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : connection.tokens.refresh_token,

        expiry_date: tokens.expiry_date,
      };

      connection.status = 'active';
      connection.lastConnected = new Date();
    }

    await connection.save();

    console.log('💾 Connection saved:', connection._id);

    // -------------------------------
    // GMAIL WATCH
    // -------------------------------
    console.log('📡 [STEP 7] Starting Gmail watch');

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const watchResponse = await gmail.users.watch({
      userId: 'me',
      requestBody: {
        topicName: 'projects/replex-engine/topics/gmail-notifications',
        labelIds: ['INBOX'],
      },
    });

    console.log('📡 Watch response FULL:', watchResponse.data);

    connection.gmailWatch = {
      historyId: watchResponse.data.historyId,
      expiration: watchResponse.data.expiration,
    };

    await connection.save();

    console.log('✅ Gmail watch saved');

    // -------------------------------
    // SUCCESS REDIRECT
    // -------------------------------
    console.log('🎉 SUCCESS - Redirecting user');

    return res.redirect(
      `${process.env.FRONTEND_URL}/${redirectPath}?google-auth-success=true&connectionId=${connection._id}`
    );
  } catch (error) {
    console.log('❌ [FATAL ERROR]');
    console.log('Message:', error.message);
    console.log('Full error:', error);

    return res.redirect(
      `${process.env.FRONTEND_URL}/${redirectPath}?status=error`
    );
  }
};

export const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Google token missing' });
    }

    const client = new google.auth.OAuth2(CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const fullName = payload.name || 'Google User';

    let user = await authModel.findOne({ email });

    // Helper to generate token
    const createToken = (payLoad) => {
      return jwt.sign({ payLoad }, process.env.SECRET_KEY, { expiresIn: '1d' });
    };

    if (user) {
      user.lastLogin = new Date();
      await user.save();
      const token = createToken({ _id: user._id, role: user.role });
      return res.status(200).json({
        message: 'Successfully logged in with Google',
        token,
        data: user,
      });
    }

    // --- CREATE NEW USER ---
    user = new authModel({
      fullName,
      email,
      password: await bcrypt.hash(Date.now().toString() + Math.random(), 10), // random password
      country: 'Unknown',
      PartnerLink: '',
      isVerified: true, // automatically verified since it's from Google
    });

    const savedUser = await user.save();

    await OrganizationModel.create({
      userId: savedUser._id,
      organizationName: fullName || 'My Organization',
      website: '',
      address: '',
      country: 'Unknown',
      Region: 'Unknown',
      PartnerLink: '',
      phone: '',
      whatsapp: '',
      TimeZone: 'UTC',
    });

    savedUser.mailhook = `${savedUser._id}@mail.replexengine.com`;
    await savedUser.save();

    // Default Templates
    const templates = [];
    defaultServices.forEach((service) => {
      ['Initial Email', 'First Email', 'Second Email'].forEach(
        (emailName, idx) => {
          templates.push({
            userId: savedUser._id,
            platform: 'shopify',
            service,
            name: `${service} - ${emailName}`,
            type: idx === 0 ? 'initial' : idx === 1 ? 'first' : 'second',
            conditions: [],
            content: `This is the ${emailName.toUpperCase()} template for ${service}. You can edit this content.`,
            active: true,
            locked: service === 'General',
          });
        }
      );
    });
    await TemplateModel.insertMany(templates);

    const otherTemplates = [];
    ['Initial Email', 'First Email', 'Second Email', 'Third Email'].forEach(
      (emailName, idx) => {
        otherTemplates.push({
          userId: savedUser._id,
          platform: 'other',
          service: 'General',
          name: `General - ${emailName}`,
          type:
            idx === 0
              ? 'initial'
              : idx === 1
                ? 'first'
                : idx === 2
                  ? 'second'
                  : 'third',
          conditions: [],
          content: `This is the ${emailName.toUpperCase()} template for General service. You can edit this content.`,
          active: true,
          locked: true,
        });
      }
    );
    await TemplateModel.insertMany(otherTemplates);

    const defaultScenario = {
      userId: savedUser._id,
      name: 'Shopify Scenario',
      description: '',
      type: 'shopify',
      scenarioActive: false,
      routerBranches: [
        {
          id: Date.now(),
          hasModule: false,
          condition: null,
          modules: [
            {
              id: `${Date.now()}_1`,
              app: {
                name: 'Initial Email',
                color: 'bg-red-500',
                icon: 'Gmail',
              },
              type: 'Send an Email',
              template: 'Initial Email',
              delayValue: 5,
              delayUnit: 'seconds',
              emailType: 'Gmail',
              filter: { conditions: [] },
            },
          ],
          filter: { conditions: [] },
        },
      ],
    };
    await scenarioModel.create(defaultScenario);

    try {
      await sendWelcomeEmail({
        to: savedUser.email,
        fullName: savedUser.fullName,
        mailhook: savedUser.mailhook,
      });
    } catch (e) {
      console.log('Welcome email error:', e);
    }

    const token = createToken({ _id: savedUser._id, role: savedUser.role });
    return res.status(200).json({
      message: 'Successfully registered and logged in with Google',
      token,
      data: savedUser,
    });
  } catch (error) {
    console.error('Google login error:', error);
    return res
      .status(500)
      .json({ error: 'Failed to authenticate with Google' });
  }
};

export const getAuthorizedClient = async (connection) => {
  const oAuth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  oAuth2Client.setCredentials({
    refresh_token: connection.tokens.refresh_token,
  });

  await oAuth2Client.getAccessToken(); // naya token banega
  return oAuth2Client;
};

export const sendEmail = async (connection, to, subject, body) => {
  const client = await getAuthorizedClient(connection);
  const gmail = google.gmail({ version: 'v1', auth: client });

  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=utf-8',
    '',
    body,
  ].join('\n');

  const encodedMessage = Buffer.from(message)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encodedMessage },
  });

  console.log('✅ Email sent:', res.data.id);
  return res.data;
};

export const getConnections = async (req, res) => {
  try {
    const { userId } = req.params;
    const connections = await ConnectionModel.find({ userId });
    res.json(connections);
  } catch (err) {
    console.error('❌ Failed to fetch connections:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const setupTwoFactor = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required',
      });
    }

    const user = await authModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const secret = speakeasy.generateSecret({
      name: `Replex Engine (${user.email})`,
      issuer: 'Replex Engine',
    });

    user.twoFactorTempSecret = secret.base32;
    await user.save();

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    return res.status(200).json({
      success: true,
      message: '2FA setup initialized',
      qrCodeUrl,
      manualKey: secret.base32,
    });
  } catch (error) {
    console.error('setupTwoFactor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to setup 2FA',
      error: error.message,
    });
  }
};

export const verifyTwoFactorSetup = async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: 'userId and token are required',
      });
    }

    const user = await authModel.findById(userId);

    if (!user || !user.twoFactorTempSecret) {
      return res.status(404).json({
        success: false,
        message: '2FA setup not found',
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorTempSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid authentication code',
      });
    }

    user.twoFactorSecret = user.twoFactorTempSecret;
    user.twoFactorTempSecret = null;
    user.twoFactorEnabled = true;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Two-step authentication enabled successfully',
      data: {
        twoFactorEnabled: user.twoFactorEnabled,
      },
    });
  } catch (error) {
    console.error('verifyTwoFactorSetup error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify 2FA setup',
      error: error.message,
    });
  }
};

export const disableTwoFactor = async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required',
      });
    }

    const user = await authModel.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({
        success: false,
        message: 'Two-step authentication is already disabled',
      });
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Authentication code is required',
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid authentication code',
      });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = null;
    user.twoFactorTempSecret = null;

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Two-step authentication disabled successfully',
    });
  } catch (error) {
    console.error('disableTwoFactor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to disable 2FA',
      error: error.message,
    });
  }
};

export const verifyLoginTwoFactor = async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message: 'userId and token are required',
      });
    }

    const user = await authModel.findById(userId);

    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({
        success: false,
        message: '2FA is not enabled for this account',
      });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: 'base32',
      token,
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({
        success: false,
        message: 'Invalid authentication code',
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const loginToken = createToken({
      _id: user._id,
      role: user.role,
    });

    return res.status(200).json({
      success: true,
      message: 'Successfully logged in',
      token: loginToken,
      data: user,
    });
  } catch (error) {
    console.error('verifyLoginTwoFactor error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify login 2FA',
      error: error.message,
    });
  }
};

export const updatePassword = async (req, res) => {
  try {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'userId, currentPassword and newPassword are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters',
      });
    }

    const user = await authModel.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    const samePassword = await bcrypt.compare(newPassword, user.password);

    if (samePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot be same as current password',
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    await user.save();

    return res.status(200).json({
      success: true,
      message: 'Password updated successfully',
    });
  } catch (error) {
    console.error('updatePassword error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to update password',
      error: error.message,
    });
  }
};

export const addSmtpConnection = async (req, res) => {
  try {
    const { userId, email, username, password, host, port, name } = req.body;

    if (!userId || !email || !username || !password || !host || !port) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing required fields' });
    }

    const conn = await ConnectionModel.findOneAndUpdate(
      { userId, email },
      {
        userId,
        email,
        name,
        provider: 'smtp',
        smtp: { host, port, username, password },
        status: 'active',
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, connection: conn });
  } catch (err) {
    console.error(' Error saving SMTP connection:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL;






// const FRONTEND_URL = 'http://localhost:3000';

const oauthConfig = {
  client: {
    id: MICROSOFT_CLIENT_ID,
    secret: MICROSOFT_CLIENT_SECRET,
  },
  auth: {
    tokenHost: 'https://login.microsoftonline.com',
    authorizePath: '/common/oauth2/v2.0/authorize',
    tokenPath: '/common/oauth2/v2.0/token',
  },
};

const client = new AuthorizationCode(oauthConfig);

// export const startOutlookOAuth = (req, res) => {
//   const { userId, from } = req.query;
//   if (!userId) return res.status(400).send('Missing userId');

//   const authorizationUri = client.authorizeURL({
//     redirect_uri: MICROSOFT_REDIRECT_URI,
//     scope:
//       'openid profile offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send',
//     state: JSON.stringify({ userId }),
//     prompt: 'consent',
//   });

//   console.log(' Redirecting to Microsoft OAuth:', authorizationUri);
//   res.redirect(authorizationUri);
// };

// export const outlookOAuthCallback = async (req, res) => {
//   const { code, state } = req.query;

//   let userId;
//   try {
//     const parsed = JSON.parse(state);
//     userId = parsed.userId;
//   } catch (err) {
//     return res.status(400).send('Invalid state parameter');
//   }

//   try {
//     const tokenParams = {
//       code,
//       redirect_uri: MICROSOFT_REDIRECT_URI,
//       scope: 'openid profile offline_access Mail.Read Mail.Send Mail.ReadWrite',
//     };

//     const accessToken = await client.getToken(tokenParams);

//     const userInfoRes = await fetch(
//       'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
//       {
//         headers: { Authorization: `Bearer ${accessToken.token.access_token}` },
//       }
//     );
//     const user = await userInfoRes.json();
//     console.log(' Microsoft user info:', user);

//     const userEmail =
//       user.mail || user.userPrincipalName || `${user.id}@unknown.microsoft.com`;
//     const userName = user.displayName || '';

//     if (!userEmail)
//       return res.status(400).send('No email found from Microsoft account');

//     let connection = await ConnectionModel.findOne({
//       userId,
//       email: userEmail,
//     });

//     if (!connection) {
//       connection = new ConnectionModel({
//         userId,
//         provider: 'outlook',
//         email: userEmail,
//         name: userName,
//         tokens: accessToken.token,
//         status: 'active',
//         createdAt: new Date(),
//       });
//     } else {
//       connection.tokens = accessToken.token;
//       connection.status = 'active';
//       connection.lastConnected = new Date();
//     }

//     await connection.save();

//     return res.redirect(
//       `${FRONTEND_URL}/scenarios/shopify?google-auth-success=true&connectionId=${connection._id}`
//     );
//   } catch (err) {
//     console.error(' Outlook OAuth error:', err);
//     res.redirect(`${FRONTEND_URL}/connection?status=error`);
//   }
// };

// export const outlookOAuthCallback = async (req, res) => {
//   const { code, state } = req.query;

//   let userId, from;
//   try {
//     const parsed = JSON.parse(state);
//     userId = parsed.userId;
//     from = parsed.from || "connection"; // default if not provided
//   } catch (err) {
//     return res.status(400).send("Invalid state parameter");
//   }

//   try {
//     const tokenParams = {
//       code,
//       redirect_uri: MICROSOFT_REDIRECT_URI,
//       scope: "openid profile offline_access Mail.Read Mail.Send Mail.ReadWrite",
//     };

//     const accessToken = await client.getToken(tokenParams);

//     const userInfoRes = await fetch(
//       "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
//       {
//         headers: { Authorization: `Bearer ${accessToken.token.access_token}` },
//       }
//     );
//     const user = await userInfoRes.json();
//     console.log(" Microsoft user info:", user);

//     const userEmail =
//       user.mail || user.userPrincipalName || `${user.id}@unknown.microsoft.com`;
//     const userName = user.displayName || "";

//     if (!userEmail)
//       return res.status(400).send("No email found from Microsoft account");

//     let connection = await ConnectionModel.findOne({ userId, email: userEmail });

//     if (!connection) {
//       connection = new ConnectionModel({
//         userId,
//         provider: "outlook",
//         email: userEmail,
//         name: userName,
//         tokens: accessToken.token,
//         status: "active",
//         createdAt: new Date(),
//       });
//     } else {
//       connection.tokens = accessToken.token;
//       connection.status = "active";
//       connection.lastConnected = new Date();
//     }

//     await connection.save();

//     // ✅ Smart Redirect — based on origin
//     let redirectUrl;
//     switch (from) {
//       case "setup":
//         redirectUrl = `${FRONTEND_URL}/setup?outlook-auth-success=true&connectionId=${connection._id}`;
//         break;
//       case "connection":
//         redirectUrl = `${FRONTEND_URL}/connections?outlook-auth-success=true&connectionId=${connection._id}`;
//         break;
//       case "shopify":
//         redirectUrl = `${FRONTEND_URL}/scenarios/shopify?outlook-auth-success=true&connectionId=${connection._id}`;
//         break;
//       default:
//         redirectUrl = `${FRONTEND_URL}/connections?outlook-auth-success=true&connectionId=${connection._id}`;
//     }

//     return res.redirect(redirectUrl);
//   } catch (err) {
//     console.error(" Outlook OAuth error:", err);
//     res.redirect(`${FRONTEND_URL}/connection?status=error`);
//   }
// };

export const startOutlookOAuth = (req, res) => {
  const { userId, redirect } = req.query;
  if (!userId) return res.status(400).send('Missing userId');

  const authorizationUri = client.authorizeURL({
    redirect_uri: MICROSOFT_REDIRECT_URI,
    scope:
      'openid profile offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send',
    state: JSON.stringify({ userId, redirect }),
    prompt: 'consent',
  });

  console.log('🔁 Redirecting to Microsoft OAuth:', authorizationUri);
  res.redirect(authorizationUri);
};


export const outlookOAuthCallback = async (req, res) => {
  const { code, state } = req.query;

  console.log('📩 [OUTLOOK CALLBACK HIT]');
  console.log('🔐 code exists:', !!code);
  console.log('📦 raw state:', state);

  let userId, redirectPath;

  try {
    const parsed = JSON.parse(state);

    console.log('📦 parsed state:', parsed);

    userId = parsed.userId;
    redirectPath = parsed.redirect || 'connection';

    console.log('👤 userId:', userId);
    console.log('🔁 redirectPath:', redirectPath);
  } catch (err) {
    console.log('❌ STATE PARSE ERROR:', err.message);
    return res.status(400).send('Invalid state parameter');
  }

  try {
    console.log('🔄 [STEP 1] Token exchange starting...');
    console.log('🌐 redirect_uri:', MICROSOFT_REDIRECT_URI);

    const tokenParams = {
      code,
      redirect_uri: MICROSOFT_REDIRECT_URI,
      scope:
        'openid profile offline_access Mail.Read Mail.Send Mail.ReadWrite',
    };

    const accessToken = await client.getToken(tokenParams);

    console.log('🎟️ [TOKEN RECEIVED]');
    console.log('access_token exists:', !!accessToken.token.access_token);
    console.log('refresh_token exists:', !!accessToken.token.refresh_token);

    // ---------------- USER INFO ----------------
    console.log('👤 [STEP 2] Fetching Microsoft profile...');

    const userInfoRes = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
      {
        headers: {
          Authorization: `Bearer ${accessToken.token.access_token}`,
        },
      }
    );

    const user = await userInfoRes.json();

    console.log('📨 [PROFILE RESPONSE]:', user);

    const userEmail =
      user.mail || user.userPrincipalName || `${user.id}@unknown.microsoft.com`;

    const userName = user.displayName || '';

    console.log('📧 Email:', userEmail);
    console.log('👤 Name:', userName);

    if (!userEmail) {
      console.log('❌ No email found');
      return res.status(400).send('No email found from Microsoft account');
    }

    // ---------------- DB SAVE ----------------
    console.log('🗄️ [STEP 3] Saving connection...');

    let connection = await ConnectionModel.findOne({
      userId,
      email: userEmail,
    });

    if (!connection) {
      console.log('🆕 Creating new connection');

      connection = new ConnectionModel({
        userId,
        provider: 'outlook',
        email: userEmail,
        name: userName,
        tokens: accessToken.token,
        status: 'active',
        createdAt: new Date(),
      });
    } else {
      console.log('♻️ Updating existing connection');

      connection.tokens = accessToken.token;
      connection.status = 'active';
      connection.lastConnected = new Date();
    }

    await connection.save();

    console.log('💾 Connection saved:', connection._id);

    // ---------------- SUBSCRIPTION ----------------
    console.log('📡 [STEP 4] Creating Outlook subscription...');

    console.log('🌐 BACKEND_URL:', process.env.BACKEND_URL);
    console.log('🔐 CLIENT_STATE:', process.env.MS_CLIENT_STATE);

    const subscriptionRes = await fetch(
      'https://graph.microsoft.com/v1.0/subscriptions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken.token.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          changeType: 'created',
          notificationUrl: `https://blatantly-doorpost-ferry.ngrok-free.dev/outlook/webhook`,
          resource: "me/mailFolders('Inbox')/messages",
          expirationDateTime: new Date(
            Date.now() + 2 * 24 * 60 * 60 * 1000
          ).toISOString(),
          clientState: process.env.MS_CLIENT_STATE,
        }),
      }
    );

    const subscriptionData = await subscriptionRes.json();

    console.log('📡 Subscription response:', subscriptionData);

    if (!subscriptionRes.ok) {
      console.log('❌ SUBSCRIPTION FAILED');
      throw new Error(JSON.stringify(subscriptionData));
    }

    connection.outlookSubscription = {
      id: subscriptionData.id,
      resource: subscriptionData.resource,
      expirationDateTime: subscriptionData.expirationDateTime,
      clientState: subscriptionData.clientState,
    };

    await connection.save();

    console.log('✅ Subscription saved successfully');
    console.log('🆔 Subscription ID:', subscriptionData.id);

    // ---------------- SUCCESS REDIRECT ----------------
    console.log('🎉 SUCCESS - Redirecting user');

    return res.redirect(
      `${FRONTEND_URL}/${redirectPath}?outlook-auth-success=true&connectionId=${connection._id}`
    );
  } catch (err) {
    console.log('❌ [FATAL ERROR]');
    console.log('Message:', err.message);
    console.log('Stack:', err.stack);

    return res.redirect(
      `${FRONTEND_URL}/connection?status=error`
    );
  }
};


export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ success: false, message: 'Email is required.' });

    const user = await authModel.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found.' });

    const token = createToken({ id: user._id });

    const resetUrl = `${FRONTEND_URL}/reset-password/${token}`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const mailOptions = {
      from: `"Replex Engine : Reset your password" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Reset Your Password',
      html: `
        <div style="font-family: Arial; padding: 20px; background: #f9f9f9;">
          <h2>Reset Your Password</h2>
          <p>Hello ${user.name || ''},</p>
          <p>Click the link below to reset your password:</p>
          <a href="${resetUrl}" 
             style="display:inline-block;padding:10px 20px;background:#007bff;
                    color:#fff;text-decoration:none;border-radius:5px;">
            Reset Password
          </a>
          <p>This link will expire in 24 hours.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.json({
      success: true,
      message: 'Password reset link sent to your email!',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: 'Internal server error.',
      error: err.message,
    });
  }
};

export const setPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    console.log('🟢 Incoming setPassword request:', {
      token,
      passwordLength: password?.length,
    });

    if (!token || !password) {
      console.warn('⚠️ Missing token or password in request body.');
      return res
        .status(400)
        .json({ success: false, message: 'Token and password are required.' });
    }

    // 🔹 Verify JWT token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.SECRET_KEY);
      console.log('✅ Token verified successfully:', decoded);
    } catch (err) {
      console.error('❌ Token verification failed:', err.message);
      return res
        .status(400)
        .json({ success: false, message: 'Invalid or expired token.' });
    }

    // 🔹 Extract user ID from token payload
    const userId = decoded?.payLoad?.id;
    if (!userId) {
      console.error('❌ Invalid token payload — userId not found.');
      return res
        .status(400)
        .json({ success: false, message: 'Invalid token payload.' });
    }

    console.log('🔍 Decoded userId:', userId);

    // 🔹 Find user in database
    const user = await authModel.findById(userId);
    if (!user) {
      console.warn('⚠️ No user found for ID:', userId);
      return res
        .status(404)
        .json({ success: false, message: 'User not found.' });
    }

    console.log('👤 User found:', { id: user._id, email: user.email });

    // 🔹 Hash new password
    const hashed = await bcrypt.hash(password, 10);
    console.log('🔐 Password hashed successfully.');

    // 🔹 Update user password
    await authModel.findByIdAndUpdate(userId, { password: hashed });
    console.log('✅ Password updated in database for user:', userId);

    // 🔹 Send response
    res.json({
      success: true,
      message: 'Password updated successfully!',
    });
    console.log('✅ Password reset complete for:', user.email);
  } catch (error) {
    console.error('💥 Internal server error in setPassword:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error.',
      error: error.message,
    });
  }
};

export const requestLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res
        .status(400)
        .json({ success: false, message: 'Email and password required.' });

    const user = await authModel.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res
        .status(401)
        .json({ success: false, message: 'Invalid credentials.' });

    const token = createToken({ id: user._id, type: 'loginVerify' }, '10m');
    const verifyUrl = `http://localhost:3006/login-verify/${token}`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Make Support" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Login Verification',
      html: `
        <div style="font-family: Arial; padding: 20px;">
          <h2>Verify Your Login</h2>
          <p>Hello ${user.name || ''},</p>
          <p>Someone (hopefully you) tried to log into your account.</p>
          <p>Click below to verify your login:</p>
          <a href="${verifyUrl}" 
             style="display:inline-block;background:#4f46e5;color:white;
                    padding:10px 20px;text-decoration:none;border-radius:6px;">
             Verify Login
          </a>
          <p style="margin-top:10px;font-size:13px;color:#666">
            This link will expire in 10 minutes. If it wasn’t you, please ignore this email.
          </p>
        </div>
      `,
    });

    console.log('📧 Login verification email sent to:', user.email);

    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    });
  } catch (err) {
    console.error('❌ Error in requestLogin:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const verifyLogin = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      console.warn('⚠️ Missing token in verification request.');
      return res
        .status(400)
        .json({ success: false, message: 'Token missing.' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.SECRET_KEY);
    } catch (err) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid or expired token.' });
    }

    if (decoded?.payLoad?.type !== 'loginVerify') {
      console.warn(
        '⚠️ Invalid token type received:',
        decoded?.payLoad?.type || '(none)'
      );
      return res
        .status(400)
        .json({ success: false, message: 'Invalid token type.' });
    }

    const userId = decoded?.payLoad?.id;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid token payload.' });
    }

    const user = await authModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found.' });
    }

    console.log('👤 User found:', { id: user._id, email: user.email });

    const loginToken = createToken({ id: user._id }, '1d');
    console.log(
      '🔐 Session token generated successfully for user:',
      user.email
    );
    console.log('📤 Redirecting user to frontend...');

    res.redirect(`http://localhost:3006/login-verify?token=${loginToken}`);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

export const getSummaryForAdmin = async (req, res) => {
  try {
    // 🧠 Get all userIds that have verified mailhooks
    const verifiedMailhookUsersRaw = await mailhookModel.distinct('userId', {
      connectionVerified: true,
    });
    const verifiedMailhookUsers = verifiedMailhookUsersRaw.map((id) =>
      id.toString()
    );

    // Fetch base metrics
    const [
      totalUsers,
      totalEmails,
      activeScenarios,
      totalConnections,
      totalTemplates,
      activeTemplates,
      inactiveTemplates,
      recentUsersRaw,
    ] = await Promise.all([
      authModel.countDocuments(),
      EmailModel.countDocuments(),
      scenarioModel.countDocuments({ scenarioActive: true }),
      ConnectionModel.countDocuments(),
      TemplateModel.countDocuments(),
      TemplateModel.countDocuments({ active: true }),
      TemplateModel.countDocuments({ active: false }),
      authModel.find().sort({ createdAt: -1 }).limit(10).lean(),
    ]);

    // Aggregate template stats for recent users
    const userIds = recentUsersRaw.map((u) => u._id);
    const userTemplates = await TemplateModel.aggregate([
      { $match: { userId: { $in: userIds } } },
      {
        $group: {
          _id: '$userId',
          total: { $sum: 1 },
          active: { $sum: { $cond: ['$active', 1, 0] } },
          inactive: { $sum: { $cond: ['$active', 0, 1] } },
        },
      },
    ]);

    // Convert template data to a lookup map
    const templateStats = {};
    userTemplates.forEach((t) => {
      templateStats[t._id.toString()] = {
        total: t.total,
        active: t.active,
        inactive: t.inactive,
      };
    });

    // 🧩 Attach template counts & verified flag to users
    const recentUsers = recentUsersRaw.map((u) => ({
      ...u,
      verified: verifiedMailhookUsers.includes(u._id.toString()),
      templates: templateStats[u._id.toString()] || {
        total: 0,
        active: 0,
        inactive: 0,
      },
    }));

    // ✅ Return summary
    res.json({
      totalUsers,
      verifiedUsers: verifiedMailhookUsers.length,
      totalEmails,
      activeScenarios,
      totalConnections,
      templates: {
        total: totalTemplates,
        active: activeTemplates,
        inactive: inactiveTemplates,
      },
      recentUsers,
    });
  } catch (err) {
    console.error('Error fetching admin summary:', err);
    res.status(500).json({ message: err.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await authModel
      .find({})
      .sort({ createdAt: -1 })
      .select('fullName email role setup createdAt subscription');

    const verifiedMailhooks = await mailhookModel
      .find({ connectionVerified: true })
      .select('userId')
      .lean();

    const verifiedUserIds = new Set(
      verifiedMailhooks.map((m) => m.userId.toString())
    );

    const formattedUsers = users.map((u) => ({
      ...u.toObject(),
      verified: verifiedUserIds.has(u._id.toString()),
    }));

    res.json({ users: formattedUsers });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ message: err.message });
  }
};

export const getAllConnections = async (req, res) => {
  try {
    const connections = await ConnectionModel.find()
      .populate('userId', 'fullName email role')
      .sort({ createdAt: -1 })
      .lean();

    const formatted = connections.map((c) => ({
      _id: c._id,
      email: c.email,
      provider: c.provider,
      status: c.status,
      verified: c.verified,
      createdAt: c.createdAt,
      user: c.userId || {},
    }));

    res.json({ connections: formatted });
  } catch (err) {
    res
      .status(500)
      .json({ message: 'Error fetching connections', error: err.message });
  }
};

export const getUserActivity = async (req, res) => {
  try {
    const users = await authModel
      .find({})
      .sort({ updatedAt: -1 })
      .select('fullName email role createdAt updatedAt lastLogin lastLogout')
      .lean();

    const [templates, emails, scenarios] = await Promise.all([
      TemplateModel.find().select('_id name userId').lean(),
      EmailModel.find()
        .select('userId templateId createdAt')
        .sort({ createdAt: -1 })
        .lean(),
      scenarioModel.find().select('userId name routerBranches').lean(),
    ]);

    // 🔍 Helper map for quick lookups
    const templateMap = {};
    templates.forEach((t) => {
      templateMap[t._id.toString()] = t;
    });

    const activities = users.map((user) => {
      // Find user’s sent emails
      const userEmails = emails.filter(
        (em) => em.userId?.toString() === user._id.toString()
      );

      const usedTemplateIds = [
        ...new Set(
          userEmails.map((em) => em.templateId?.toString()).filter((id) => id)
        ),
      ];

      const usedTemplates = usedTemplateIds.map((tid) => {
        const template = templateMap[tid];
        const lastUsedEmail = userEmails.find(
          (em) => em.templateId?.toString() === tid
        );

        const relatedScenarios = scenarios
          .filter((sc) => {
            if (sc.userId?.toString() !== user._id.toString()) return false;
            return sc.routerBranches.some((branch) =>
              branch.modules.some((m) => m.template === template?.name)
            );
          })
          .map((sc) => sc.name);

        return {
          _id: tid,
          name: template?.name || 'Unknown Template',
          lastUsed: lastUsedEmail?.createdAt || null,
          triggeredIn: relatedScenarios,
        };
      });

      return {
        ...user,
        lastLogin: user.lastLogin || null,
        lastLogout: user.lastLogout || null,
        templatesUsed: usedTemplates,
      };
    });

    res.json({ activities });
  } catch (err) {
    console.error('❌ Error fetching user activity:', err);
    res.status(500).json({ message: err.message });
  }
};

// export const getEmailTrackingForAdmin = async (req, res) => {
//   try {
//     const { userId, service, type } = req.query; // optional filters

//     const [users, emails, templates] = await Promise.all([
//       authModel.find({}, 'fullName email').lean(),
//       EmailModel.find(
//         { isTestEmail: { $ne: true }, isForwarded: true },
//         'userId subject textBody htmlBody templateId service stepType parentEmailId createdAt'
//       ).lean(),
//       TemplateModel.find({}, 'userId name service type active platform').lean(),
//     ]);

//     // Filter by user if provided
//     const filteredUsers = userId
//       ? users.filter((u) => String(u._id) === String(userId))
//       : users;

//     const userSummary = filteredUsers.map((user) => {
//       const userIdStr = String(user._id);

//       // Filter emails/templates for this user
//       let userEmails = emails.filter((e) => String(e.userId) === userIdStr);
//       let userTemplates = templates.filter(
//         (t) => String(t.userId) === userIdStr
//       );

//       // Apply optional filters
//       if (service) {
//         userEmails = userEmails.filter(
//           (e) => e.service?.toLowerCase() === service.toLowerCase()
//         );
//         userTemplates = userTemplates.filter(
//           (t) => t.service?.toLowerCase() === service.toLowerCase()
//         );
//       }
//       if (type) {
//         userEmails = userEmails.filter(
//           (e) => e.stepType?.toLowerCase() === type.toLowerCase()
//         );
//         userTemplates = userTemplates.filter(
//           (t) => t.type?.toLowerCase() === type.toLowerCase()
//         );
//       }

//       if (userEmails.length === 0) return null; // skip if no matching emails

//       const templateUsageMap = {};
//       const emailTemplateMap = [];

//       userEmails.forEach((email) => {
//         const matchedTemplate =
//           email.templateId &&
//           userTemplates.find((t) => String(t._id) === String(email.templateId));

//         const detectedTemplate = matchedTemplate || null;
//         const detectedPlatform = detectPlatform(email);

//         emailTemplateMap.push({
//           subject: email.subject || '(No Subject)',
//           matchedTemplate: detectedTemplate?.name || '—',
//           serviceDetected:
//             email.service || detectedTemplate?.service || 'Unknown',
//           stepType: email.stepType || detectedTemplate?.type || 'initial',
//           detectedPlatform,
//           date: email.createdAt,
//           parentEmailId: email.parentEmailId || null,
//           htmlBody: email.htmlBody || '',
//         });

//         if (detectedTemplate) {
//           const key = String(detectedTemplate._id);
//           templateUsageMap[key] = (templateUsageMap[key] || 0) + 1;
//         }
//       });

//       const templatesByService = {};
//       userTemplates.forEach((tpl) => {
//         const usageCount = templateUsageMap[String(tpl._id)] || 0;
//         if (usageCount > 0) {
//           if (!templatesByService[tpl.service]) {
//             templatesByService[tpl.service] = [];
//           }
//           templatesByService[tpl.service].push({
//             name: tpl.name,
//             type: tpl.type,
//             active: tpl.active,
//             platform: tpl.platform,
//             usageCount,
//           });
//         }
//       });

//       return {
//         user,
//         totalEmails: userEmails.length,
//         activeTemplates: Object.values(templatesByService)
//           .flat()
//           .filter((t) => t.active).length,
//         inactiveTemplates: Object.values(templatesByService)
//           .flat()
//           .filter((t) => !t.active).length,
//         templatesByService,
//         emailTemplateMap,
//       };
//     });

//     const filteredSummary = userSummary.filter(Boolean);

//     res.json({ success: true, data: filteredSummary });
//   } catch (error) {
//     console.error('Error in email tracking summary:', error);
//     res.status(500).json({ success: false, message: error.message });
//   }
// };

export const getEmailTrackingForAdmin = async (req, res) => {
  try {
    const { userId, service, type } = req.query;

    const [users, emails, templates] = await Promise.all([
      authModel.find({}, 'fullName email').lean(),

      // ✅ Fetch all emails
      EmailModel.find(
        { isTestEmail: { $ne: true } },
        `
          userId subject textBody htmlBody templateId 
          service stepType parentEmailId createdAt 
          inReplyTo references
        `
      ).lean(),

      TemplateModel.find({}, 'userId name service type active platform').lean(),
    ]);

    const normalizeId = (id) => (id ? String(id) : null);

    // ✅ STEP 1: Build email map
    const emailMap = {};
    emails.forEach((e) => {
      emailMap[String(e._id)] = {
        ...e,
        replies: [],
      };
    });

    // ✅ STEP 2: Link replies → parents
    emails.forEach((email) => {
      const parentId =
        normalizeId(email.parentEmailId) ||
        normalizeId(email.inReplyTo) ||
        normalizeId(email.references?.[0]);

      if (parentId && emailMap[parentId]) {
        emailMap[parentId].replies.push(email);
      }
    });

    // ✅ Filter users
    const filteredUsers = userId
      ? users.filter((u) => String(u._id) === String(userId))
      : users;

    const userSummary = filteredUsers.map((user) => {
      const userIdStr = String(user._id);

      let userEmails = emails.filter((e) => String(e.userId) === userIdStr);

      let userTemplates = templates.filter(
        (t) => String(t.userId) === userIdStr
      );

      // Filters
      if (service) {
        userEmails = userEmails.filter(
          (e) => e.service?.toLowerCase() === service.toLowerCase()
        );
        userTemplates = userTemplates.filter(
          (t) => t.service?.toLowerCase() === service.toLowerCase()
        );
      }

      if (type) {
        userEmails = userEmails.filter(
          (e) => e.stepType?.toLowerCase() === type.toLowerCase()
        );
        userTemplates = userTemplates.filter(
          (t) => t.type?.toLowerCase() === type.toLowerCase()
        );
      }

      if (userEmails.length === 0) return null;

      const templateUsageMap = {};
      const emailTemplateMap = [];

      // ✅ Faster template lookup
      const templateMap = {};
      userTemplates.forEach((t) => {
        templateMap[String(t._id)] = t;
      });

      userEmails.forEach((email) => {
        const emailWithReplies = emailMap[String(email._id)];

        // 🔥 IMPORTANT: ONLY include emails with replies
        if (!emailWithReplies || emailWithReplies.replies.length === 0) {
          return;
        }

        const detectedTemplate = email.templateId
          ? templateMap[String(email.templateId)]
          : null;

        const detectedPlatform = detectPlatform(email);

        emailTemplateMap.push({
          id: email._id,
          subject: email.subject || '(No Subject)',
          matchedTemplate: detectedTemplate?.name || '—',
          serviceDetected:
            email.service || detectedTemplate?.service || 'Unknown',
          stepType: email.stepType || detectedTemplate?.type || 'initial',
          detectedPlatform,
          date: email.createdAt,
          parentEmailId: email.parentEmailId || null,
          htmlBody: email.htmlBody || '',

          replies: emailWithReplies.replies.map((r) => ({
            id: r._id,
            subject: r.subject || '(No Subject)',
            htmlBody: r.htmlBody || '',
            date: r.createdAt,
            service: r.service || 'Unknown',
          })),
        });

        if (detectedTemplate) {
          const key = String(detectedTemplate._id);
          templateUsageMap[key] = (templateUsageMap[key] || 0) + 1;
        }
      });

      // ❗ IMPORTANT: if no emails with replies → skip user
      if (emailTemplateMap.length === 0) return null;

      const templatesByService = {};

      userTemplates.forEach((tpl) => {
        const usageCount = templateUsageMap[String(tpl._id)] || 0;

        if (usageCount > 0) {
          if (!templatesByService[tpl.service]) {
            templatesByService[tpl.service] = [];
          }

          templatesByService[tpl.service].push({
            name: tpl.name,
            type: tpl.type,
            active: tpl.active,
            platform: tpl.platform,
            usageCount,
          });
        }
      });

      return {
        user,

        // ✅ FIXED: count only emails WITH replies
        totalEmails: emailTemplateMap.length,

        activeTemplates: Object.values(templatesByService)
          .flat()
          .filter((t) => t.active).length,

        inactiveTemplates: Object.values(templatesByService)
          .flat()
          .filter((t) => !t.active).length,

        templatesByService,
        emailTemplateMap,
      };
    });

    const filteredSummary = userSummary.filter(Boolean);

    res.json({
      success: true,
      data: filteredSummary,
    });
  } catch (error) {
    console.error('Error in email tracking summary:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

function detectPlatform(email) {
  const text = (
    (email.subject || '') +
    ' ' +
    (email.textBody || '') +
    ' ' +
    (email.htmlBody || '')
  ).toLowerCase();

  if (text.includes('shopify')) return 'Shopify';
  if (text.includes('gmail')) return 'Gmail';
  if (text.includes('outlook')) return 'Outlook';
  return 'Other';
}

export const getTemplateUsageForAdmin = async (req, res) => {
  try {
    const { userId, service, type } = req.query;

    const [users, templates, emails] = await Promise.all([
      authModel.find({}, 'fullName email').lean(),
      TemplateModel.find(
        {},
        'userId name service type active platform createdAt updatedAt'
      ).lean(),
      EmailModel.find(
        { isForwarded: true, templateId: { $ne: null } },
        'userId templateId createdAt'
      ).lean(),
    ]);

    // --- Global stats ---
    const totalTemplates = templates.length;
    const totalEmails = emails.length;

    // Build a map of templateId → usage count
    const globalUsageMap = {};
    emails.forEach((e) => {
      const key = String(e.templateId);
      globalUsageMap[key] = (globalUsageMap[key] || 0) + 1;
    });

    // Identify top used template
    let mostUsedTemplate = null;
    let maxUsage = 0;
    for (const tpl of templates) {
      const usage = globalUsageMap[String(tpl._id)] || 0;
      if (usage > maxUsage) {
        maxUsage = usage;
        mostUsedTemplate = tpl;
      }
    }

    const summary = users.map((user) => {
      const userIdStr = String(user._id);
      const userTemplates = templates.filter(
        (t) => String(t.userId) === userIdStr
      );
      const userEmails = emails.filter((e) => String(e.userId) === userIdStr);

      const usageMap = {};
      userEmails.forEach((e) => {
        usageMap[String(e.templateId)] =
          (usageMap[String(e.templateId)] || 0) + 1;
      });

      // --- Apply filters per user ---
      let filteredTemplates = userTemplates;
      if (service)
        filteredTemplates = filteredTemplates.filter(
          (t) => t.service?.toLowerCase() === service.toLowerCase()
        );
      if (type)
        filteredTemplates = filteredTemplates.filter(
          (t) => t.type?.toLowerCase() === type.toLowerCase()
        );

      const templatesData = filteredTemplates.map((tpl) => {
        const usageCount = usageMap[String(tpl._id)] || 0;
        const usagePercentage = totalEmails
          ? ((usageCount / totalEmails) * 100).toFixed(2)
          : 0;

        return {
          name: tpl.name,
          service: tpl.service,
          type: tpl.type,
          active: tpl.active,
          platform: tpl.platform,
          usageCount,
          usagePercentage: Number(usagePercentage),
          lastUsed:
            userEmails
              .filter((e) => String(e.templateId) === String(tpl._id))
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
              ?.createdAt || null,
        };
      });

      return {
        user,
        totalTemplates: templatesData.length,
        totalUsedTemplates: templatesData.filter((t) => t.usageCount > 0)
          .length,
        totalUsageCount: templatesData.reduce(
          (sum, t) => sum + t.usageCount,
          0
        ),
        templatesData,
      };
    });

    const filteredSummary = summary.filter((s) => s.totalTemplates > 0);

    // --- Global summary ---
    const globalStats = {
      totalTemplates,
      totalEmails,
      totalUsedTemplates: Object.keys(globalUsageMap).length,
      mostUsedTemplate: mostUsedTemplate
        ? {
            name: mostUsedTemplate.name,
            service: mostUsedTemplate.service,
            type: mostUsedTemplate.type,
            usageCount: maxUsage,
            usagePercentage: totalEmails
              ? ((maxUsage / totalEmails) * 100).toFixed(2)
              : 0,
          }
        : null,
    };

    res.json({ success: true, globalStats, data: filteredSummary });
  } catch (error) {
    console.error('Error in template usage stats:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAiStatus = async (req, res) => {
  try {
    const { userId, enabled } = req.body;

    if (!userId || typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'userId and enabled(boolean) are required',
      });
    }

    const user = await authModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.subscription?.plan !== 'pro') {
      return res.status(403).json({
        success: false,
        message: 'AI is available only on Pro plan',
      });
    }

    user.Ai = enabled;
    await user.save();

    return res.json({
      success: true,
      message: `AI ${enabled ? 'enabled' : 'disabled'} successfully`,
      Ai: user.Ai,
    });
  } catch (error) {
    console.error('❌ updateAiStatus error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

// export const deleteUser = async (req, res) => {
//   try {
//     const { id } = req.params;

//     await authModel.findByIdAndDelete(id);

//     res.send({ message: "User deleted" });
//   } catch (error) {
//     res.status(400).json({ error: error.message });
//   }
// };

export const purgeUserData = async (userIdsInput) => {
  try {
    const idsArray = Array.isArray(userIdsInput) ? userIdsInput : [userIdsInput];
    if (idsArray.length === 0) return;

    const validObjectIds = idsArray
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));
    const stringIds = idsArray.map((id) => String(id)).filter(Boolean);

    if (validObjectIds.length === 0 && stringIds.length === 0) return;

    const idQuery = {
      $in: [...validObjectIds, ...stringIds],
    };

    console.log(`🧹 Purging all database records for user IDs:`, stringIds);

    // Primary deletion tasks
    await Promise.allSettled([
      authModel.deleteMany({ _id: idQuery }),
      EmailModel.deleteMany({ userId: idQuery }),
      ConnectionModel.deleteMany({ userId: idQuery }),
      TemplateModel.deleteMany({ userId: idQuery }),
      scenarioModel.deleteMany({ userId: idQuery }),
      mailhookModel.deleteMany({ userId: idQuery }),
      OrganizationModel.deleteMany({ userId: idQuery }),
    ]);

    // Comprehensive dynamic cleanup across all registered Mongoose models
    for (const modelName of Object.keys(mongoose.models)) {
      try {
        const model = mongoose.models[modelName];
        if (model && model.schema && model.schema.paths && model.schema.paths.userId) {
          await model.deleteMany({ userId: idQuery });
        }
      } catch (err) {
        console.error(`Error purging model ${modelName}:`, err.message);
      }
    }

    console.log(`✅ All user data purged successfully for ${stringIds.length} user(s).`);
  } catch (err) {
    console.error('❌ User data purge failed:', err);
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const user = await authModel.findById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await purgeUserData([id]);

    res.status(200).json({
      message: 'User account, emails, scenarios, history, and all associated data deleted successfully from database',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const bulkDeleteUsers = async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Array of user IDs is required' });
    }

    await purgeUserData(ids);

    res.status(200).json({ message: 'Users and all associated database records deleted successfully' });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

export const giveProPlan = async (req, res) => {
  try {
    const { id } = req.params;
    const { durationInDays } = req.body;

    const duration = Number(durationInDays);

    if (!duration || duration <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid duration',
      });
    }

    const user = await authModel.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const now = new Date();

    const currentEnd = user.subscription?.currentPeriodEnd
      ? new Date(user.subscription.currentPeriodEnd)
      : null;

    let startDate = now;

    if (currentEnd && currentEnd > now) {
      startDate = currentEnd;
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + duration);

    user.subscription = {
      ...user.subscription,
      plan: 'pro',
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: endDate,
    };

    user.Ai = true;

    await user.save();

    let emailSent = false;

    if (user.email) {
      try {
        await sendProPlanActivatedEmail({
          to: user.email,
          name: user.fullName || user.name || 'there',
          durationInDays: duration,
          startDate,
          endDate,
        });

        emailSent = true;
      } catch (emailError) {
        console.error('Pro plan activation email failed:', emailError.message);
      }
    } else {
      console.warn('Pro assigned but user email is missing:', user._id);
    }

    return res.status(200).json({
      success: true,
      message: `Pro assigned for ${duration} days`,
      durationInDays: duration,
      startDate,
      endDate,
      expiry: endDate,
      emailSent,
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        name: user.name,
        subscription: user.subscription,
        Ai: user.Ai,
      },
    });
  } catch (error) {
    console.error('Give Pro Plan Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Error while assigning Pro plan',
      error: error.message,
    });
  }
};

export const revokeProPlan = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await authModel.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    if (user.subscription?.plan === 'free') {
      return res.status(400).json({
        success: false,
        message: 'User is already on FREE plan',
      });
    }

    const previousSubscription = {
      plan: user.subscription?.plan || 'pro',
      status: user.subscription?.status || null,
      currentPeriodStart: user.subscription?.currentPeriodStart || null,
      currentPeriodEnd: user.subscription?.currentPeriodEnd || null,
    };

    user.subscription = {
      ...user.subscription,
      plan: 'free',
      status: 'inactive',
      currentPeriodStart: null,
      currentPeriodEnd: null,
    };

    user.Ai = false;

    await user.save();

    let emailSent = false;

    if (user.email) {
      try {
        await sendProPlanRevokedEmail({
          to: user.email,
          name: user.fullName || user.name || 'there',
          previousPlan: previousSubscription.plan || 'Pro',
          previousEndDate: previousSubscription.currentPeriodEnd,
        });

        emailSent = true;
      } catch (emailError) {
        console.error('Pro plan revoke email failed:', emailError.message);
      }
    } else {
      console.warn('Pro revoked but user email is missing:', user._id);
    }

    return res.status(200).json({
      success: true,
      message: 'User downgraded to FREE plan',
      emailSent,
      previousSubscription,
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        name: user.name,
        subscription: user.subscription,
        Ai: user.Ai,
      },
    });
  } catch (error) {
    console.error('Revoke Pro Plan Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Error while revoking Pro plan',
      error: error.message,
    });
  }
};

export const deleteConnectionByAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Invalid connection id',
      });
    }

    const connection = await ConnectionModel.findById(id);

    if (!connection) {
      return res.status(404).json({
        error: 'Connection not found',
      });
    }

    await ConnectionModel.findByIdAndDelete(id);

    return res.status(200).json({
      message: 'Connection deleted successfully',
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message,
    });
  }
};

export const updateConnectionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        error: 'Invalid connection id',
      });
    }

    const connection = await ConnectionModel.findById(id);
    if (!connection) {
      return res.status(404).json({
        error: 'Connection not found',
      });
    }

    const { name, email, status, smtp } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (status !== undefined) updateData.status = status;

    if (connection.provider === 'smtp') {
      if (email !== undefined) updateData.email = email;
      if (smtp !== undefined && typeof smtp === 'object') {
        updateData.smtp = {
          host: smtp.host !== undefined ? smtp.host : connection.smtp?.host,
          port:
            smtp.port !== undefined ? Number(smtp.port) : connection.smtp?.port,
          username:
            smtp.username !== undefined
              ? smtp.username
              : connection.smtp?.username,
        };
        if (smtp.password !== undefined && smtp.password !== '') {
          updateData.smtp.password = smtp.password;
        } else if (connection.smtp?.password) {
          updateData.smtp.password = connection.smtp.password;
        }
      }
    }

    const updatedConnection = await ConnectionModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    const returnedConnection = updatedConnection.toObject();
    if (returnedConnection.tokens) delete returnedConnection.tokens;
    if (returnedConnection.smtp && returnedConnection.smtp.password) {
      delete returnedConnection.smtp.password;
    }

    return res.status(200).json({
      success: true,
      connection: returnedConnection,
    });
  } catch (error) {
    console.error('Error updating connection:', error);
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'A connection with this email already exists for this user.',
      });
    }
    return res.status(500).json({
      error: error.message,
    });
  }
};

export const loginAsUserByAdmin = async (req, res) => {
  try {
    console.log('====================================');
    console.log('🔥 [loginAsUserByAdmin] API HIT');
    console.log('📌 params:', req.params);
    console.log('📌 userId param:', req.params.userId);
    console.log('📌 req.user:', req.user);
    console.log('📌 req.headers.authorization:', req.headers.authorization);
    console.log('====================================');

    if (!req.user) {
      console.log('❌ req.user missing. Middleware did not set req.user');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: req.user missing',
      });
    }

    console.log('👤 Current requester:', {
      id: req.user._id,
      role: req.user.role,
    });

    if (req.user.role !== 'admin') {
      console.log('❌ Not admin:', req.user.role);
      return res.status(403).json({
        success: false,
        message: 'Only admin allowed',
      });
    }

    console.log('✅ Admin verified');

    const user = await authModel.findById(req.params.userId);

    console.log(
      '🔎 Target user found:',
      user
        ? {
            id: user._id,
            email: user.email,
            role: user.role,
          }
        : null
    );

    if (!user) {
      console.log('❌ Target user not found:', req.params.userId);
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const tokenPayload = {
      _id: user._id,
      role: user.role,
      impersonated: true,
      adminId: req.user._id,
    };

    console.log('🎫 Creating impersonation token payload:', tokenPayload);

    const token = createToken(tokenPayload);

    console.log('✅ Impersonation token created');
    console.log('====================================');

    return res.json({
      success: true,
      message: 'Logged in as user successfully',
      token,
      data: user,
    });
  } catch (error) {
    console.error('🔥 [loginAsUserByAdmin] ERROR:', error);

    return res.status(500).json({
      success: false,
      message: 'Server error in loginAsUserByAdmin',
      error: error.message,
    });
  }
};



