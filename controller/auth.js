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


const CLIENT_ID = "1072288734636-og1s7nku04nb0gf56v53gr8uar1tjjpq.apps.googleusercontent.com";
const CLIENT_SECRET = "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";
const REDIRECT_URI = 'https://email-syncing-backend.vercel.app/auth/google/callback';  // Make sure this matches your backend port
console.log(CLIENT_ID)
console.log(CLIENT_SECRET)


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

export const EmailWebhook=async(req,res)=>{
   try {
    const message = req.body.message;

    if (!message || !message.data) {
      return res.status(400).send("No Pub/Sub message received");
    }

    const dataBuffer = Buffer.from(message.data, "base64").toString("utf-8");
    const data = JSON.parse(dataBuffer);

    console.log("🔔 Pub/Sub Notification:", data);


    const user = await authModel.findOne({ email: data.emailAddress });
    if (user) {
      await fetchHistoryEmails(user.tokens, user._id, data.historyId);
    }

    res.status(200).send();
  } catch (err) {
    console.error("❌ PubSub error:", err);
    res.status(500).send();
  }
}



async function startWatch(oauthTokens) {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials(oauthTokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: "projects/YOUR_PROJECT_ID/topics/YOUR_TOPIC_NAME", 
    },
  });

  console.log("✅ Watch started:", res.data);
  return res.data;
}

async function fetchHistoryEmails(oauthTokens, userId, historyId) {
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
  oauth2Client.setCredentials(oauthTokens);

  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  const historyRes = await gmail.users.history.list({
    userId: "me",
    startHistoryId: historyId,
    historyTypes: ["messageAdded"],
  });

  if (!historyRes.data.history) return;

  for (let record of historyRes.data.history) {
    if (!record.messagesAdded) continue;

    for (let msg of record.messagesAdded) {
      const fullMessage = await gmail.users.messages.get({
        userId: "me",
        id: msg.message.id,
        format: "full",
      });

      const headers = fullMessage.data.payload.headers;
      const subject = headers.find(h => h.name === "Subject")?.value || "";

      if (subject.toLowerCase().includes("shopify experts directory")) {
        console.log("📩 Real-time matched mail:", subject);

        await EmailModel.create({
          userId,
          subject,
          from: headers.find(h => h.name === "From")?.value,
          to: headers.filter(h => h.name === "To").map(h => h.value),
          snippet: fullMessage.data.snippet,
          dateReceived: new Date(parseInt(fullMessage.data.internalDate)),
          threadId: fullMessage.data.threadId,
          messageId: msg.message.id,
        });
      }
    }
  }
}