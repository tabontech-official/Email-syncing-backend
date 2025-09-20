import { authModel } from '../Models/auth.js';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fs from 'fs';
import { PubSub } from '@google-cloud/pubsub';
import axios from 'axios';
import { EmailModel } from '../Models/Email.js';
import { ConnectionModel } from '../Models/Connection.js';

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

    // Create new user
    const newUser = new authModel(req.body);
    const saveUser = await newUser.save();

    // Include role in the token
    const token = createToken({ _id: saveUser._id, role: saveUser.role });

    res.send({
      message: 'Successfully registered',
      token,
      data: saveUser,
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

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

// const CLIENT_ID = "1072288734636-og1s7nku04nb0gf56v53gr8uar1tjjpq.apps.googleusercontent.com";
// const CLIENT_SECRET = "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";
// const REDIRECT_URI = "http://localhost:5000/auth/google/callback";
console.log('CLIENT_ID', CLIENT_ID);
console.log('CLIENT_SECRET', CLIENT_SECRET);
console.log('REDIRECT_URI', REDIRECT_URI);

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

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

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly', 
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send', 
  'https://www.googleapis.com/auth/userinfo.email', 
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://mail.google.com/',
];

export const googleAuth = (req, res) => {
  const { userId } = req.query; // frontend must send ?userId=xxxx

  if (!userId) {
    return res.status(400).send("userId is required");
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent", // ensure refresh_token is always returned
    state: JSON.stringify({ userId }), // 🔑 send userId via state
  });

  console.log("Generated Google OAuth URL:", authUrl);

  res.redirect(authUrl);
};
export const googleAuthCallback = async (req, res) => {
  const { code, state } = req.query; 

  let userId;
  try {
    const parsedState = JSON.parse(state);
    userId = parsedState.userId;
  } catch (err) {
    console.error("❌ Failed to parse state:", err);
    return res.status(400).send("Invalid state parameter");
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get Google profile
    const peopleApi = google.people({ version: "v1", auth: oauth2Client });
    const response = await peopleApi.people.get({
      resourceName: "people/me",
      personFields: "emailAddresses,names",
    });

    const userEmail = response.data.emailAddresses?.[0]?.value;
    const userName = response.data.names?.[0]?.displayName || "";

    if (!userEmail) {
      return res.status(400).send("No email found in Google profile");
    }

    // Find or create connection
    let connection = await ConnectionModel.findOne({ userId, email: userEmail });

    if (!connection) {
      connection = new ConnectionModel({
        userId,
        provider: "gmail",
        email: userEmail,
        name: userName,
        tokens,
      });
    } else {
      connection.tokens = tokens;
      connection.status = "active";
    }

    await connection.save();

    await startWatch(tokens);

    return res.redirect("http://localhost:3006/connection");
  } catch (error) {
    console.error("❌ Error during Google auth callback:", error);
    return res.redirect("http://localhost:3006/connection?status=error");
  }
};

// export const googleAuthCallback = async (req, res) => {
//   const { code } = req.query;

//   try {
//     const { tokens } = await oauth2Client.getToken(code);
//     oauth2Client.setCredentials(tokens);

//     const peopleApi = google.people({ version: 'v1', auth: oauth2Client });
//     const response = await peopleApi.people.get({
//       resourceName: 'people/me',
//       personFields: 'emailAddresses,names',
//     });

//     const userEmail = response.data.emailAddresses[0].value;
//     const googleId = response.data.resourceName;

//     let user = await authModel.findOne({ googleId });

//     if (!user) {
//       user = new authModel({
//         googleId,
//         email: userEmail,
//         tokens,
//       });
//     } else {
//       user.tokens = tokens;
//     }

//     await user.save();
//     await startWatch(tokens);

//     res.send('Gmail Sync Successful! You can now access your Gmail data.');
//   } catch (error) {
//     console.error('Error during token exchange: ', error);
//     res.status(500).send('Error during authentication');
//   }
// };


export const EmailWebhook = async (req, res) => {
  console.log(
    '➡️ [EmailWebhook] Incoming Request Body:',
    JSON.stringify(req.body, null, 2)
  );

  try {
    const message = req.body.message;
    console.log('📩 [Step 1] Extracted message:', message);

    if (!message || !message.data) {
      console.warn('⚠️ [Step 1] No Pub/Sub message or data field found.');
      return res.status(400).send('No Pub/Sub message');
    }

    const decoded = Buffer.from(message.data, 'base64').toString('utf-8');
    console.log('📦 [Step 2] Decoded Base64 Data:', decoded);

    let data;
    try {
      data = JSON.parse(decoded);
      console.log('🔔 [Step 2] Parsed Pub/Sub Data:', data);
    } catch (parseErr) {
      console.error('❌ [Step 2] Failed to parse Pub/Sub data:', parseErr);
      return res.status(400).send('Invalid Pub/Sub message format');
    }

    console.log('🔎 [Step 3] Looking up user for email:', data.emailAddress);
    const user = await authModel.findOne({ email: data.emailAddress });

    if (!user) {
      console.warn('⚠️ [Step 3] No user found for email:', data.emailAddress);
      return res.status(200).send();
    }
    console.log('✅ [Step 3] User found:', user.email);

    console.log('🔐 [Step 4] Creating OAuth2 client...');
    const oauth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URI
    );
    oauth2Client.setCredentials(user.tokens);
    console.log('🔑 [Step 4] OAuth2 credentials set.');

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    console.log('📮 [Step 4] Gmail client initialized.');

    console.log(
      '📡 [Step 5] Fetching Gmail history for historyId:',
      data.historyId
    );

    let history;
    try {
      history = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: data.historyId,
        historyTypes: ['messageAdded', 'labelAdded', 'labelRemoved'], 
      });
    } catch (err) {
      console.error('❌ [Step 5] Failed to fetch Gmail history:', err.message);
      return res.status(200).send();
    }

    console.log('📨 [Step 5] Gmail History API Response:', history.data);

    if (history.data.historyId) {
      await authModel.updateOne(
        { email: user.email },
        { $set: { lastHistoryId: history.data.historyId } }
      );
      console.log(
        "💾 [Step 5] Updated user's lastHistoryId:",
        history.data.historyId
      );
    }

    if (!history.data.history) {
      console.log(
        'ℹ️ [Step 5] No history records found → fallback to listing latest emails.'
      );

      const list = await gmail.users.messages.list({
        userId: 'me',
        maxResults: 5,
      });

      if (list.data.messages) {
        for (const msg of list.data.messages) {
          await processMessage(gmail, msg.id, user);
        }
      }

      return res.status(200).send();
    }

    // Step 6: Loop through records
    for (const record of history.data.history) {
      console.log(
        '🔎 [Step 6] Processing record:',
        JSON.stringify(record, null, 2)
      );

      if (!record.messagesAdded) {
        console.warn('⚠️ [Step 6] Record has no messagesAdded.');
        continue;
      }

      for (const added of record.messagesAdded) {
        await processMessage(gmail, added.message.id, user);
      }
    }

    console.log('🏁 [Step 9] Webhook processing complete.');
    res.status(200).send();
  } catch (err) {
    console.error('❌ [Global Catch] Webhook Error:', err);
    res.status(500).send('Server error');
  }
};

const decodeBase64 = (data) => {
  if (!data) return '';
  return Buffer.from(
    data.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf8');
};

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

const sendReply = async (gmail, service, to, user) => {
  const subject = `Re: Your inquiry about ${service}`;
  let body = '';

  try {
    // Fetch templates from the database (based on platform)
    const templates = await TemplateModel.findOne({ platform: 'shopify' }); // Fetch templates for "shopify"

    if (!templates) {
      console.log('❌ [sendReply] No templates found for this platform.');
      return;
    }

    // Check if the service exists in the fetched templates
    const isServiceAvailable = templates.templates.some(
      (template) => template.name.toLowerCase() === service.toLowerCase()
    );

    // If service is found, send a predefined response
    if (isServiceAvailable) {
      body = `
        Hello,

        Thank you for reaching out to us regarding ${service}. We are happy to assist you with this service for your Shopify store.

        If you need further information or assistance, feel free to reply to this email.

        Best regards,
        Your Shopify Expert Team
      `;
    } else {
      body = `
        Hello,

        Thank you for your inquiry about ${service}. Unfortunately, we currently do not have details about this service.

        However, please feel free to reach out to us for more information or further assistance.

        Best regards,
        Your Shopify Expert Team
      `;
    }

    // Prepare the email reply
    const rawMessage = makeMessage(to, subject, body);

    // Send the email using Gmail API
    await gmail.users.messages.send({
      userId: 'me',  // 'me' refers to the authenticated user
      requestBody: {
        raw: rawMessage,
      },
    });
    console.log(`💌 [sendReply] Email sent to ${to} for service: ${service}`);
  } catch (err) {
    console.error(`❌ [sendReply] Failed to send reply: ${err.message}`);
  }
};

// Function to create the raw email in base64 format
const makeMessage = (to, subject, body) => {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/html; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\n');

  // Base64 encode the message
  return Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};


export const processMessage = async (gmail, msgId, user) => {
  console.log('📥 [ProcessMessage] Fetching message (full):', msgId);

  let fullMessage;
  try {
    fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: msgId,
      format: 'full', 
    });
  } catch (err) {
    console.error(' [ProcessMessage] Failed to fetch message:', err.message);
    return;
  }

  const headers = fullMessage.data.payload.headers || [];
  const subject = headers.find((h) => h.name === 'Subject')?.value || '';
  const from = headers.find((h) => h.name === 'From')?.value || '';
  const to = headers.filter((h) => h.name === 'To').map((h) => h.value);
  const cc = headers.filter((h) => h.name === 'Cc').map((h) => h.value);
  const bcc = headers.filter((h) => h.name === 'Bcc').map((h) => h.value);
  const dateHeader = headers.find((h) => h.name === 'Date')?.value || '';
  const dateReceived = dateHeader ? new Date(dateHeader) : new Date();
  const snippet = fullMessage.data.snippet || '';

  let body = '';

  const getBody = (parts) => {
    if (!parts) return;
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body += decodeBase64(part.body.data) + '\n';
      }
      if (part.mimeType === 'text/html' && part.body?.data) {
        body += decodeBase64(part.body.data) + '\n';
      }
      if (part.parts) {
        getBody(part.parts);
      }
    }
  };

  if (fullMessage.data.payload?.parts) {
    getBody(fullMessage.data.payload.parts);
  } else if (fullMessage.data.payload?.body?.data) {
    body = decodeBase64(fullMessage.data.payload.body.data);
  }

  console.log(' [ProcessMessage] Subject:', subject);

  // Check if the subject contains the required string
  if (!subject.toLowerCase().includes('shopify expert directory')) {
    console.log(' [ProcessMessage] Subject does not match the filter, skipping.');
    return; // Skip processing if subject does not match
  }

  // Fetch templates for the "shopify" platform from the database
  const templates = await TemplateModel.findOne({ platform: 'shopify' }); // Only platform-based search

  if (!templates) {
    console.log(' [ProcessMessage] No templates found for this platform.');
    return;
  }

  // List of available services in templates
  const services = templates.templates.map(template => template.name);
  let serviceFound = null;

  // Check if any of the services are mentioned in the email body
  for (const service of services) {
    if (body.toLowerCase().includes(service.toLowerCase())) {
      serviceFound = service; // Store the matched service
      break;
    }
  }

  if (!serviceFound) {
    console.log(' [ProcessMessage] No matching service found in the email body.');
    return; // No matching service, skipping
  }

  console.log(' [ProcessMessage] Service found:', serviceFound);

  // Save the email to the database with the matched service
  try {
    const saved = await EmailModel.create({
      userId: user._id,
      subject,
      from,
      to,
      cc,
      bcc,
      body,
      snippet,
      dateReceived,
      service: serviceFound, // Save the service type (e.g., "SEO")
      threadId: fullMessage.data.threadId,
      messageId: msgId,
    });
    console.log('💾 [ProcessMessage] Email saved to DB with ID:', saved._id);

    // Send a reply based on the detected service
    await sendReply(gmail, serviceFound, from, user); // Send the reply with the matched service
  } catch (dbErr) {
    console.error(' [ProcessMessage] Failed to save email to DB:', dbErr.message);
  }
};

async function startWatch(oauthTokens) {
  const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );
  oauth2Client.setCredentials(oauthTokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const res = await gmail.users.watch({
    userId: 'me',
    requestBody: {
      topicName: 'projects/email-syncing-472610/topics/gmail-notifications',
    },
  });

  console.log('✅ Watch started:', res.data);
  return res.data;
}

export const getConnections = async (req, res) => {
  try {
    const { userId } = req.params;
    const connections = await ConnectionModel.find({ userId });
    res.json(connections);
  } catch (err) {
    console.error("❌ Failed to fetch connections:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

export const getEmail = async (req, res) => {
  let tokens;

  try {
    const user = await authModel.findOne({ googleId: req.userId });
    tokens = user.tokens;
    oauth2Client.setCredentials(tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const response = await gmail.users.messages.list({
      userId: 'me',
      labelIds: ['INBOX'],
      q: 'subject:"Shopify Partner Directory"',
    });

    const messages = response.data.messages || [];

    const emailDetails = [];

    for (const message of messages) {
      const email = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
      });

      const headers = email.data.payload.headers || [];
      const body = email.data.payload.parts
        ? email.data.payload.parts[0].body.data
        : '';
      const decodedBody = Buffer.from(body, 'base64').toString('utf-8');

      const from = headers.find((header) => header.name === 'From')?.value;
      const to = headers
        .filter((header) => header.name === 'To')
        .map((header) => header.value);
      const bcc = headers
        .filter((header) => header.name === 'Bcc')
        .map((header) => header.value);
      const cc = headers
        .filter((header) => header.name === 'Cc')
        .map((header) => header.value);
      const subject = headers.find(
        (header) => header.name === 'Subject'
      )?.value;
      const dateReceived = new Date(parseInt(email.data.internalDate));

      const emailData = {
        userId: user._id,
        subject,
        from,
        to,
        bcc,
        cc,
        body: decodedBody,
        snippet: email.data.snippet,
        dateReceived,
        threadId: email.data.threadId,
        messageId: email.data.id,
      };

      const newEmail = new EmailModel(emailData);
      await newEmail.save();

      emailDetails.push(emailData);
    }

    res.json(emailDetails);
  } catch (error) {
    console.error('Error syncing emails: ', error);
    res.status(500).send('Error syncing emails');
  }
};

export const savePlatformForUser = async (req, res) => {
  try {
    const { userId, platform } = req.body;

    if (!userId || !platform) {
      return res.status(400).json({
        error: "userId and platform are required"
      });
    }

    // Use '_id' as the unique identifier for the user
    const user = await authModel.findById(userId); // Use findById instead of findOne({ id: userId })

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Set the platform
    user.selectedPlatform = platform;

    // Save the updated user data
    await user.save();

    res.json({ message: "Platform saved successfully", user });
  } catch (err) {
    console.error("Failed to save platform:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
;