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
      name: 'Untitled Scenario',
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

export const signIn = async (req, res) => {
  try {
    const { email, password } = req.body;

    const emailExist = await authModel.findOne({
      email: email,
    });

    if (!emailExist) {
      throw new Error('User does not exist with this email');
    }

    const isMatch = await emailExist.comparePassword(password);
    if (!isMatch) {
      throw new Error('Password does not match');
    }

    const token = createToken({ _id: emailExist._id, role: emailExist.role });

    res.send({
      message: 'Successfully logged in',
      token,
      data: emailExist,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

export const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await authModel.findById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const latestEmail = await EmailModel.findOne({
      userId: id,
      verificationUrl: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .lean();

    const organization = await OrganizationModel.findOne({ userId: id }).lean();

    res.status(200).json({
      message: "User fetched successfully",
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
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Internal Server Error" });
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
      return res.status(404).json({ success: false, message: "User not found" });
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
        organizationName: organizationName || user.organizationName || "My Organization",
        Region: Region || "Unknown",
        country: country || "Unknown",
        TimeZone: TimeZone || "UTC",
        PartnerLink: PartnerLink || "",
      });
    }

    // 🔹 4️⃣ Response
    res.status(200).json({
      success: true,
      message: "User and Organization updated successfully",
      data: {
        user,
        organization,
      },
    });
  } catch (error) {
    console.error("❌ Error updating user and organization:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
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

    res.clearCookie('token', { path: '/' });

    res.status(200).json({ message: 'Logout successfully', userId });
  } catch (error) {
    console.error('Error during logout:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
};

export const completeSetup = async (req, res) => {
  try {
    const { id } = req.params;
    const { stepCompleted, setupCompleted = false, skipped = false } = req.body;

    const stepTitles = {
      1: 'Mailhook created',
      2: 'Mailhook verified',
      3: 'Forwarding rules configured',
      4: 'SMTP credentials connected',
      5: 'Automation mode selected',
    };

    const user = await authModel.findById(id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: 'User not found' });

    if (!user.setup) user.setup = { steps: [] };
    if (!user.setup.steps) user.setup.steps = [];

    // 🟢 CASE 1 — user skipped everything at once
    if (skipped && stepCompleted === 1) {
      user.setup.steps = Object.entries(stepTitles).map(([num, title]) => ({
        step: Number(num),
        title,
        status: 'skipped',
        updatedAt: new Date(),
      }));

      user.setup.stepCompleted = 5; // assume full wizard skipped
      user.setup.skipped = true;
      user.setup.completed = false;
      user.setup.updatedAt = new Date();

      await user.save();
      return res.json({
        success: true,
        message: '✅ All steps marked as skipped',
        data: user.setup,
      });
    }

    // 🟠 CASE 2 — normal flow or partial skip
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
      message: '✅ Setup progress updated successfully',
      data: user.setup,
    });
  } catch (err) {
    console.error('❌ Error updating setup:', err);
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
      message: '✅ Setup progress fetched successfully',
      data: {
        userId: user._id,
        name: user.name,
        email: user.email,
        ...(user.setup.toObject?.() || user.setup),
      },
    });
  } catch (err) {
    console.error('❌ Error fetching setup progress:', err);
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

// const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
// const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

const CLIENT_ID =
  '1072288734636-og1s7nku04nb0gf56v53gr8uar1tjjpq.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI = 'http://localhost:5000/auth/google/callback';
console.log('CLIENT_ID', CLIENT_ID);
console.log('CLIENT_SECRET', CLIENT_SECRET);
console.log('REDIRECT_URI', REDIRECT_URI);

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

export const googleAuth = (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('userId is required');

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: JSON.stringify({ userId }),
  });

  res.redirect(authUrl);
};

export const googleAuthCallback = async (req, res) => {
  const { code, state } = req.query;

  let userId;
  try {
    const parsedState = JSON.parse(state);
    userId = parsedState.userId;
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
        'http://localhost:3006/connection?status=no_refresh_token'
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

    return res.send(`
  <html>
    <body style="font-family: sans-serif; text-align: center; padding: 40px;">
      <h2>Gmail connected successfully!</h2>
      <p>You can close this window.</p>
      <script>
        (function() {
          // Wait a short moment to ensure opener is ready
          function notifyParent() {
            if (window.opener) {
              // ✅ Replace this with your frontend origin
              const frontendOrigin = "http://localhost:3000"; 
              // or "https://your-frontend-domain.com"
              
              window.opener.postMessage(
                { type: "google-auth-success", connectionId: "${connection._id}" },
                frontendOrigin
              );
              console.log("✅ Message sent to opener:", frontendOrigin);
            } else {
              console.warn("⚠️ No opener found.");
            }

            // Close popup after a brief delay
            setTimeout(() => window.close(), 1500);
          }

          // Wait to ensure parent window’s listener is attached
          setTimeout(notifyParent, 500);
        })();
      </script>
    </body>
  </html>
`);
  } catch (error) {
    console.error('❌ Error during Google auth callback:', error);
    return res.redirect('http://localhost:3006/connection?status=error');
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

const MICROSOFT_CLIENT_ID = '09979dca-57cd-450e-8934-24887f1f368c';
const MICROSOFT_CLIENT_SECRET = 'TQK8Q~Awgm.47QKh2QT5w~D4nqZiwkGGJpoQ5c._';
const MICROSOFT_REDIRECT_URI = 'http://localhost:5000/auth/outlook/callback';
const FRONTEND_URL = 'http://localhost:3006';

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

export const startOutlookOAuth = (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).send('Missing userId');

  const authorizationUri = client.authorizeURL({
    redirect_uri: MICROSOFT_REDIRECT_URI,
    scope:
      'openid profile offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send',
    state: JSON.stringify({ userId }),
    prompt: 'consent',
  });

  console.log(' Redirecting to Microsoft OAuth:', authorizationUri);
  res.redirect(authorizationUri);
};

export const outlookOAuthCallback = async (req, res) => {
  const { code, state } = req.query;

  let userId;
  try {
    const parsed = JSON.parse(state);
    userId = parsed.userId;
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
    console.log(' Microsoft user info:', user);

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

    return res.send(`
      <html>
        <body style="font-family: sans-serif; text-align: center; padding: 40px;">
          <h2> Outlook connected successfully!</h2>
          <p>You can close this window.</p>
          <script>
            (function() {
              function notifyParent() {
                if (window.opener) {
                  const frontendOrigin = "${FRONTEND_URL}";
                  window.opener.postMessage(
                    { type: "outlook-auth-success", connectionId: "${connection._id}" },
                    frontendOrigin
                  );
                  console.log(" Message sent to opener:", frontendOrigin);
                } else {
                  console.warn(" No opener found.");
                }
                setTimeout(() => window.close(), 1500);
              }
              setTimeout(notifyParent, 500);
            })();
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error(' Outlook OAuth error:', err);
    res.redirect(`${FRONTEND_URL}/connection?status=error`);
  }
};
