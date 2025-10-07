import { authModel } from '../Models/auth.js';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fetch from 'node-fetch';

import fs from 'fs';
import { PubSub } from '@google-cloud/pubsub';
import axios from 'axios';
import { EmailModel } from '../Models/Email.js';
import { ConnectionModel } from '../Models/Connection.js';
import { TemplateModel } from '../Models/Template.js';
import nodemailer from 'nodemailer';
import path from 'path';
import { scenarioModel } from '../Models/Scenario.js';

// defaultTemplates.js
export const defaultServices = [
  'General', // 👈 ab general bhi ek service hai
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


// export const signUp = async (req, res) => {
//   try {
//     const userExist = await authModel.findOne({ email: req.body.email });
//     if (userExist) {
//       throw new Error('User already exists with this email');
//     }

//     const newUser = new authModel(req.body);
//     const savedUser = await newUser.save();

//     savedUser.mailhook = `${savedUser._id}@mail.brandfer.com`;
//     await savedUser.save();

//     const templates = [];

//     defaultServices.forEach((service) => {
//       ['Initial Email', 'First Email', 'Second Email'].forEach(
//         (emailName, idx) => {
//           templates.push({
//             userId: savedUser._id,
//             platform: 'shopify',
//             service,
//             name: `${service} - ${emailName}`,
//             type: idx === 0 ? 'initial' : idx === 1 ? 'first' : 'second',
//             conditions: [],
//             content: `This is the ${emailName.toUpperCase()} template for ${service}. You can edit this content.`,
//             active: true,
//             locked: service === 'General',
//           });
//         }
//       );
//     });

//     await TemplateModel.insertMany(templates);

//     const token = createToken({ _id: savedUser._id, role: savedUser.role });

//     res.send({
//       message: 'Successfully registered',
//       token,
//       data: savedUser,
//     });
//   } catch (error) {
//     return res.status(400).json({ error: error.message });
//   }
// };


export const signUp = async (req, res) => {
  try {
    const userExist = await authModel.findOne({ email: req.body.email });
    if (userExist) {
      throw new Error("User already exists with this email");
    }

    const newUser = new authModel(req.body);
    const savedUser = await newUser.save();

    savedUser.mailhook = `${savedUser._id}@mail.brandfer.com`;
    await savedUser.save();

    // --- Default Templates ---
    const templates = [];
    defaultServices.forEach((service) => {
      ["Initial Email", "First Email", "Second Email"].forEach(
        (emailName, idx) => {
          templates.push({
            userId: savedUser._id,
            platform: "shopify",
            service,
            name: `${service} - ${emailName}`,
            type: idx === 0 ? "initial" : idx === 1 ? "first" : "second",
            conditions: [],
            content: `This is the ${emailName.toUpperCase()} template for ${service}. You can edit this content.`,
            active: true,
            locked: service === "General",
          });
        }
      );
    });
    await TemplateModel.insertMany(templates);

    // --- Default Shopify Scenario ---
    const defaultScenario = {
      userId: savedUser._id,
      name: "Shopify scenario",
      description: "",
      type: "shopify",
      routerBranches: [
        {
          id: 2,
          hasModule: false,
          condition: null,
          modules: [
            {
              id: "1759389173211",
              app: {
                name: "Gmail",
                color: "bg-red-500",
                icon: "Gmail",
              },
              subject: "",
              cc: [],
              bcc: [],
              type: "Send an Email",
              description: "Send an email via Gmail",
              connectionId: "",
              template: "Initial Email",
              delayValue: 5,
              delayUnit: "seconds",
              filter: { conditions: [] },
            },
            {
              id: "1759389175969",
              app: {
                name: "Delay",
                color: "bg-blue-500",
                icon: "Delay",
              },
              subject: "",
              cc: [],
              bcc: [],
              type: "",
              description: "",
              connectionId: "",
              template: "",
              delayValue: 5,
              delayUnit: "seconds",
              filter: { conditions: [] },
            },
            {
              id: "1759389185521",
              app: {
                name: "Gmail",
                color: "bg-red-500",
                icon: "Gmail",
              },
              subject: "",
              cc: [],
              bcc: [],
              type: "Send an Email",
              description: "Send an email via Gmail",
              connectionId: "",
              template: "First Email",
              delayValue: 5,
              delayUnit: "seconds",
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
      message: "Successfully registered",
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
      return res.status(404).json({ error: 'User not found' });
    }

    const latestEmail = await EmailModel.findOne({
      userId: id,
      verificationUrl: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json({
      message: 'User fetched successfully',
      data: {
        ...user.toObject(),
        verificationUrl: latestEmail?.verificationUrl || null,
        verificationCode: latestEmail?.verificationCode || null,
      },
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
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


export const completeSetup=async(req,res)=>{
    try {
    const { id } = req.params;

    const user = await authModel.findByIdAndUpdate(
      id,
      { $set: req.body }, 
      { new: true }
    );

    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ success: true, data: user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update setup" });
  }
}

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
        if (window.opener) {
          // inform parent page
          window.opener.postMessage(
            { type: "google-auth-success", connectionId: "${connection._id}" },
            "*"
          );
          // close after short delay
          setTimeout(() => window.close(), 1000);
        }
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
        provider: 'outlook',
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

// export const validateConnection = async (connectionId) => {
//   try {
//     const connection = await ConnectionModel.findById(connectionId);
//     if (!connection) {
//       throw new Error('Connection not found');
//     }

//     const oauth2Client = new google.auth.OAuth2(
//       CLIENT_ID,
//       CLIENT_SECRET,
//       REDIRECT_URI
//     );

//     oauth2Client.setCredentials(connection.tokens);
//     setupTokenRefresh(oauth2Client, connectionId);

//     // Test the connection
//     const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
//     await gmail.users.getProfile({ userId: 'me' });

//     await ConnectionModel.updateOne(
//       { _id: connectionId },
//       { $set: { status: 'active', lastValidated: new Date() } }
//     );

//     return true;
//   } catch (error) {
//     console.error('❌ Connection validation failed:', error);
//     await ConnectionModel.updateOne(
//       { _id: connectionId },
//       { $set: { status: 'inactive' } }
//     );
//     return false;
//   }
// };

// const SCOPES = [
//   'https://www.googleapis.com/auth/gmail.addons.current.action.compose',
//   'https://www.googleapis.com/auth/gmail.addons.current.message.action',
//   // 'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
//   'https://www.googleapis.com/auth/gmail.addons.current.message.readonly',
//   'https://www.googleapis.com/auth/gmail.labels',
//   'https://www.googleapis.com/auth/gmail.send',
//   'https://www.googleapis.com/auth/gmail.readonly',
//   'https://www.googleapis.com/auth/gmail.compose',
//   'https://www.googleapis.com/auth/gmail.insert',
//   'https://www.googleapis.com/auth/gmail.modify',
//   'https://www.googleapis.com/auth/gmail.metadata',
//   'https://www.googleapis.com/auth/gmail.settings.basic',
//   'https://www.googleapis.com/auth/gmail.settings.sharing',
// 'https://mail.google.com/' ,
//   'https://www.googleapis.com/auth/userinfo.email',
//   'https://www.googleapis.com/auth/userinfo.profile'
// ];

// export const EmailWebhook = async (req, res) => {
//   console.log(
//     '➡️ [EmailWebhook] Incoming Request Body:',
//     JSON.stringify(req.body, null, 2)
//   );

//   try {
//     const message = req.body.message;
//     console.log('📩 [Step 1] Extracted message:', message);

//     if (!message || !message.data) {
//       console.warn('⚠️ [Step 1] No Pub/Sub message or data field found.');
//       return res.status(400).send('No Pub/Sub message');
//     }

//     const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
//     console.log('📦 [Step 2] Decoded Base64 Data:', decoded);

//     let data;
//     try {
//       data = JSON.parse(decoded);
//       console.log('🔔 [Step 2] Parsed Pub/Sub Data:', data);
//     } catch (parseErr) {
//       console.error('❌ [Step 2] Failed to parse Pub/Sub data:', parseErr);
//       return res.status(400).send('Invalid Pub/Sub message format');
//     }

//     console.log('🔎 [Step 3] Looking up connection for email:', data.emailAddress);
//     const connection = await ConnectionModel.findOne({
//       email: data.emailAddress,
//       provider: 'gmail',
//       status: 'active'
//     });

//     if (!connection) {
//       console.warn('⚠️ [Step 3] No active Gmail connection found for email:', data.emailAddress);
//       return res.status(200).send();
//     }
//     console.log('✅ [Step 3] Connection found:', connection.email);

//     console.log('🔐 [Step 4] Creating OAuth2 client...');
//     const oauth2Client = new google.auth.OAuth2(
//       CLIENT_ID,
//       CLIENT_SECRET,
//       REDIRECT_URI
//     );

//     oauth2Client.setCredentials(connection.tokens);

//     oauth2Client.on('tokens', async (tokens) => {
//       console.log('🔄 [Step 4] Refreshing tokens...');
//       try {
//         await ConnectionModel.updateOne(
//           { _id: connection._id },
//           {
//             $set: {
//               tokens: {
//                 ...connection.tokens,
//                 ...tokens
//               }
//             }
//           }
//         );
//         console.log('✅ [Step 4] Tokens refreshed and saved');
//       } catch (err) {
//         console.error('❌ [Step 4] Failed to save refreshed tokens:', err);
//       }
//     });

//     console.log('🔑 [Step 4] OAuth2 credentials set.');

//     const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
//     console.log('📮 [Step 4] Gmail client initialized.');

//     console.log('📡 [Step 5] Fetching Gmail history for historyId:', data.historyId);

//     let history;
//     try {
//       history = await gmail.users.history.list({
//         userId: 'me',
//         startHistoryId: data.historyId,
//         historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
//       });
//     } catch (err) {
//       console.error('❌ [Step 5] Failed to fetch Gmail history:', err.message);

//       if (err.code === 401 || err.message.includes('refresh token')) {
//         console.log('🔄 [Step 5] Attempting token refresh...');
//         try {
//           await oauth2Client.getAccessToken();
//           history = await gmail.users.history.list({
//             userId: 'me',
//             startHistoryId: data.historyId,
//             historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'],
//           });
//           console.log('✅ [Step 5] Retry successful after token refresh');
//         } catch (retryErr) {
//           console.error('❌ [Step 5] Retry failed:', retryErr.message);
//           await ConnectionModel.updateOne(
//             { _id: connection._id },
//             { $set: { status: 'inactive' } }
//           );
//           return res.status(200).send();
//         }
//       } else {
//         return res.status(200).send();
//       }
//     }

//     console.log('📨 [Step 5] Gmail History API Response:', history.data);

//     if (history.data.historyId) {
//       await ConnectionModel.updateOne(
//         { _id: connection._id },
//         { $set: { lastHistoryId: history.data.historyId } }
//       );
//       console.log("💾 [Step 5] Updated connection's lastHistoryId:", history.data.historyId);
//     }

//     if (!history.data.history) {
//       console.log('ℹ️ [Step 5] No history records found → fallback to listing latest emails.');

//       const list = await gmail.users.messages.list({
//         userId: 'me',
//         maxResults: 5,
//       });

//       if (list.data.messages) {
//         for (const msg of list.data.messages) {
//           await processMessage(gmail, msg.id, connection);
//         }
//       }

//       return res.status(200).send();
//     }

//     for (const record of history.data.history) {
//       console.log('🔎 [Step 6] Processing record:', JSON.stringify(record, null, 2));

//       if (!record.messagesAdded) {
//         console.warn('⚠️ [Step 6] Record has no messagesAdded.');
//         continue;
//       }

//       for (const added of record.messagesAdded) {
//         await processMessage(gmail, added.message.id, connection);
//       }
//     }

//     console.log('🏁 [Step 9] Webhook processing complete.');
//     res.status(200).send();
//   } catch (err) {
//     console.error('❌ [Global Catch] Webhook Error:', err);
//     res.status(500).send('Server error');
//   }
// };

// const decodeBase64 = (data) => {
//   if (!data) return '';
//   return Buffer.from(
//     data.replace(/-/g, '+').replace(/_/g, '/'),
//     'base64'
//   ).toString('utf8');
// };

// export const processMessage = async (gmail, msgId, user) => {
//   console.log('📥 [ProcessMessage] Fetching message (full):', msgId);

//   let fullMessage;
//   try {
//     fullMessage = await gmail.users.messages.get({
//       userId: 'me',
//       id: msgId,
//       format: 'full',
//     });
//   } catch (err) {
//     console.error(' [ProcessMessage] Failed to fetch message:', err.message);
//     return;
//   }

//   const headers = fullMessage.data.payload.headers || [];
//   const subject = headers.find((h) => h.name === 'Subject')?.value || '';
//   const from = headers.find((h) => h.name === 'From')?.value || '';
//   const to = headers.filter((h) => h.name === 'To').map((h) => h.value);
//   const cc = headers.filter((h) => h.name === 'Cc').map((h) => h.value);
//   const bcc = headers.filter((h) => h.name === 'Bcc').map((h) => h.value);
//   const dateHeader = headers.find((h) => h.name === 'Date')?.value || '';
//   const dateReceived = dateHeader ? new Date(dateHeader) : new Date();
//   const snippet = fullMessage.data.snippet || '';

//   let body = '';

//   const getBody = (parts) => {
//     if (!parts) return;
//     for (const part of parts) {
//       if (part.mimeType === 'text/plain' && part.body?.data) {
//         body += decodeBase64(part.body.data) + '\n';
//       }
//       if (part.mimeType === 'text/html' && part.body?.data) {
//         body += decodeBase64(part.body.data) + '\n';
//       }
//       if (part.parts) {
//         getBody(part.parts);
//       }
//     }
//   };

//   if (fullMessage.data.payload?.parts) {
//     getBody(fullMessage.data.payload.parts);
//   } else if (fullMessage.data.payload?.body?.data) {
//     body = decodeBase64(fullMessage.data.payload.body.data);
//   }

//   console.log(' [ProcessMessage] Subject:', subject);

//   if (!subject.toLowerCase().includes('shopify expert directory')) {
//     console.log(' [ProcessMessage] Subject does not match filter, skipping.');
//     return;
//   }

//   try {
//     const saved = await EmailModel.create({
//       userId: user._id,
//       subject,
//       from,
//       to,
//       cc,
//       bcc,
//       body,
//       snippet,
//       dateReceived,
//       threadId: fullMessage.data.threadId,
//       messageId: msgId,
//     });
//     console.log('💾 [ProcessMessage] Email saved to DB with ID:', saved._id);
//   } catch (dbErr) {
//     console.error(
//       ' [ProcessMessage] Failed to save email to DB:',
//       dbErr.message
//     );
//   }
// };

// const processMessage = async (gmail, msgId, connection) => {
//   console.log('📥 [ProcessMessage] Fetching message (full):', msgId);

//   let fullMessage;
//   try {
//     fullMessage = await gmail.users.messages.get({
//       userId: 'me',
//       id: msgId,
//       format: 'full',
//     });
//   } catch (err) {
//     console.error('❌ [ProcessMessage] Failed to fetch message:', err.message);
//     return;
//   }

//   const headers = fullMessage.data.payload.headers || [];
//   const subject = headers.find((h) => h.name === 'Subject')?.value || '';
//   const from = headers.find((h) => h.name === 'From')?.value || '';
//   const to = headers.filter((h) => h.name === 'To').map((h) => h.value);
//   const cc = headers.filter((h) => h.name === 'Cc').map((h) => h.value);
//   const bcc = headers.filter((h) => h.name === 'Bcc').map((h) => h.value);
//   const dateHeader = headers.find((h) => h.name === 'Date')?.value || '';
//   const dateReceived = dateHeader ? new Date(dateHeader) : new Date();
//   const snippet = fullMessage.data.snippet || '';

//   let body = '';

//   const getBody = (parts) => {
//     if (!parts) return;
//     for (const part of parts) {
//       if (part.mimeType === 'text/plain' && part.body?.data) {
//         body += decodeBase64(part.body.data) + '\n';
//       }
//       if (part.mimeType === 'text/html' && part.body?.data) {
//         body += decodeBase64(part.body.data) + '\n';
//       }
//       if (part.parts) {
//         getBody(part.parts);
//       }
//     }
//   };

//   if (fullMessage.data.payload?.parts) {
//     getBody(fullMessage.data.payload.parts);
//   } else if (fullMessage.data.payload?.body?.data) {
//     body = decodeBase64(fullMessage.data.payload.body.data);
//   }

//   console.log('📋 [ProcessMessage] Subject:', subject);

//   // Check if the subject contains the required string
//   if (!subject.toLowerCase().includes('shopify partner directory')) {
//     console.log('ℹ️ [ProcessMessage] Subject does not match the filter, skipping.');
//     return;
//   }

//   // Fetch templates for the "shopify" platform from the database
//   const templates = await TemplateModel.findOne({ platform: 'shopify' });

//   if (!templates) {
//     console.log('❌ [ProcessMessage] No templates found for this platform.');
//     return;
//   }

//   // List of available services in templates
//   const services = templates.templates.map(template => template.name);
//   let serviceFound = null;

//   // Check if any of the services are mentioned in the email body
//   for (const service of services) {
//     if (body.toLowerCase().includes(service.toLowerCase())) {
//       serviceFound = service;
//       break;
//     }
//   }

//   if (!serviceFound) {
//     console.log('ℹ️ [ProcessMessage] No matching service found in the email body.');
//     return;
//   }

//   console.log('✅ [ProcessMessage] Service found:', serviceFound);

//   // Save the email to the database with the matched service
//   try {
//     const saved = await EmailModel.create({
//       userId: connection.userId, // Use connection.userId instead of user._id
//       subject,
//       from,
//       to,
//       cc,
//       bcc,
//       body,
//       snippet,
//       dateReceived,
//       service: serviceFound,
//       threadId: fullMessage.data.threadId,
//       messageId: msgId,
//     });
//     console.log('💾 [ProcessMessage] Email saved to DB with ID:', saved._id);

//     // Send a reply based on the detected service
//     await sendReply(gmail, serviceFound, from, connection);
//   } catch (dbErr) {
//     console.error('❌ [ProcessMessage] Failed to save email to DB:', dbErr.message);
//   }
// };

// const sendReply = async (gmail, service, to, connection) => {
//   const subject = `Re: Your inquiry about ${service}`;
//   let body = '';

//   try {
//     const templates = await TemplateModel.findOne({ platform: 'shopify' });

//     if (!templates) {
//       console.log('❌ [sendReply] No templates found for this platform.');
//       return;
//     }

//     const isServiceAvailable = templates.templates.some(
//       (template) => template.name.toLowerCase() === service.toLowerCase()
//     );

//     if (isServiceAvailable) {
//       body = `
//         Hello,

//         Thank you for reaching out to us regarding ${service}. We are happy to assist you with this service for your Shopify store.

//         If you need further information or assistance, feel free to reply to this email.

//         Best regards,
//         Your Shopify Expert Team
//       `;
//     } else {
//       body = `
//         Hello,

//         Thank you for your inquiry about ${service}. Unfortunately, we currently do not have details about this service.

//         However, please feel free to reach out to us for more information or further assistance.

//         Best regards,
//         Your Shopify Expert Team
//       `;
//     }

//     const rawMessage = makeMessage(to, subject, body);

//     await gmail.users.messages.send({
//       userId: 'me',
//       requestBody: {
//         raw: rawMessage,
//       },
//     });
//     console.log(`💌 [sendReply] Email sent to ${to} for service: ${service}`);
//   } catch (err) {
//     console.error(`❌ [sendReply] Failed to send reply: ${err.message}`);
//   }
// };

//  const setupTokenRefresh = (oauth2Client, connectionId) => {
//   oauth2Client.on('tokens', async (tokens) => {
//     try {
//       await ConnectionModel.updateOne(
//         { _id: connectionId },
//         {
//           $set: {
//             tokens: tokens,
//             lastTokenRefresh: new Date()
//           }
//         }
//       );
//       console.log('✅ Tokens refreshed and saved for connection:', connectionId);
//     } catch (err) {
//       console.error('❌ Failed to save refreshed tokens:', err);
//     }
//   });
// };

// const makeMessage = (to, subject, body) => {
//   const message = [
//     `To: ${to}`,
//     `Subject: ${subject}`,
//     'Content-Type: text/html; charset=UTF-8',
//     'MIME-Version: 1.0',
//     '',
//     body,
//   ].join('\n');

//   // Base64 encode the message
//   return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
// };

// async function startWatch(oauthTokens) {
//   const oauth2Client = new google.auth.OAuth2(
//     CLIENT_ID,
//     CLIENT_SECRET,
//     REDIRECT_URI
//   );
//   oauth2Client.setCredentials(oauthTokens);

//   const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

//   const res = await gmail.users.watch({
//     userId: 'me',
//     requestBody: {
//       topicName: 'projects/email-syncing-472610/topics/gmail-notifications',
//     },
//   });

//   console.log('✅ Watch started:', res.data);
//   return res.data;
// }

// export const getEmail = async (req, res) => {
//   let tokens;

//   try {
//     const user = await authModel.findOne({ googleId: req.userId });
//     tokens = user.tokens;
//     oauth2Client.setCredentials(tokens);

//     const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

//     const response = await gmail.users.messages.list({
//       userId: 'me',
//       labelIds: ['INBOX'],
//       q: 'subject:"Shopify Partner Directory"',
//     });

//     const messages = response.data.messages || [];

//     const emailDetails = [];

//     for (const message of messages) {
//       const email = await gmail.users.messages.get({
//         userId: 'me',
//         id: message.id,
//       });

//       const headers = email.data.payload.headers || [];
//       const body = email.data.payload.parts
//         ? email.data.payload.parts[0].body.data
//         : '';
//       const decodedBody = Buffer.from(body, 'base64').toString('utf-8');

//       const from = headers.find((header) => header.name === 'From')?.value;
//       const to = headers
//         .filter((header) => header.name === 'To')
//         .map((header) => header.value);
//       const bcc = headers
//         .filter((header) => header.name === 'Bcc')
//         .map((header) => header.value);
//       const cc = headers
//         .filter((header) => header.name === 'Cc')
//         .map((header) => header.value);
//       const subject = headers.find(
//         (header) => header.name === 'Subject'
//       )?.value;
//       const dateReceived = new Date(parseInt(email.data.internalDate));

//       const emailData = {
//         userId: user._id,
//         subject,
//         from,
//         to,
//         bcc,
//         cc,
//         body: decodedBody,
//         snippet: email.data.snippet,
//         dateReceived,
//         threadId: email.data.threadId,
//         messageId: email.data.id,
//       };

//       const newEmail = new EmailModel(emailData);
//       await newEmail.save();

//       emailDetails.push(emailData);
//     }

//     res.json(emailDetails);
//   } catch (error) {
//     console.error('Error syncing emails: ', error);
//     res.status(500).send('Error syncing emails');
//   }
// };

// export const savePlatformForUser = async (req, res) => {
//   try {
//     const { userId, platform } = req.body;

//     if (!userId || !platform) {
//       return res.status(400).json({
//         error: "userId and platform are required"
//       });
//     }

//     // Use '_id' as the unique identifier for the user
//     const user = await authModel.findById(userId); // Use findById instead of findOne({ id: userId })

//     if (!user) {
//       return res.status(404).json({ error: "User not found" });
//     }

//     // Set the platform
//     user.selectedPlatform = platform;

//     // Save the updated user data
//     await user.save();

//     res.json({ message: "Platform saved successfully", user });
//   } catch (err) {
//     console.error("Failed to save platform:", err.message);
//     res.status(500).json({ error: "Server error" });
//   }
// };
// ;
