import { authModel } from '../Models/auth.js';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import fs from 'fs';
import { PubSub } from '@google-cloud/pubsub';
import axios from 'axios';

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
const CLIENT_SECRET =  process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI =  process.env.GOOGLE_REDIRECT_URI;  // Make sure this matches your backend port
console.log("CLIENT_ID",CLIENT_ID)
console.log("CLIENT_SECRET",CLIENT_SECRET)
console.log("REDIRECT_URI",REDIRECT_URI)

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.addons.current.action.compose', 
  'https://www.googleapis.com/auth/gmail.addons.current.message.action', 
  'https://www.googleapis.com/auth/gmail.addons.current.message.metadata',
  'https://www.googleapis.com/auth/gmail.addons.current.message.readonly', 
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.send', 
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose', 
  'https://www.googleapis.com/auth/gmail.insert', 
  'https://www.googleapis.com/auth/gmail.modify', 
  'https://www.googleapis.com/auth/gmail.metadata',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/gmail.settings.sharing',
  'https://mail.google.com/' ,
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

export const googleAuth = (req, res) => {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', 
        scope: SCOPES,
    });

    console.log("Generated Google OAuth URL:", authUrl); 
    
    res.redirect(authUrl);  
};
export const googleAuthCallback = async (req, res) => {
    const { code } = req.query;

    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        const peopleApi = google.people({ version: 'v1', auth: oauth2Client });
        const response = await peopleApi.people.get({
            resourceName: 'people/me',
            personFields: 'emailAddresses,names',
        });

        const userEmail = response.data.emailAddresses[0].value;
        const googleId = response.data.resourceName;

        let user = await authModel.findOne({ googleId });

        if (!user) {
            user = new authModel({
                googleId,
                email: userEmail,
                tokens, 
            });
        } else {
            user.tokens = tokens;
        }

        await user.save();
    await startWatch(tokens);

        res.send('Gmail Sync Successful! You can now access your Gmail data.');
    } catch (error) {
        console.error('Error during token exchange: ', error);
        res.status(500).send('Error during authentication');
    }
};



export const EmailWebhook = async (req, res) => {
  console.log("➡️ [EmailWebhook] Incoming Request Body:", JSON.stringify(req.body, null, 2));

  try {
    // Step 1: Validate Pub/Sub message
    const message = req.body.message;
    console.log("📩 [Step 1] Extracted message:", message);

    if (!message || !message.data) {
      console.warn("⚠️ [Step 1] No Pub/Sub message or data field found.");
      return res.status(400).send("No Pub/Sub message");
    }

    // Step 2: Decode and parse data
    const decoded = Buffer.from(message.data, "base64").toString("utf-8");
    console.log("📦 [Step 2] Decoded Base64 Data:", decoded);

    let data;
    try {
      data = JSON.parse(decoded);
      console.log("🔔 [Step 2] Parsed Pub/Sub Data:", data);
    } catch (parseErr) {
      console.error("❌ [Step 2] Failed to parse Pub/Sub data:", parseErr);
      return res.status(400).send("Invalid Pub/Sub message format");
    }

    // Step 3: Find user
    console.log("🔎 [Step 3] Looking up user for email:", data.emailAddress);
    const user = await authModel.findOne({ email: data.emailAddress });

    if (!user) {
      console.warn("⚠️ [Step 3] No user found for email:", data.emailAddress);
      return res.status(200).send();
    }
    console.log("✅ [Step 3] User found:", user.email);

    // Step 4: Prepare Gmail API client
    console.log("🔐 [Step 4] Creating OAuth2 client...");
    const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    oauth2Client.setCredentials(user.tokens);
    console.log("🔑 [Step 4] OAuth2 credentials set.");

    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    console.log("📮 [Step 4] Gmail client initialized.");

    // Step 5: Fetch Gmail history
    console.log("📡 [Step 5] Fetching Gmail history for historyId:", data.historyId);
    const history = await gmail.users.history.list({
      userId: "me",
      startHistoryId: data.historyId,
      historyTypes: ["messageAdded"],
    });

    console.log("📨 [Step 5] Gmail History API Response:", history.data);

    if (!history.data.history) {
      console.log("ℹ️ [Step 5] No history records found.");
      return res.status(200).send();
    }

    // Step 6: Loop through records
    for (const record of history.data.history) {
      console.log("🔎 [Step 6] Processing record:", JSON.stringify(record, null, 2));

      if (!record.messagesAdded) {
        console.warn("⚠️ [Step 6] Record has no messagesAdded.");
        continue;
      }

      // Step 7: Loop through added messages
      for (const added of record.messagesAdded) {
        const msgId = added.message.id;
        console.log("🔔 [Step 7] Checking message ID:", msgId);

        let fullMessage;
        try {
          console.log("📥 [Step 7] Fetching full message:", msgId);
          fullMessage = await gmail.users.messages.get({
            userId: "me",
            id: msgId,
            format: "full",
          });
          console.log("📨 [Step 7] Full message fetched successfully:", JSON.stringify(fullMessage.data, null, 2));
        } catch (err) {
          console.error("❌ [Step 7] Failed to fetch message:", err.message);
          continue;
        }

        const headers = fullMessage.data.payload.headers || [];
        console.log("📑 [Step 7] Message headers:", headers);

        const subject = headers.find(h => h.name === "Subject")?.value || "";
        console.log("📧 [Step 7] Subject extracted:", subject);

        // Step 8: Check subject match
        if (subject.toLowerCase().includes("shopify expert directory")) {
          console.log("✅ [Step 8] Subject matches filter → Preparing to save to DB.");

          try {
            const saved = await EmailModel.create({
              userId: user._id,
              subject,
              from: headers.find(h => h.name === "From")?.value,
              to: headers.filter(h => h.name === "To").map(h => h.value),
              snippet: fullMessage.data.snippet,
              dateReceived: new Date(parseInt(fullMessage.data.internalDate)),
              threadId: fullMessage.data.threadId,
              messageId: msgId,
            });

            console.log("💾 [Step 8] Email saved to DB with ID:", saved._id);
          } catch (dbErr) {
            console.error("❌ [Step 8] Failed to save email to DB:", dbErr.message);
          }
        } else {
          console.log("🚫 [Step 8] Subject does not match filter, skipping.");
        }
      }
    }

    console.log("🏁 [Step 9] Webhook processing complete.");
    res.status(200).send();
  } catch (err) {
    console.error("❌ [Global Catch] Webhook Error:", err);
    res.status(500).send("Server error");
  }
};



async function startWatch(oauthTokens) {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials(oauthTokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: "projects/email-syncing-472610/topics/gmail-notifications", 
    },
  });

  console.log("✅ Watch started:", res.data);
  return res.data;
}

async function fetchHistoryEmails(oauthTokens, userId, historyId) {
  console.log("➡️ [fetchHistoryEmails] Called with:", { userId, historyId });

  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials(oauthTokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  // 🔎 Check granted scopes (optional but useful)
  try {
    const info = await oauth2Client.getTokenInfo(oauthTokens.access_token);
    console.log("🔑 Granted scopes:", info.scopes);
  } catch (err) {
    console.warn("⚠️ Could not fetch token info:", err.message);
  }

  console.log("📡 Fetching history from Gmail...");
  const historyRes = await gmail.users.history.list({
    userId: "me",
    startHistoryId: historyId,
    historyTypes: ["messageAdded"],
  });

  console.log("📨 History API Response:", historyRes.data);

  // 👉 If no history records, fallback to fetch recent messages
  if (!historyRes.data.history) {
    console.warn("⚠️ No history records found. Fetching recent messages instead...");
    const listRes = await gmail.users.messages.list({
      userId: "me",
      maxResults: 5,
    });

    if (!listRes.data.messages) {
      console.warn("⚠️ No recent messages found either.");
      return;
    }

    for (let msg of listRes.data.messages) {
      await fetchAndSaveMessage(gmail, msg.id, userId, true);
    }
    return;
  }

  // 👉 Process normal history records
  for (let record of historyRes.data.history) {
    console.log("🔎 Processing record:", record);

    if (!record.messagesAdded) {
      console.warn("⚠️ No messagesAdded in this record.");
      continue;
    }

    for (let msg of record.messagesAdded) {
      await fetchAndSaveMessage(gmail, msg.message.id, userId, false);
    }
  }

  console.log("🏁 [fetchHistoryEmails] Processing complete.");
}

async function fetchAndSaveMessage(gmail, messageId, userId, isFallbackList) {
  console.log(`🔔 Fetching message ${messageId} (format: full)`);
  let fullMessage;

  try {
    fullMessage = await gmail.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    });
  } catch (err) {
    if (err?.code === 403 && err?.message?.includes("Metadata scope")) {
      console.warn("⚠️ FULL format denied by scope, retrying with METADATA...");
      fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "To", "Date"],
      });
    } else {
      console.error("❌ Error fetching message:", err);
      return;
    }
  }

  const headers = fullMessage.data.payload.headers || [];
  const subject = headers.find(h => h.name === "Subject")?.value || "";

  console.log(`📧 Subject received${isFallbackList ? " [Fallback]" : ""}:`, subject);

  if (subject.toLowerCase().includes("shopify experts directory")) {
    console.log("✅ Subject matched filter. Saving to DB...");
    try {
      const savedEmail = await EmailModel.create({
        userId,
        subject,
        from: headers.find(h => h.name === "From")?.value,
        to: headers.filter(h => h.name === "To").map(h => h.value),
        snippet: fullMessage.data.snippet,
        dateReceived: new Date(parseInt(fullMessage.data.internalDate || Date.now())),
        threadId: fullMessage.data.threadId,
        messageId,
      });
      console.log("💾 Saved to DB:", savedEmail);
    } catch (dbError) {
      console.error("❌ Error saving to DB:", dbError);
    }
  } else {
    console.log("🚫 Subject did NOT match filter, skipping.");
  }
}



export const getEmails=async(req,res)=>{
  try {
    const result =EmailModel.find()
    res.send(result)
  } catch (error) {
    
  }
}

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
            const body = email.data.payload.parts ? email.data.payload.parts[0].body.data : ''; 
            const decodedBody = Buffer.from(body, 'base64').toString('utf-8'); 

            const from = headers.find(header => header.name === 'From')?.value;
            const to = headers.filter(header => header.name === 'To').map(header => header.value);
            const bcc = headers.filter(header => header.name === 'Bcc').map(header => header.value);
            const cc = headers.filter(header => header.name === 'Cc').map(header => header.value);
            const subject = headers.find(header => header.name === 'Subject')?.value;
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