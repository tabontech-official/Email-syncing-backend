

import { google } from 'googleapis';
import { executeScenarios } from '../controller/smtpServer.js';
import { ConnectionModel } from '../Models/Connection.js';
import { EmailModel } from '../Models/Email.js';

// ------------------------------
// BODY EXTRACTOR (SAFE)
// ------------------------------
const extractBody = (payload) => {
  try {
    const parts = payload.payload?.parts || [];

    const textPart = parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }

    const htmlPart = parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
    }

    return payload.snippet || '';
  } catch (err) {
    return payload.snippet || '';
  }
};

// ------------------------------
// MAIN FUNCTION
// ------------------------------
export async function processGmailEmail(emailAddress, historyId) {
  try {
    // 1. CONNECTION
    const connection = await ConnectionModel.findOne({
      email: emailAddress,
      provider: 'gmail',
    });

    if (!connection) {
      console.log('❌ No connection found for:', emailAddress);
      return;
    }

    // 2. OAUTH
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

console.log("CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);
console.log("CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "SET" : "MISSING");
console.log("REDIRECT_URI:", process.env.GOOGLE_REDIRECT_URI);    oauth2Client.setCredentials(connection.tokens);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 3. HISTORY
    const history = await gmail.users.history.list({
      userId: 'me',
      startHistoryId: connection.gmailWatch?.historyId || historyId,
      historyTypes: ['messageAdded'],
    });

    const histories = history.data.history || [];
    const messages = histories.flatMap((h) => h.messages || []);

    if (!messages.length) {
      console.log('ℹ️ No new emails found');
      return;
    }

    // 4. PROCESS EMAILS
    for (const msg of messages) {
      try {
        if (!msg?.id) continue;

        // DUPLICATE CHECK
        const exists = await EmailModel.findOne({
          messageId: msg.id,
          direction: 'incoming',
        });

        if (exists) {
          console.log('⚠️ Duplicate skipped:', msg.id);
          continue;
        }

        // FETCH EMAIL
        const email = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
        });

        const payload = email.data;

        // ------------------------------
        // HEADERS SAFE EXTRACTION
        // ------------------------------
        const headers = payload.payload?.headers || [];

        const getHeader = (name) =>
          headers.find((h) => h.name === name)?.value || '';

        const from = getHeader('From');
        const to = getHeader('To');
        const cc = getHeader('Cc');
        const bcc = getHeader('Bcc');
        const subject = getHeader('Subject');
        const date = getHeader('Date');
        const messageIdHeader = getHeader('Message-ID');
        const inReplyTo = getHeader('In-Reply-To');
        const references = getHeader('References');

        const body = extractBody(payload);

        // ------------------------------
        // NORMALIZED EMAIL
        // ------------------------------
        const normalizedEmail = {
          emailId: msg.id,
          from,
          to,
          cc,
          bcc,
          subject,
          date,
          messageIdHeader,
          inReplyTo,
          references,
          body,
          parsedEmailObj: payload,
        };

        console.log('📩 Processing Email:', subject);

        // ------------------------------
        // SAVE EMAIL
        // ------------------------------
        const parentEmail = await EmailModel.create({
          userId: connection.userId,

          messageId: normalizedEmail.emailId,

          senderAddress: from,
          recipientAddress: to,

          cc: cc ? cc.split(',') : [],
          bcc: bcc ? bcc.split(',') : [],

          subject: subject,
          textBody: body,

          htmlBody:
            payload.payload?.parts
              ?.find((p) => p.mimeType === 'text/html')
              ?.body?.data
              ? Buffer.from(
                  payload.payload.parts.find(
                    (p) => p.mimeType === 'text/html'
                  ).body.data,
                  'base64'
                ).toString('utf-8')
              : null,

          threadId: payload.threadId || null,

          inReplyTo: inReplyTo || null,
          references: references ? references.split(' ') : [],

          direction: 'incoming',

          connectionId: connection._id,
        });

        // ------------------------------
        // SCENARIO ENGINE
        // ------------------------------
        await executeScenarios({
          userId: connection.userId,
          from,
          to,
          subject,
          body,
          emailId: parentEmail._id,
          parsedEmailObj: payload,
        });
      } catch (err) {
        console.log('❌ Error processing message:', msg.id, err.message);
      }
    }

    // 5. UPDATE HISTORY ID
    if (history?.data?.historyId) {
      await ConnectionModel.updateOne(
        { _id: connection._id },
        {
          $set: {
            'gmailWatch.historyId': history.data.historyId,
          },
        }
      );
    }

    console.log('✅ Gmail processing complete');
  } catch (err) {
    console.log('🔥 processGmailEmail fatal error:', err.message);
  }
}