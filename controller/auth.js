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

const createToken = (payLoad) => {
  const token = jwt.sign({ payLoad }, process.env.SECRET_KEY, {
    expiresIn: '1d',
  });
  return token;
};

export const signUp = async (req, res) => {
  try {
    const userExist = await authModel.findOne({ email: req.body.email });
    if (userExist) {
      throw new Error('User already exists with this email');
    }

    const newUser = new authModel(req.body);
    const savedUser = await newUser.save();

    savedUser.mailhook = `${savedUser._id}@mail.brandfer.com`;
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

    // --- Default Shopify Scenario ---
    // const defaultScenario = {
    //   userId: savedUser._id,
    //   name: 'Shopify scenario',
    //   description: '',
    //   type: 'shopify',
    //   routerBranches: [
    //     {
    //       id: 2,
    //       hasModule: false,
    //       condition: null,
    //       modules: [
    //         {
    //           id: '1759389173211',
    //           app: {
    //             name: 'Gmail',
    //             color: 'bg-red-500',
    //             icon: 'Gmail',
    //           },
    //           subject: '',
    //           cc: [],
    //           bcc: [],
    //           type: 'Send an Email',
    //           description: 'Send an email via Gmail',
    //           connectionId: '',
    //           template: 'Initial Email',
    //           delayValue: 5,
    //           delayUnit: 'seconds',
    //           filter: { conditions: [] },
    //         },
    //         {
    //           id: '1759389175969',
    //           app: {
    //             name: 'Delay',
    //             color: 'bg-blue-500',
    //             icon: 'Delay',
    //           },
    //           subject: '',
    //           cc: [],
    //           bcc: [],
    //           type: '',
    //           description: '',
    //           connectionId: '',
    //           template: '',
    //           delayValue: 5,
    //           delayUnit: 'seconds',
    //           filter: { conditions: [] },
    //         },
    //         {
    //           id: '1759389185521',
    //           app: {
    //             name: 'Gmail',
    //             color: 'bg-red-500',
    //             icon: 'Gmail',
    //           },
    //           subject: '',
    //           cc: [],
    //           bcc: [],
    //           type: 'Send an Email',
    //           description: 'Send an email via Gmail',
    //           connectionId: '',
    //           template: 'First Email',
    //           delayValue: 5,
    //           delayUnit: 'seconds',
    //           filter: { conditions: [] },
    //         },
    //       ],
    //       filter: { conditions: [] },
    //     },
    //   ],
    // };
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
              subject: '',
              cc: [],
              bcc: [],
              type: 'Send an Email',
              description: 'Send email via Gmail',
              connectionId: '',
              template: 'Initial Email',
              delayValue: 5,
              delayUnit: 'seconds',
              emailType: 'Gmail',
              filter: { conditions: [] },
            },
            {
              id: `${Date.now()}_2`,
              app: {
                name: 'Delay',
                color: 'bg-blue-500',
                icon: 'Delay',
              },
              subject: '',
              cc: [],
              bcc: [],
              type: 'Delay',
              description: 'Wait 5 seconds',
              connectionId: '',
              template: '',
              delayValue: 5,
              delayUnit: 'seconds',
              emailType: 'Delay',
              filter: { conditions: [] },
            },
            {
              id: `${Date.now()}_3`,
              app: {
                name: 'First Follow-up',
                color: 'bg-red-500',
                icon: 'Gmail',
              },
              subject: '',
              cc: [],
              bcc: [],
              type: 'Send an Email',
              description: 'Send email via Gmail',
              connectionId: '',
              template: 'First Follow-up',
              delayValue: 5,
              delayUnit: 'seconds',
              emailType: 'Gmail',
              filter: { conditions: [] },
            },
            {
              id: `${Date.now()}_4`,
              app: {
                name: 'Delay',
                color: 'bg-blue-500',
                icon: 'Delay',
              },
              subject: '',
              cc: [],
              bcc: [],
              type: 'Delay',
              description: 'Wait 5 seconds',
              connectionId: '',
              template: '',
              delayValue: 5,
              delayUnit: 'seconds',
              emailType: 'Delay',
              filter: { conditions: [] },
            },
            {
              id: `${Date.now()}_5`,
              app: {
                name: 'Second Follow-up',
                color: 'bg-red-500',
                icon: 'Gmail',
              },
              subject: '',
              cc: [],
              bcc: [],
              type: 'Send an Email',
              description: 'Send email via Gmail',
              connectionId: '',
              template: 'Second Follow-up',
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

    // --- Token Create ---
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

//     const emailExist = await authModel.findOne({
//       email: email,
//     });

//     if (!emailExist) {
//       throw new Error('User does not exist with this email');
//     }

//     const isMatch = await emailExist.comparePassword(password);
//     if (!isMatch) {
//       throw new Error('Password does not match');
//     }

//     const token = createToken({ _id: emailExist._id, role: emailExist.role });

//     res.send({
//       message: 'Successfully logged in',
//       token,
//       data: emailExist,
//     });
//   } catch (error) {
//     return res.status(400).json({ error: error.message });
//   }
// };

export const signIn = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await authModel.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: 'User does not exist' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Password does not match' });
    }

    // ✅ Record login timestamp
    user.lastLogin = new Date();
    await user.save();

    const token = createToken({ _id: user._id, role: user.role });

    res.status(200).json({
      message: 'Successfully logged in',
      token,
      data: user,
    });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: error.message });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await authModel.findById(id);
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
        ...user.toObject(),
        verificationUrl: latestEmail?.verificationUrl || null,
        verificationCode: latestEmail?.verificationCode || null,
        organization: organization
          ? {
              organizationName: organization.organizationName,
              Region: organization.Region,
              country: organization.country,
              TimeZone: organization.TimeZone,
              PartnerLink: organization.PartnerLink,
              createdAt: organization.createdAt,
              updatedAt: organization.updatedAt,
              _id: organization._id,
            }
          : null,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const updateUserAndOrganization = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName,
      email,
      role,
      TimeZone,
      organizationName,
      Region,
      country,
      PartnerLink,
    } = req.body;

    const user = await authModel.findById(id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });
    }

    if (fullName) user.fullName = fullName;
    if (email) user.email = email;
    if (role) user.role = role;
    if (TimeZone) user.TimeZone = TimeZone;

    await user.save();

    let organization = await OrganizationModel.findOne({ userId: id });

    if (organization) {
      if (organizationName) organization.organizationName = organizationName;
      if (Region) organization.Region = Region;
      if (country) organization.country = country;
      if (TimeZone) organization.TimeZone = TimeZone;
      if (PartnerLink) organization.PartnerLink = PartnerLink;

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
      });
    }

    res.status(200).json({
      success: true,
      message: 'User and Organization updated successfully',
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

export const createOrganization = async (req, res) => {
  try {
    const { organizationName, Region, country, PartnerLink, TimeZone, userId } =
      req.body;

    if (!organizationName || !userId) {
      return res.status(400).json({
        success: false,
        message: 'organizationName and userId are required.',
      });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const geo = geoip.lookup(ip);

    const detectedRegion = Region || geo?.region || 'Unknown';
    const detectedCountry = country || geo?.country || 'Unknown';
    const detectedTimeZone =
      TimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    const organization = await OrganizationModel.create({
      userId,
      organizationName,
      Region: detectedRegion,
      country: detectedCountry,
      TimeZone: detectedTimeZone,
      PartnerLink: PartnerLink || '',
    });

    res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      data: organization,
    });
  } catch (error) {
    console.error(' createOrganization Error:', error);
    res.status(500).json({
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

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// const CLIENT_ID =
//   '1072288734636-og1s7nku04nb0gf56v53gr8uar1tjjpq.apps.googleusercontent.com';
// const CLIENT_SECRET = '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';
// const REDIRECT_URI = 'http://localhost:5000/auth/google/callback';
// console.log('CLIENT_ID', CLIENT_ID);
// console.log('CLIENT_SECRET', CLIENT_SECRET);
// console.log('REDIRECT_URI', REDIRECT_URI);

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://mail.google.com/',
];

// export const googleAuth = (req, res) => {
//   const { userId } = req.query;
//   if (!userId) return res.status(400).send('userId is required');

//   const authUrl = oauth2Client.generateAuthUrl({
//     access_type: 'offline',
//     scope: SCOPES,
//     prompt: 'consent',
//     state: JSON.stringify({ userId }),
//   });

//   res.redirect(authUrl);
// };

// export const googleAuthCallback = async (req, res) => {
//   const { code, state } = req.query;

//   let userId;
//   try {
//     const parsedState = JSON.parse(state);
//     userId = parsedState.userId;
//   } catch (err) {
//     return res.status(400).send('Invalid state parameter');
//   }

//   try {
//     const oauth2Client = new google.auth.OAuth2(
//       CLIENT_ID,
//       CLIENT_SECRET,
//       REDIRECT_URI
//     );

//     const { tokens } = await oauth2Client.getToken(code);
//     oauth2Client.setCredentials(tokens);

//     if (!tokens.refresh_token) {
//       return res.redirect(
//         `${FRONTEND_URL}/connection?status=no_refresh_token`
//       );
//     }

//     const peopleApi = google.people({ version: 'v1', auth: oauth2Client });
//     const response = await peopleApi.people.get({
//       resourceName: 'people/me',
//       personFields: 'emailAddresses,names',
//     });

//     const userEmail = response.data.emailAddresses?.[0]?.value;
//     const userName = response.data.names?.[0]?.displayName || '';

//     if (!userEmail)
//       return res.status(400).send('No email found in Google profile');

//     let connection = await ConnectionModel.findOne({
//       userId,
//       email: userEmail,
//     });

//     if (!connection) {
//       connection = new ConnectionModel({
//         userId,
//         provider: 'gmail',
//         email: userEmail,
//         name: userName,
//         tokens,
//         status: 'active',
//         createdAt: new Date(),
//       });
//     } else {
//       connection.tokens = tokens;
//       connection.status = 'active';
//       connection.lastConnected = new Date();
//     }

//     await connection.save();

//     return res.redirect(
//       `${FRONTEND_URL}/scenarios/shopify?google-auth-success=true&connectionId=${connection._id}`
//     );
//   } catch (error) {
//     console.error('❌ Error during Google auth callback:', error);
//     return res.redirect(`${FRONTEND_URL}/connection?status=error`);
//   }
// };

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

  let userId, redirectPath;
  try {
    const parsedState = JSON.parse(state);
    userId = parsedState.userId;
    redirectPath = parsedState.redirect || 'connection'; // default if missing
  } catch (err) {
    return res.status(400).send('Invalid state parameter');
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      return res.redirect(
        `${FRONTEND_URL}/${redirectPath}?status=no_refresh_token`
      );
    }

    const peopleApi = google.people({ version: 'v1', auth: oauth2Client });
    const response = await peopleApi.people.get({
      resourceName: 'people/me',
      personFields: 'emailAddresses,names',
    });

    const userEmail = response.data.emailAddresses?.[0]?.value;
    const userName = response.data.names?.[0]?.displayName || '';

    if (!userEmail)
      return res.status(400).send('No email found in Google profile');

    let connection = await ConnectionModel.findOne({
      userId,
      email: userEmail,
    });

    if (!connection) {
      connection = new ConnectionModel({
        userId,
        provider: 'gmail',
        email: userEmail,
        name: userName,
        tokens,
        status: 'active',
        createdAt: new Date(),
      });
    } else {
      connection.tokens = tokens;
      connection.status = 'active';
      connection.lastConnected = new Date();
    }

    await connection.save();

    return res.redirect(
      `${FRONTEND_URL}/${redirectPath}?google-auth-success=true&connectionId=${connection._id}`
    );
  } catch (error) {
    console.error('❌ Error during Google auth callback:', error);
    return res.redirect(`${FRONTEND_URL}/${redirectPath}?status=error`);
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

// const MICROSOFT_CLIENT_ID = '09979dca-57cd-450e-8934-24887f1f368c';
// const MICROSOFT_CLIENT_SECRET = 'TQK8Q~Awgm.47QKh2QT5w~D4nqZiwkGGJpoQ5c._';
// const MICROSOFT_REDIRECT_URI = 'http://localhost:5000/auth/outlook/callback';
// const FRONTEND_URL = 'http://localhost:3006';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;
const FRONTEND_URL = process.env.FRONTEND_URL;
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

  let userId, redirectPath;
  try {
    const parsed = JSON.parse(state);
    userId = parsed.userId;
    redirectPath = parsed.redirect || 'connection';
  } catch (err) {
    return res.status(400).send('Invalid state parameter');
  }

  try {
    const tokenParams = {
      code,
      redirect_uri: MICROSOFT_REDIRECT_URI,
      scope: 'openid profile offline_access Mail.Read Mail.Send Mail.ReadWrite',
    };

    const accessToken = await client.getToken(tokenParams);

    const userInfoRes = await fetch(
      'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName',
      {
        headers: { Authorization: `Bearer ${accessToken.token.access_token}` },
      }
    );
    const user = await userInfoRes.json();

    const userEmail =
      user.mail || user.userPrincipalName || `${user.id}@unknown.microsoft.com`;
    const userName = user.displayName || '';

    if (!userEmail)
      return res.status(400).send('No email found from Microsoft account');

    let connection = await ConnectionModel.findOne({
      userId,
      email: userEmail,
    });

    if (!connection) {
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
      connection.tokens = accessToken.token;
      connection.status = 'active';
      connection.lastConnected = new Date();
    }

    await connection.save();

    return res.redirect(
      `${FRONTEND_URL}/${redirectPath}?outlook-auth-success=true&connectionId=${connection._id}`
    );
  } catch (err) {
    res.redirect(`${FRONTEND_URL}/connection?status=error`);
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
      from: `"Make Support" <${process.env.EMAIL_USER}>`,
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
      .select('fullName email role setup createdAt');

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

export const getEmailTrackingForAdmin = async (req, res) => {
  try {
    const { userId, service, type } = req.query; // optional filters

    // Fetch data in parallel
    const [users, emails, templates] = await Promise.all([
      authModel.find({}, 'fullName email').lean(),
      EmailModel.find(
        { isTestEmail: { $ne: true }, isForwarded: true },
        'userId subject textBody htmlBody templateId service stepType parentEmailId createdAt'
      ).lean(),
      TemplateModel.find({}, 'userId name service type active platform').lean(),
    ]);

    // Filter by user if provided
    const filteredUsers = userId
      ? users.filter((u) => String(u._id) === String(userId))
      : users;

    const userSummary = filteredUsers.map((user) => {
      const userIdStr = String(user._id);

      // Filter emails/templates for this user
      let userEmails = emails.filter((e) => String(e.userId) === userIdStr);
      let userTemplates = templates.filter(
        (t) => String(t.userId) === userIdStr
      );

      // Apply optional filters
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

      if (userEmails.length === 0) return null; // skip if no matching emails

      const templateUsageMap = {};
      const emailTemplateMap = [];

      userEmails.forEach((email) => {
        const matchedTemplate =
          email.templateId &&
          userTemplates.find((t) => String(t._id) === String(email.templateId));

        const detectedTemplate = matchedTemplate || null;
        const detectedPlatform = detectPlatform(email);

        emailTemplateMap.push({
          subject: email.subject || '(No Subject)',
          matchedTemplate: detectedTemplate?.name || '—',
          serviceDetected:
            email.service || detectedTemplate?.service || 'Unknown',
          stepType: email.stepType || detectedTemplate?.type || 'initial',
          detectedPlatform,
          date: email.createdAt,
          parentEmailId: email.parentEmailId || null,
          htmlBody: email.htmlBody || '',
        });

        if (detectedTemplate) {
          const key = String(detectedTemplate._id);
          templateUsageMap[key] = (templateUsageMap[key] || 0) + 1;
        }
      });

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
        totalEmails: userEmails.length,
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

    res.json({ success: true, data: filteredSummary });
  } catch (error) {
    console.error('Error in email tracking summary:', error);
    res.status(500).json({ success: false, message: error.message });
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
