

// import { google } from 'googleapis';
// import { executeScenarios } from '../controller/smtpServer.js';
// import { ConnectionModel } from '../Models/Connection.js';
// import { EmailModel } from '../Models/Email.js';

// // ------------------------------
// // BODY EXTRACTOR (SAFE)
// // ------------------------------
// const extractBody = (payload) => {
//   try {
//     const parts = payload.payload?.parts || [];

//     const textPart = parts.find((p) => p.mimeType === 'text/plain');
//     if (textPart?.body?.data) {
//       return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
//     }

//     const htmlPart = parts.find((p) => p.mimeType === 'text/html');
//     if (htmlPart?.body?.data) {
//       return Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
//     }

//     return payload.snippet || '';
//   } catch (err) {
//     return payload.snippet || '';
//   }
// };

// // ------------------------------
// // MAIN FUNCTION
// // ------------------------------
// export async function processGmailEmail(emailAddress, historyId) {
//   try {
//     // 1. CONNECTION
//     const connection = await ConnectionModel.findOne({
//       email: emailAddress,
//       provider: 'gmail',
//     });

//     if (!connection) {
//       console.log('❌ No connection found for:', emailAddress);
//       return;
//     }

//     // 2. OAUTH
//     const oauth2Client = new google.auth.OAuth2(
//       process.env.GOOGLE_CLIENT_ID,
//       process.env.GOOGLE_CLIENT_SECRET,
//       process.env.GOOGLE_REDIRECT_URI
//     );

// console.log("CLIENT_ID:", process.env.GOOGLE_CLIENT_ID);
// console.log("CLIENT_SECRET:", process.env.GOOGLE_CLIENT_SECRET ? "SET" : "MISSING");
// console.log("REDIRECT_URI:", process.env.GOOGLE_REDIRECT_URI); 
//   //  oauth2Client.setCredentials(connection.tokens);
//   console.log("🧪 RAW TOKENS TYPE:", typeof connection.tokens);
// console.log("🧪 RAW TOKENS:", connection.tokens);
// console.log("🧪 HAS REFRESH:", !!connection.tokens?.refresh_token);
// const safeTokens = JSON.parse(JSON.stringify(connection.tokens));
// if (!connection.tokens?.refresh_token) {
//   throw new Error("❌ refresh_token missing in DB → re-auth required");
// }
// oauth2Client.setCredentials({
//   access_token: safeTokens.access_token,
//   refresh_token: safeTokens.refresh_token,
//   scope: safeTokens.scope,
//   token_type: safeTokens.token_type,
//   expiry_date: safeTokens.expiry_date,
// });
//     const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

//     // 3. HISTORY
//     const history = await gmail.users.history.list({
//       userId: 'me',
//       startHistoryId: connection.gmailWatch?.historyId || historyId,
//       historyTypes: ['messageAdded'],
//     });

//     const histories = history.data.history || [];
//     const messages = histories.flatMap((h) => h.messages || []);

//     if (!messages.length) {
//       console.log('ℹ️ No new emails found');
//       return;
//     }

//     // 4. PROCESS EMAILS
//     for (const msg of messages) {
//       try {
//         if (!msg?.id) continue;

//         // DUPLICATE CHECK
//         const exists = await EmailModel.findOne({
//           messageId: msg.id,
//           direction: 'incoming',
//         });

//         if (exists) {
//           console.log('⚠️ Duplicate skipped:', msg.id);
//           continue;
//         }

//         // FETCH EMAIL
//         const email = await gmail.users.messages.get({
//           userId: 'me',
//           id: msg.id,
//         });

//         const payload = email.data;

//         // ------------------------------
//         // HEADERS SAFE EXTRACTION
//         // ------------------------------
//         const headers = payload.payload?.headers || [];

//         const getHeader = (name) =>
//           headers.find((h) => h.name === name)?.value || '';

//         const from = getHeader('From');
//         const to = getHeader('To');
//         const cc = getHeader('Cc');
//         const bcc = getHeader('Bcc');
//         const subject = getHeader('Subject');
//         const date = getHeader('Date');
//         const messageIdHeader = getHeader('Message-ID');
//         const inReplyTo = getHeader('In-Reply-To');
//         const references = getHeader('References');

//         const body = extractBody(payload);

//         // ------------------------------
//         // NORMALIZED EMAIL
//         // ------------------------------
//         const normalizedEmail = {
//           emailId: msg.id,
//           from,
//           to,
//           cc,
//           bcc,
//           subject,
//           date,
//           messageIdHeader,
//           inReplyTo,
//           references,
//           body,
//           parsedEmailObj: payload,
//         };

//         console.log('📩 Processing Email:', subject);

//         // ------------------------------
//         // SAVE EMAIL
//         // ------------------------------
//         const parentEmail = await EmailModel.create({
//           userId: connection.userId,

//           messageId: normalizedEmail.emailId,

//           senderAddress: from,
//           recipientAddress: to,

//           cc: cc ? cc.split(',') : [],
//           bcc: bcc ? bcc.split(',') : [],

//           subject: subject,
//           textBody: body,

//           htmlBody:
//             payload.payload?.parts
//               ?.find((p) => p.mimeType === 'text/html')
//               ?.body?.data
//               ? Buffer.from(
//                   payload.payload.parts.find(
//                     (p) => p.mimeType === 'text/html'
//                   ).body.data,
//                   'base64'
//                 ).toString('utf-8')
//               : null,

//           threadId: payload.threadId || null,

//           inReplyTo: inReplyTo || null,
//           references: references ? references.split(' ') : [],

//           direction: 'incoming',

//           connectionId: connection._id,
//         });

//         // ------------------------------
//         // SCENARIO ENGINE
//         // ------------------------------
//         await executeScenarios({
//           userId: connection.userId,
//           from,
//           to,
//           subject,
//           body,
//           emailId: parentEmail._id,
//           parsedEmailObj: payload,
//         });
//       } catch (err) {
//         console.log('❌ Error processing message:', msg.id, err.message);
//       }
//     }

//     // 5. UPDATE HISTORY ID
//     if (history?.data?.historyId) {
//       await ConnectionModel.updateOne(
//         { _id: connection._id },
//         {
//           $set: {
//             'gmailWatch.historyId': history.data.historyId,
//           },
//         }
//       );
//     }

//     console.log('✅ Gmail processing complete');
//   } catch (err) {
//   console.log("🔥 GMAIL API ERROR:", err.response?.data || err.message);
//   throw err;
//   }
// }


import { google } from 'googleapis';
import { executeScenarios } from '../controller/smtpServer.js';
import { ConnectionModel } from '../Models/Connection.js';
import { EmailModel } from '../Models/Email.js';
import { htmlToText } from "html-to-text";

// ------------------------------
// BODY EXTRACTOR (SAFE)
// ------------------------------
const extractBody = (payload) => {
  try {
    const parts = payload?.payload?.parts || [];

    const textPart = parts.find((p) => p.mimeType === 'text/plain');
    if (textPart?.body?.data) {
      return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
    }

    const htmlPart = parts.find((p) => p.mimeType === 'text/html');
    if (htmlPart?.body?.data) {
      return Buffer.from(htmlPart.body.data, 'base64').toString('utf-8');
    }

    return payload?.snippet || '';
  } catch (err) {
    return payload?.snippet || '';
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

    // 2. VALIDATE TOKENS
    if (!connection.tokens?.refresh_token) {
      throw new Error('❌ refresh_token missing → re-auth required');
    }

    // 3. OAUTH CLIENT
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID);
    console.log('CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'SET' : 'MISSING');
    console.log('REDIRECT_URI:', process.env.GOOGLE_REDIRECT_URI);

    // 4. SAFE TOKEN PARSE
    const safeTokens = JSON.parse(JSON.stringify(connection.tokens));

    oauth2Client.setCredentials({
      access_token: safeTokens.access_token,
      refresh_token: safeTokens.refresh_token,
      scope: safeTokens.scope,
      token_type: safeTokens.token_type,
      expiry_date: safeTokens.expiry_date,
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // ------------------------------
    // 5. HISTORY FETCH (SAFE WRAPPED)
    // ------------------------------
    let history;

    try {
      history = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: connection.gmailWatch?.historyId || historyId,
        historyTypes: ['messageAdded'],
      });
    } catch (err) {
      console.log('🔥 GMAIL HISTORY ERROR:', err.response?.data || err.message);
      throw err;
    }

    const histories = history?.data?.history || [];
    const messages = histories.flatMap((h) => h.messages || []);

    if (!messages.length) {
      console.log('ℹ️ No new emails found');
      return;
    }

    // ------------------------------
    // 6. PROCESS EMAILS
    // ------------------------------
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

        const headers = payload?.payload?.headers || [];

        const getHeader = (name) =>
          headers.find((h) => h.name === name)?.value || '';

        const from = getHeader('From');
        const to = getHeader('To');
        const cc = getHeader('Cc');
        const bcc = getHeader('Bcc');
        const subject = getHeader('Subject');
        const date = getHeader('Date');
        const inReplyTo = getHeader('In-Reply-To');
        const references = getHeader('References');

        const body = extractBody(payload);

        console.log('📩 Processing Email:', subject);

        // SAVE EMAIL
        const parentEmail = await EmailModel.create({
          userId: connection.userId,
          messageId: msg.id,
          senderAddress: from,
          recipientAddress: to,
          cc: cc ? cc.split(',') : [],
          bcc: bcc ? bcc.split(',') : [],
          subject,
          textBody: body,
          htmlBody:
            payload?.payload?.parts
              ?.find((p) => p.mimeType === 'text/html')
              ?.body?.data
              ? Buffer.from(
                  payload.payload.parts.find(
                    (p) => p.mimeType === 'text/html'
                  ).body.data,
                  'base64'
                ).toString('utf-8')
              : null,
          threadId: payload?.threadId || null,
          inReplyTo: inReplyTo || null,
          references: references ? references.split(' ') : [],
          direction: 'incoming',
          connectionId: connection._id,
        });

        // SCENARIO ENGINE
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

    // ------------------------------
    // 7. UPDATE HISTORY ID
    // ------------------------------
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
    console.log('🔥 GMAIL API ERROR:', err.response?.data || err.message);
    throw err;
  }
}


export const processOutlookEmail = async (notification, connection) => {
  try {
    console.log('🚨 PROCESS OUTLOOK EMAIL START');

    // -------------------------
    // MESSAGE ID EXTRACTION (ROBUST)
    // -------------------------
    let messageId =
      notification.resourceData?.id ||
      notification.resourceData?.["@odata.id"] ||
      notification.resource;

    if (messageId) {
      messageId = messageId.split('/messages/').pop()?.split('/Messages/').pop();
    }

    console.log('🆔 messageId:', messageId);

    if (!messageId) {
      console.log('❌ No messageId found');
      return;
    }

    // -------------------------
    // TOKEN CHECK
    // -------------------------
    if (!connection?.tokens?.access_token) {
      console.log('❌ Missing access token');
      return;
    }

    // -------------------------
    // 🔥 DUPLICATE CHECK (IMPORTANT FIX)
    // -------------------------
    const exists = await EmailModel.findOne({
      messageId,
      direction: "incoming",
    });

    if (exists) {
      console.log('⚠️ Duplicate Outlook email skipped:', messageId);
      return;
    }

    console.log('🧪 OUTLOOK TOKEN OK');

    // -------------------------
    // FETCH EMAIL FROM GRAPH
    // -------------------------
    const emailRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${connection.tokens.access_token}`,
        },
      }
    );

    const email = await emailRes.json();

    console.log('📡 Graph Status:', emailRes.status);

    if (!emailRes.ok) {
      console.log('❌ GRAPH ERROR:', email);
      return;
    }

    // -------------------------
    // SAFE BODY HANDLING
    // -------------------------
    let cleanBody = "";

    try {
      const rawHtml = email.body?.content || "";

      cleanBody = htmlToText?.(rawHtml, {
        wordwrap: 130,
        ignoreImage: true,
      }) || rawHtml; // fallback safe
    } catch (err) {
      console.log('⚠️ htmlToText failed, using raw body');
      cleanBody = email.body?.content || "";
    }

    // -------------------------
    // NORMALIZE EMAIL
    // -------------------------
    const from = email.from?.emailAddress?.address || "unknown";
    const to =
      email.toRecipients?.map(t => t.emailAddress?.address).join(",") || "";

    const subject = email.subject || "(No Subject)";
    const receivedDate = email.receivedDateTime || new Date().toISOString();

    console.log('📧 Subject:', subject);
    console.log('👤 From:', from);

    // -------------------------
    // SAVE EMAIL
    // -------------------------
    const savedEmail = await EmailModel.create({
      userId: connection.userId,
      messageId,
      senderAddress: from,
      recipientAddress: to,
      subject,
      textBody: cleanBody,
      htmlBody: email.body?.content || "",
      direction: "incoming",
      connectionId: connection._id,
      date: receivedDate,
    });

    console.log('💾 Email saved successfully:', savedEmail._id);

    // -------------------------
    // AUTOMATION ENGINE (SAFE CALL)
    // -------------------------
    await executeScenarios({
      userId: connection.userId,
      from,
      to,
      subject,
      body: cleanBody,
      emailId: savedEmail._id,   // IMPORTANT FIX (NOT messageId)
      parsedEmailObj: email || {},
    });

    console.log('⚙️ Automation executed');

  } catch (err) {
    console.log('❌ PROCESS OUTLOOK EMAIL ERROR:', err.message);
    console.log(err.stack);
  }
};