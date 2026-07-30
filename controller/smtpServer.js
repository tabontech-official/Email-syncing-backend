// smtpServer.js
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { authModel } from '../Models/auth.js';
import { EmailModel } from '../Models/Email.js';
import { TemplateModel } from '../Models/Template.js';
import { google } from 'googleapis';
import { ConnectionModel } from '../Models/Connection.js';
import multer from 'multer';
import { scenarioModel } from '../Models/Scenario.js';
import { DelayJobModel } from '../Models/DelayJob.js';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { AutomationStatusModel } from '../Models/AutomationStatus.js';
import { TestEmailDataModel } from '../Models/TestEmailDataModel.js';
import { validationModel } from '../Models/ValidationEmail.js';
import { mailhookModel } from '../Models/MailhookSchema.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ScenarioRunLogModel } from '../Models/ScenarioRunLog.js';
import { decrypt } from '../middleware/encryption.js';
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// export const generateGeminiReply = async ({ from, subject, body }) => {
//   const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

//   const prompt = `
// You are a professional business email assistant.

// Write a polite, helpful, and clear email reply.

// Incoming Email:
// F
// Subjectrom: ${from}: ${subject}
// Message:
// ${body}

// Reply only with the email body. No explanations.
// `;

//   const result = await model.generateContent(prompt);
//   const response = result.response.text();

//   return response;
// };

export const generateGeminiReply = async ({ from, subject, body, user }) => {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
  });

  const prompt = `
You are a senior business email consultant for a Shopify agency.

You are replying on behalf of:
Name: ${user.fullName}
Company: ${user.organizationName}
Email: ${user.email}
Country: ${user.country}

Agency Context:
- Certified Shopify Experts & Partners
- Services: Shopify design, development, migration, SEO, marketing
- Clients worldwide
- High-ticket, professional clientele
- Communication must sound 100% human-written and professional
- No emojis, no AI indicators

Business Rules:
- Never mention prices unless the client shares a budget
- If budget is mentioned, slightly stretch it by adding value
- If no budget, ask for budget range and suggest a call
- Always be polite, clear, and consultative
- Medium-length response (not short, not verbose)

Incoming Email:
From: ${from}
Subject: ${subject}

Message:
${body}

Write a complete professional email reply.

End the email with a proper signature using this format:

Best regards,
${user.fullName}
Founder | ${user.organizationName}


IMPORTANT:
- Reply ONLY with the email body
- Do NOT explain anything
- Do NOT include markdown
`;

  const result = await model.generateContent(prompt);
  return result.response.text().trim();
};

function checkCondition(condition, email) {
  const fieldValue = (email[condition.field] || '').toLowerCase();
  const targetValue = (condition.value || '').toLowerCase();

  let result = false;
  switch (condition.operator) {
    case 'equals':
      result = fieldValue === targetValue;
      break;
    case 'contains':
      result = fieldValue.includes(targetValue);
      break;
    case 'not_equals':
      result = fieldValue !== targetValue;
      break;
    case 'starts_with':
      result = fieldValue.startsWith(targetValue);
      break;
    default:
      result = false;
  }

  console.log(
    `Condition result [${condition.field} ${condition.operator} ${condition.value}] = ${result}`
  );
  return result;
}

function matchesTemplate(template, email) {
  const result = template.conditions.every((cond) =>
    checkCondition(cond, email)
  );
  return result;
}

export const startSMTPServer = () => {
  const server = new SMTPServer({
    authOptional: true,
    onConnect(session, callback) {
      console.log('New connection from:', session.remoteAddress);
      callback();
    },
    onData(stream, session, callback) {
      console.log('Receiving new email...');

      let chunks = [];

      stream.on('data', (chunk) => {
        console.log('Data chunk received, length:', chunk.length);
        chunks.push(chunk);
      });

      stream.on('end', async () => {
        console.log('End of data stream, parsing email...');

        try {
          const rawEmail = Buffer.concat(chunks);
          const parsed = await simpleParser(rawEmail);

          console.log('Parsed email:', {
            from: parsed.from?.text,
            to: parsed.to?.text,
            subject: parsed.subject,
          });

          const recipient = parsed.to?.value[0]?.address;
          const sender = parsed.from?.text;

          console.log('Recipient:', recipient);
          console.log('Sender:', sender);

          const user = await authModel.findOne({ mailhook: recipient });
          console.log('User lookup result:', user ? user.email : null);

          if (!user) {
            console.warn('No user found for mailhook:', recipient);
            return callback();
          }

          const emailData = {
            subject: parsed.subject || '',
            body: parsed.text || parsed.html || '',
            sender: sender || '',
            recipient: recipient || '',
          };
          console.log('Email data for template matching:', emailData);

          const templates = await TemplateModel.find({
            userId: user._id,
            active: true,
          });
          console.log(`Found ${templates.length} active templates for user`);

          let matchedTemplate = null;
          for (const tpl of templates) {
            if (matchesTemplate(tpl, emailData)) {
              matchedTemplate = tpl;
              console.log('Matched template:', tpl._id);
              break;
            }
          }

          const emailDoc = new EmailModel({
            userId: user._id,
            templateId: matchedTemplate?._id || null,
            sender,
            recipient,
            subject: parsed.subject,
            textBody: parsed.text,
            htmlBody: parsed.html,
          });

          await emailDoc.save();
          console.log(
            `Email saved to DB with ID: ${emailDoc._id} ${
              matchedTemplate
                ? `(linked to template: ${matchedTemplate._id})`
                : '(no template matched)'
            }`
          );

          callback();
        } catch (err) {
          console.error('Error parsing or saving email:', err);
          callback(err);
        }
      });
    },
  });

  server.listen(2525, () => {
    console.log('🚀 SMTP server listening on port 2525');
  });
};

export const getEmails = async (req, res) => {
  try {
    const { userId } = req.query;

    const emails = await EmailModel.find(userId ? { userId } : {})
      .populate('templateId', 'service platform content')
      .sort({ createdAt: -1 });

    const result = emails.map((e) => ({
      from: e.sender,
      subject: e.subject,
      date: e.createdAt.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
      status: e.status,
      template: e.templateId
        ? {
            id: e.templateId._id,
            service: e.templateId.service,
            platform: e.templateId.platform,
          }
        : null,
    }));

    res.json(result);
  } catch (err) {
    console.error(' Error fetching emails:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

const upload = multer();

function splitName(fullName = '') {
  if (!fullName) return { firstName: '', lastName: '' };
  const parts = fullName.trim().split(' ');
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
  };
}

function parseKeyValuePairs(text = '') {
  const fields = {};
  const lines = text.split(/\r?\n/);

  lines.forEach((line) => {
    console.log('➡️ Checking line:', line);

    const match = line.match(/^([\w\s]+)\s*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      const value = match[2].trim();
      fields[key] = value;
    }
  });

  return fields;
}

// export const mailHookWebhook = async (req, res) => {
//   try {
//     console.log('==============================');
//     console.log('📩 Incoming MailHook Webhook Triggered');
//     console.log('Headers:', req.headers);
//     console.log('Body keys:', Object.keys(req.body));
//     console.log('Envelope:', req.body.envelope);
//     console.log('Raw "to":', req.body.to);
//     console.log('Raw "from":', req.body.from);
//     console.log('Raw "subject":', req.body.subject);
//     console.log('==============================');

//     const rawEmail = req.body.email || null;
//     let parsed = {};

//     if (rawEmail) {
//       console.log('📦 Raw email found — parsing with simpleParser...');
//       parsed = await simpleParser(rawEmail);
//     } else {
//       console.log('⚙️ No raw email — using manual fallback parser...');
//       parsed = {
//         from: { value: [{ address: req.body.from, name: req.body.from }] },
//         to: { value: [{ address: req.body.to, name: req.body.to }] },
//         subject: req.body.subject,
//         text: req.body.text,
//         html: req.body.html,
//         headers: req.body.headers || '',
//       };
//     }

//     // 📜 Parsed summary
//     console.log('📄 Parsed Email Summary:');
//     console.log('  FROM:', parsed.from?.value?.[0]);
//     console.log('  TO:', parsed.to?.value?.[0]);
//     console.log('  SUBJECT:', parsed.subject);
//     console.log('  TEXT LENGTH:', parsed.text?.length || 0);
//     console.log('  HTML LENGTH:', parsed.html?.length || 0);
//     console.log('----------------------------------------');

//     const senderAddress = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
//     let mailhookAddress =
//       req.body.envelope?.to ||
//       (Array.isArray(req.body.to) ? req.body.to[0] : req.body.to) ||
//       parsed.to?.value?.[0]?.address ||
//       '';

//     const headersRaw = req.body.headers || '';
//     console.log('📫 Initial mailhookAddress candidate:', mailhookAddress);
//     console.log('📋 Raw headers text:', headersRaw?.slice(0, 400), '...');

//     // 🔍 Detect forwarding headers
//     const forwardedMatch =
//       headersRaw.match(/x-forwarded-to:\s*([^\s>]+)/i) ||
//       headersRaw.match(/x-forwarded-for:\s*[^\s]+\s+([^\s>]+)/i) ||
//       headersRaw.match(/delivered-to:\s*([^\s>]+)/i) ||
//       headersRaw.match(/original-to:\s*([^\s>]+)/i);

//     if (forwardedMatch && forwardedMatch[1]) {
//       console.log('📬 Forwarding header found =>', forwardedMatch[1]);
//       mailhookAddress = forwardedMatch[1];
//     }

//     if (mailhookAddress.includes('<')) {
//       mailhookAddress = mailhookAddress.split('<')[1].replace('>', '').trim();
//     }

//     mailhookAddress = mailhookAddress.trim().toLowerCase();
//     console.log('🎯 Final mailhookAddress:', mailhookAddress);

//     // Check mailhook domain
//     if (!mailhookAddress.endsWith('@mail.replexengine.com')) {
//       console.log('⛔ Ignored — not a @mail.replexengine.com address.');
//       console.log('🚫 mailhookAddress:', mailhookAddress);
//       console.log('==============================');
//       return res.status(200).send('Ignored — not a mailhook email.');
//     }

//     // Find user
//     const user = await authModel.findOne({ mailhook: mailhookAddress });
//     if (!user) {
//       console.warn('⚠️ No matching user found for mailhook:', mailhookAddress);
//       console.log('==============================');
//       return res.status(200).send('No matching user found for mailhook.');
//     }

//     console.log('👤 Matched user:', user.email || user._id?.toString());

//     // Forward detection
//     let isForwarded = false;
//     let headerString = '';

//     if (parsed.headers && typeof parsed.headers.keys === 'function') {
//       for (const [key, val] of parsed.headers.entries()) {
//         headerString += `${key}: ${val}\n`;
//       }
//     } else if (typeof parsed.headers === 'string') {
//       headerString = parsed.headers;
//     } else if (headersRaw) {
//       headerString = headersRaw;
//     }

//     const headerLower = headerString.toLowerCase();

//     isForwarded =
//       headerLower.includes('x-forwarded-for') ||
//       headerLower.includes('x-forwarded-to') ||
//       headerLower.includes('forwarding-noreply@google.com') ||
//       headerLower.includes('@mail.replexengine.com') ||
//       headerLower.includes('mail forwarding') ||
//       parsed.subject?.toLowerCase().startsWith('fwd:') ||
//       parsed.text?.toLowerCase().includes('forwarded message');

//     console.log('📡 isForwarded?', isForwarded);
//     console.log('Header sample:', headerString.slice(0, 400), '...');

//     if (!isForwarded) {
//       console.log('⏭️ Ignored — not a forwarded email.');
//       console.log('==============================');
//       return res.status(200).send('Ignored — not a forwarded email.');
//     }

//     // Validation forwarding test
//     if (parsed.subject?.includes('Replex Engine Forwarding Validation Test')) {
//       console.log('✅ Forwarding validation email detected...');
//       let originalEmail = senderAddress;
//       const xForwardedFor = headerLower.match(/x-forwarded-for:\s*([^\s]+)/i);
//       if (xForwardedFor && xForwardedFor[1].includes('@')) {
//         originalEmail = xForwardedFor[1].toLowerCase();
//       }

//       console.log('💡 Original email:', originalEmail);

//       const existing = await validationModel.findOne({ userId: user._id });
//       if (existing) {
//         Object.assign(existing, {
//           toEmail: originalEmail,
//           subject: parsed.subject,
//           body: parsed.text || parsed.html,
//           sentAt: new Date(),
//           verified: true,
//           verifiedAt: new Date(),
//           status: 'verified',
//           notes: 'Forwarding verified successfully (via mailhook).',
//         });
//         await existing.save();
//         console.log('🔄 Updated existing validation record');
//       } else {
//         await validationModel.create({
//           userId: user._id,
//           toEmail: originalEmail,
//           subject: parsed.subject,
//           body: parsed.text || parsed.html,
//           sentAt: new Date(),
//           verified: true,
//           verifiedAt: new Date(),
//           status: 'verified',
//           notes: 'Forwarding verified successfully (via mailhook).',
//         });
//         console.log('✅ Created new validation record');
//       }

//       console.log('==============================');
//       return res.status(200).send('✅ Forwarding verified successfully.');
//     }

//     // Forwarded normal email
//     console.log('📨 Forwarded normal email detected — saving to DB...');
//     const senderName = parsed.from?.value?.[0]?.name || '';
//     const { firstName: senderFirstName, lastName: senderLastName } =
//       splitName(senderName);
//     const { firstName: recipientFirstName, lastName: recipientLastName } =
//       splitName(mailhookAddress);

//     const cc = parsed.cc?.value?.map((c) => c.address) || [];
//     const bcc = parsed.bcc?.value?.map((b) => b.address) || [];
//     const date = parsed.date || new Date();
//     const messageId = parsed.messageId || '';
//     const inReplyTo = parsed.inReplyTo || '';
//     const references = parsed.references || [];
//     const attachments =
//       parsed.attachments?.map((a) => ({
//         filename: a.filename,
//         contentType: a.contentType,
//         size: a.size,
//       })) || [];

//     console.log('📎 Attachments:', attachments.length);

//     const extraFields = parseKeyValuePairs(parsed.text || '');
//     const emailDoc = new EmailModel({
//       userId: user._id,
//       senderFirstName,
//       senderLastName,
//       senderAddress,
//       recipientFirstName,
//       recipientLastName,
//       recipientAddress: mailhookAddress,
//       subject: parsed.subject,
//       textBody: parsed.text,
//       htmlBody: parsed.html,
//       cc,
//       bcc,
//       date,
//       messageId,
//       inReplyTo,
//       references,
//       attachments,
//       extraFields,
//       notes: 'Forwarded email captured (debug mode).',
//     });

//     await emailDoc.save();
//     console.log('💾 Email saved with ID:', emailDoc._id);

//     await executeScenarios({
//       userId: user._id,
//       from: senderAddress,
//       subject: parsed.subject,
//       body: parsed.text || parsed.html || '',
//       emailId: emailDoc._id.toString(),
//       parsedEmailObj: parsed,
//     });

//     console.log('✅ Scenarios executed.');
//     console.log('==============================');
//     return res.status(200).send('📥 Forwarded email saved and processed.');
//   } catch (err) {
//     console.error('❌ Error processing mailhook:', err);
//     console.log('==============================');
//     res.status(500).send('Error processing email');
//   }
// };

const isValidConnectionId = (connectionId) => {
  const value = (connectionId || '').toString().trim();

  return (
    value && value !== 'null' && value !== 'undefined' && value !== '(empty)'
  );
};

const getModuleSearchText = (module = {}) => {
  return [
    module.type,
    module.app?.name,
    module.app?.displayName,
    module.emailType,
    module.template,
    module.title,
    module.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
};

const isEmailModule = (module = {}) => {
  const text = getModuleSearchText(module);

  return (
    text.includes('email') ||
    text.includes('gmail') ||
    text.includes('smtp') ||
    text.includes('outlook') ||
    text.includes('follow') ||
    text.includes('initial')
  );
};

const isDelayModule = (module = {}) => {
  const text = getModuleSearchText(module);
  return text.includes('delay');
};

const normalizeModuleType = (module = {}) => {
  if (isDelayModule(module)) {
    return {
      ...module,
      type: 'Delay',
    };
  }

  if (isEmailModule(module)) {
    return {
      ...module,
      type: module.emailType === 'Email' ? 'Custom Email' : 'Send an Email',
    };
  }

  return module;
};

const moduleDebug = (module = {}) => ({
  id: module.id || module._id,
  type: module.type,
  appName: module.app?.name,
  displayName: module.app?.displayName,
  emailType: module.emailType,
  template: module.template,
  connectionId: module.connectionId,
  isEmailModule: isEmailModule(module),
  isDelayModule: isDelayModule(module),
  hasConnection: isValidConnectionId(module.connectionId),
});

export const mailHookWebhook = async (req, res) => {
  try {
    console.log('==============================');
    console.log('📩 Incoming MailHook Webhook Triggered');
    console.log('Envelope:', req.body.envelope);
    console.log('Raw to:', req.body.to);
    console.log('Raw from:', req.body.from);
    console.log('Subject:', req.body.subject);
    console.log('==============================');

    /* ---------------- PARSE EMAIL ---------------- */
    let parsed = {};
    if (req.body.email) {
      parsed = await simpleParser(req.body.email);
    } else {
      parsed = {
        from: { value: [{ address: req.body.from, name: req.body.from }] },
        to: { value: [{ address: req.body.to, name: req.body.to }] },
        subject: req.body.subject,
        text: req.body.text || '',
        html: req.body.html || '',
        headers: req.body.headers || '',
      };
    }

    const senderAddress = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
    // 🔥 FIX: normalize envelope (string → object)
    let envelope = req.body.envelope;

    if (typeof envelope === 'string') {
      try {
        envelope = JSON.parse(envelope);
      } catch (e) {
        console.warn('⚠️ Failed to parse envelope JSON');
        envelope = null;
      }
    }

    /* ---------------- RESOLVE MAILHOOK ADDRESS (🔥 FIXED) ---------------- */
    let mailhookAddress = '';

    // 1️⃣ ENVELOPE (KING)
    if (envelope?.to) {
      mailhookAddress = Array.isArray(envelope.to)
        ? envelope.to[0]
        : envelope.to;
    }

    // 2️⃣ HEADERS fallback
    if (!mailhookAddress && req.body.headers) {
      const match =
        req.body.headers.match(/x-forwarded-to:\s*([^\s>]+)/i) ||
        req.body.headers.match(/delivered-to:\s*([^\s>]+)/i) ||
        req.body.headers.match(/original-to:\s*([^\s>]+)/i);

      if (match?.[1]) mailhookAddress = match[1];
    }

    // 3️⃣ LAST fallback
    if (!mailhookAddress) {
      mailhookAddress = parsed.to?.value?.[0]?.address || '';
    }

    mailhookAddress = mailhookAddress.replace(/[<>]/g, '').trim().toLowerCase();

    console.log('🎯 FINAL MAILHOOK ADDRESS:', mailhookAddress);

    /* ---------------- VALIDATE MAILHOOK ---------------- */
    if (!mailhookAddress.endsWith('@mail.replexengine.com')) {
      console.log('⛔ Ignored — not mailhook email');
      return res.status(200).send('Ignored');
    }

    const user = await authModel.findOne({ mailhook: mailhookAddress });
    if (!user) {
      console.log('⚠️ No user found for mailhook');
      return res.status(200).send('No user');
    }

    console.log('👤 Matched user:', user.email);

    /* ---------------- FORWARD DETECTION ---------------- */
    const headerText =
      typeof parsed.headers === 'string' ? parsed.headers.toLowerCase() : '';

    const isForwarded =
      headerText.includes('forwarded') ||
      parsed.subject?.toLowerCase().startsWith('fwd:') ||
      parsed.text?.toLowerCase().includes('forwarded message') ||
      !!req.body.envelope;

    if (!isForwarded) {
      console.log('⏭️ Not forwarded — ignored');
      return res.status(200).send('Ignored');
    }

    /* ---------------- VALIDATION EMAIL ---------------- */
    if (parsed.subject?.includes('Replex Engine Forwarding Validation Test')) {
      console.log('✅ Forwarding validation detected');

      await validationModel.findOneAndUpdate(
        { userId: user._id },
        {
          userId: user._id,
          toEmail: senderAddress,
          subject: parsed.subject,
          body: parsed.text || '',
          verified: true,
          verifiedAt: new Date(),
          status: 'verified',
        },
        { upsert: true }
      );

      return res.status(200).send('✅ Forwarding verified');
    }

    /* ---------------- CHECK CUSTOMER REPLY FIRST ---------------- */
    const savedAsReply = await saveIncomingReplyIfExists({
      userId: user._id,
      from: senderAddress,
      to: mailhookAddress,
      subject: parsed.subject,
      body: parsed.text || '',
      html: parsed.html || '',
      emailId: parsed.messageId || '',
      threadId: parsed.threadId || '',
      inReplyTo: parsed.inReplyTo || '',
      references: parsed.references || [],
      attachments:
        parsed.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })) || [],
    });

    if (savedAsReply) {
      console.log('💬 Customer reply saved — scenario skipped');
      return res.status(200).send('Customer reply saved');
    }

    /* ---------------- SAVE EMAIL ---------------- */
    const emailDoc = await EmailModel.create({
      userId: user._id,
      senderAddress,
      recipientAddress: mailhookAddress,
      subject: parsed.subject,
      textBody: parsed.text,
      htmlBody: parsed.html,
      date: parsed.date || new Date(),
      messageId: parsed.messageId || '',
      attachments:
        parsed.attachments?.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })) || [],
      notes: 'Forwarded email captured',
    });

    console.log('💾 Email saved:', emailDoc._id);

    // /* ---------------- EXECUTE SCENARIOS ---------------- */
    await executeScenarios({
      userId: user._id,
      from: senderAddress,
      subject: parsed.subject,
      body: parsed.text || parsed.html || '',
      emailId: emailDoc._id.toString(),
      parsedEmailObj: parsed,
    });

    console.log('✅ Scenarios executed');
    return res.status(200).send('📥 Email processed');
  } catch (err) {
    console.error('❌ Mailhook Error:', err);
    return res.status(500).send('Server error');
  }
};

function fillTemplate(template, fields) {
  return template.replace(/{{(.*?)}}/g, (_, key) => {
    const cleanKey = key.trim();
    return fields[cleanKey] || '';
  });
}

function extractFieldsFromEmail(emailObj = {}) {
  const fields = {};

  if (emailObj.from?.value?.[0]) {
    fields.FullName = emailObj.from.value[0].name || '';
    fields.BusinessEmail = emailObj.from.value[0].address || '';
  } else if (typeof emailObj.from === 'string') {
    const match = emailObj.from.match(/^(.*?)\s*<(.+)>$/);
    fields.FullName = match ? match[1].trim() : '';
    fields.BusinessEmail = match ? match[2].trim() : emailObj.from;
  }

  const kv = parseKeyValuePairs(emailObj.text || '');
  if (kv.budget) fields.Budget = kv.budget;
  if (kv.country) fields.Country = kv.country;

  const storeMatch = (emailObj.text || '').match(/store\s+"([^"]+)"/i);
  if (storeMatch) fields.StoreName = storeMatch[1];

  const urlMatch = (emailObj.text || '').match(/https?:\/\/[^\s]+/i);
  if (urlMatch) fields.StoreURL = urlMatch[0];

  const lines = (emailObj.text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  fields.ProblemGoal = lines.slice(1, 3).join(' ') || '';

  fields.Service = emailObj.subject || '';

  return fields;
}

export const saveIncomingReplyIfExists = async (emailData) => {
  console.log('\n=======================================');
  console.log('🔍 Checking if incoming email is a Customer Reply (strictly via messageId / threadId)...');
  console.log('📩 From:', emailData.from);
  console.log('📩 To:', emailData.to);
  console.log('📩 Subject:', emailData.subject);
  console.log('📩 threadId:', emailData.threadId || 'none');
  console.log('📩 inReplyTo:', emailData.inReplyTo || 'none');
  console.log('📩 references:', emailData.references || []);

  const { userId } = emailData;

  const userObjId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const orConditions = [];

  const cleanId = (str = '') => String(str).replace(/^<|>$/g, '').trim();

  // 1. Thread ID matching
  if (emailData.threadId) {
    orConditions.push({ threadId: emailData.threadId });
  }

  // 2. In-Reply-To Message-ID matching
  if (emailData.inReplyTo) {
    const rawReplyTo = emailData.inReplyTo;
    const cleanedReplyTo = cleanId(rawReplyTo);
    if (cleanedReplyTo) {
      orConditions.push({ messageId: rawReplyTo });
      orConditions.push({ messageId: cleanedReplyTo });
      orConditions.push({ messageId: `<${cleanedReplyTo}>` });
    }
  }

  // 3. References Message-ID matching
  const rawRefs = Array.isArray(emailData.references)
    ? emailData.references
    : typeof emailData.references === 'string'
    ? [emailData.references]
    : [];

  if (rawRefs.length > 0) {
    const refs = rawRefs.flatMap((r) => {
      const c = cleanId(r);
      return c ? [r, c, `<${c}>`] : [r];
    });
    if (refs.length > 0) {
      orConditions.push({ messageId: { $in: refs } });
    }
  }

  if (orConditions.length === 0) {
    console.log('ℹ️ No messageId, inReplyTo, or threadId found — not a customer reply.');
    console.log('=======================================\n');
    return false;
  }

  const parentEmail = await EmailModel.findOne({
    $or: [{ userId: userId }, { userId: userObjId }],
    $or: orConditions,
  }).sort({ createdAt: -1 });

  if (!parentEmail) {
    console.log('ℹ️ Parent email thread not found for incoming reply.');
    console.log('=======================================\n');
    return false;
  }

  console.log(`📍 Matched Parent Email [ID: ${parentEmail._id}] Subject: "${parentEmail.subject}"`);

  // Trace back to the ultimate root email
  let ultimateRoot = parentEmail;
  while (ultimateRoot.parentEmailId) {
    const p = await EmailModel.findById(ultimateRoot.parentEmailId);
    if (!p) break;
    ultimateRoot = p;
  }

  console.log(`🌱 Ultimate Root Lead Email [ID: ${ultimateRoot._id}]`);

  const newReply = await EmailModel.create({
    userId: parentEmail.userId || userId,
    connectionId: emailData.connectionId || parentEmail.connectionId || null,
    senderAddress: emailData.from,
    recipientAddress: emailData.to,
    subject: emailData.subject,
    textBody: emailData.body,
    htmlBody: emailData.html || '',
    date: new Date(),
    direction: 'incoming',
    threadId: emailData.threadId || ultimateRoot.threadId || parentEmail.threadId || null,
    parentEmailId: ultimateRoot._id,
    messageId: emailData.emailId,
    inReplyTo: emailData.inReplyTo || '',
    references: emailData.references || [],
    attachments: emailData.attachments || [],
    notes: 'Customer reply saved and attached to root lead thread',
  });

  console.log('🎉 SUCCESS: Customer reply saved in DB!');
  console.log(`  💾 New Reply ID: ${newReply._id}`);
  console.log(`  🔗 Linked to Root Thread ID: ${ultimateRoot._id}`);
  console.log('=======================================\n');

  return true;
};

export const executeScenarios = async (emailData) => {
  try {
    console.log('=======================================');
    console.log('🚀 EXECUTE SCENARIOS Triggered (Shopify + Other)');
    console.log('📩 Incoming Email Data:', emailData);
    console.log('=======================================');

    const { userId, from, subject, body, emailId, parsedEmailObj } = emailData;

    const extractedFields = extractFieldsFromEmail(
      parsedEmailObj || { text: body, subject, from }
    );

    const scenarios = await scenarioModel.find({ userId }).lean();
    console.log(`📚 Found ${scenarios.length} total scenario(s)`);

    if (!scenarios.length) {
      console.log('⚠️ No scenarios found — stopping execution.');
      return;
    }

    for (const scenario of scenarios) {
      console.log('=======================================');
      console.log(`Executing Scenario: ${scenario.name} (${scenario.type})`);
      console.log('=======================================');
      const runStartedAt = new Date();
      const runSteps = [];
      let runLogDoc = null;
      let delayCreated = false;
      const addRunStep = (step) => {
        runSteps.push({
          stepKey: step.stepKey,
          stepName: step.stepName,
          status: step.status || 'pending',
          message: step.message || '',
          issue: step.issue || '',
          location: step.location || '',
          suggestion: step.suggestion || '',
          meta: step.meta || {},
          startedAt: step.startedAt || new Date(),
          completedAt: step.completedAt || new Date(),
        });
      };
      if (!scenario.routerBranches?.length) continue;

      if (scenario.type === 'other') {
        console.log(' Running OTHER scenario logic...');

        for (const branch of scenario.routerBranches) {
          console.log(`OTHER Branch ID: ${branch.id}`);
          console.log(`Conditions: ${branch.filter?.conditions?.length}`);

          // const matches = branch.filter?.conditions?.length
          //   ? branch.filter.conditions.every((cond) => {
          if (!branch.filter?.conditions?.length) {
            console.log(
              'OTHER: No branch conditions found — skipping to avoid replying to every email.'
            );
            continue;
          }

          const matches = branch.filter.conditions.every((cond) => {
            let fieldValue = '';

            switch (cond.field?.toLowerCase()) {
              case 'subject':
                fieldValue = (subject || '').toLowerCase();
                break;
              case 'body':
                fieldValue = (body || '').toLowerCase();
                break;
              case 'from':
                fieldValue = (from || '').toLowerCase();
                break;
              default:
                return false;
            }

            const condValue = (cond.value || '').toLowerCase();

            if (cond.operator === 'Contains')
              return fieldValue.includes(condValue);

            if (['Equal to', 'Equals'].includes(cond.operator))
              return fieldValue === condValue;

            return false;
          });

          if (!matches) {
            console.log('OTHER: Branch conditions did NOT match — skipping.');
            continue;
          }

          console.log('OTHER: Branch conditions matched — executing modules');

          for (const module of branch.modules) {
            console.log(`⚙️ OTHER: Executing module → ${module.type}`);

            if (module.type === 'Delay') {
              console.log('⏳ OTHER Delay detected — currently skipping');
              continue;
            }

            if (module.type === 'Send Email') {
              console.log('📧 OTHER: Sending Email...');

              let finalTemplateContent = '';

              if (
                module.template &&
                typeof module.template === 'string' &&
                module.template.length === 24
              ) {
                console.log(
                  ' OTHER: TemplateID detected → fetching content from DB...'
                );

                const tpl = await TemplateModel.findById(module.template);
                if (tpl) {
                  finalTemplateContent = tpl.content;
                  console.log(
                    ' OTHER: Loaded Template Content from DB:',
                    tpl._id
                  );
                } else {
                  console.log(
                    ' OTHER: Template ID not found → fallback to empty'
                  );
                  finalTemplateContent = '';
                }
              } else if (
                module.template &&
                typeof module.template === 'string'
              ) {
                console.log('📝 OTHER: Using direct template HTML');
                finalTemplateContent = module.template;
              } else {
                finalTemplateContent = '';
              }

              await sendEmailModule(
                {
                  ...module,
                  template: finalTemplateContent,
                },
                from,
                subject,
                emailId
              );
              addRunStep({
                stepKey: 'reply-email-send',
                stepName: 'Reply Email Send',
                status: 'success',
                message: 'Reply email sent successfully.',
                location: from,
                meta: {
                  moduleId: module.id || module._id,
                  templateId: tpl?._id || null,
                  templateName: tpl?.name || module.template || '',
                  service: matchedService,
                  stepType,
                },
              });

              if (sendResult?.success) {
                addRunStep({
                  stepKey: 'reply-email-send',
                  stepName: 'Reply Email Send',
                  status: 'success',
                  message: 'Reply email sent successfully.',
                  location: from,
                  meta: {
                    moduleId: module.id || module._id,
                    replyEmailId: sendResult.replyEmailId,
                    templateId: tpl?._id || null,
                    templateName: tpl?.name || module.template || '',
                    service: matchedService,
                    stepType,
                  },
                });
              }
            }
          }
        }

        continue;
      }

      console.log('🛍 Running Shopify Scenario Logic...');

      const subjectLower = (subject || '').toLowerCase().trim();

      const isShopifyInquiry = subjectLower.startsWith(
        'shopify partner directory: new service inquiry from'
      );

      if (!isShopifyInquiry) {
        console.log(
          '⛔ Not a Shopify Partner Directory inquiry — skipping Shopify scenario only.'
        );
        continue;
      }

      console.log(`🧱 Branch Count: ${scenario.routerBranches?.length || 0}`);

      for (const branch of scenario.routerBranches) {
        console.log('---------------------------------------');
        console.log(`🌿 Branch ID: ${branch.id || branch._id}`);
        console.log(
          `🔎 Branch Conditions: ${branch.filter?.conditions?.length || 0}`
        );

        const matches = branch.filter?.conditions?.length
          ? branch.filter.conditions.every((cond) => {
              const fieldValue =
                cond.field?.toLowerCase() === 'body'
                  ? (body || '').toLowerCase()
                  : cond.field?.toLowerCase() === 'subject'
                    ? (subject || '').toLowerCase()
                    : '';
              const condValue = (cond.value || '').toLowerCase();

              console.log(
                `   Checking: [${cond.field}] ${cond.operator} "${cond.value}"`
              );

              switch (cond.operator?.toLowerCase()) {
                case 'contains':
                  return fieldValue.includes(condValue);
                case 'equals':
                case 'equal to':
                  return fieldValue === condValue;
                default:
                  return false;
              }
            })
          : true;

        if (!matches) {
          console.log('❌ Branch conditions did NOT match — skipping.');
          continue;
        }

        console.log('✅ Branch conditions matched — proceeding...');
        if (!branch.modules?.length) {
          console.log('⚠️ No modules found in this branch, skipping...');
          continue;
        }

        console.log(`📦 Modules found: ${branch.modules.length}`);

        let statusDoc = await AutomationStatusModel.create({
          userId,
          emailId,
          scenarioId: scenario._id,
          branchId: branch.id || branch._id,
          status: 'pending',
          completedModules: [],
          pendingModules: branch.modules.map((m) => m.id || m._id),
        });
        console.log('🗂️ Created AutomationStatus:', statusDoc._id);

        for (let i = 0; i < branch.modules.length; i++) {
          const module = branch.modules[i];
          console.log(`---------------------------------------`);
          console.log(
            `⚙️ Executing Module: ${module.app?.name || module.type} (Index ${i})`
          );

          try {
            const normalizedModule = normalizeModuleType(module);
            Object.assign(module, normalizedModule);

            console.log('🧠 Normalized current module:', moduleDebug(module));

            // if (module.type === 'Delay') {
            //   if (!module.delayValue || !module.delayUnit) continue;

            //   const delayMs = convertToMs(module.delayValue, module.delayUnit);

            //   const remainingModules = branch.modules
            //     .slice(i + 1)
            //     .filter((m) =>
            //       ['Send an Email', 'Custom Email'].includes(m.type)
            //     );

            //   await DelayJobModel.create({
            //     userId,
            //     emailData,
            //     emailId,
            //     scenarioId: scenario._id,
            //     modulesLeft: remainingModules,
            //     scheduledAt: new Date(Date.now() + delayMs),
            //   });

            //   await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
            //     $push: { completedModules: module.id || module._id },
            //     $set: {
            //       pendingModules: remainingModules.map((m) => m.id || m._id),
            //       status: 'partial',
            //       lastExecutedAt: new Date(),
            //     },
            //   });

            //   break;
            // }
            if (module.type === 'Delay') {
              console.log('⏳ Delay module detected:', moduleDebug(module));

              if (!module.delayValue || !module.delayUnit) {
                console.log(
                  '⚠️ Delay skipped — delayValue or delayUnit missing:',
                  {
                    delayValue: module.delayValue,
                    delayUnit: module.delayUnit,
                  }
                );
                continue;
              }

              const delayMs = convertToMs(module.delayValue, module.delayUnit);

              const modulesAfterDelay = branch.modules
                .slice(i + 1)
                .map((m) => normalizeModuleType(m));

              console.log(
                '🧩 Modules after delay before filtering:',
                modulesAfterDelay.map(moduleDebug)
              );

              const remainingModulesRaw = modulesAfterDelay.filter((m) => {
                const valid =
                  isEmailModule(m) && isValidConnectionId(m.connectionId);

                console.log('🔍 Checking delayed remaining module:', {
                  ...moduleDebug(m),
                  accepted: valid,
                  rejectedReason: !isEmailModule(m)
                    ? 'Not email module'
                    : !isValidConnectionId(m.connectionId)
                      ? 'Missing connectionId'
                      : null,
                });

                return valid;
              });

              const remainingModules = [];

              for (const delayedModule of remainingModulesRaw) {
                let templateContent =
                  delayedModule.template || 'Thanks for your email!';

                let stepType = 'initial';

                const lowerTpl = (delayedModule.template || '').toLowerCase();

                if (lowerTpl.includes('first')) {
                  stepType = 'first';
                } else if (lowerTpl.includes('second')) {
                  stepType = 'second';
                }

                const textToSearch =
                  `${subject || ''} ${body || ''}`.toLowerCase();

                const defaultServices = [
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

                let matchedService = defaultServices.find((s) =>
                  textToSearch.includes(s.toLowerCase())
                );

                matchedService = matchedService || 'General';

                const tpl =
                  (await TemplateModel.findOne({
                    userId,
                    platform: 'shopify',
                    service: new RegExp(`^${matchedService}$`, 'i'),
                    $or: [
                      {
                        name: new RegExp(
                          stepType === 'initial'
                            ? '(.*Initial Email.*|.*Initial Follow-up.*)'
                            : stepType === 'first'
                              ? '(.*First Email.*|.*First Follow-up.*)'
                              : '(.*Second Email.*|.*Second Follow-up.*)',
                          'i'
                        ),
                      },
                    ],
                    active: true,
                  })) ||
                  (await TemplateModel.findOne({
                    userId,
                    platform: 'shopify',
                    service: /^General$/i,
                    $or: [
                      {
                        name: new RegExp(
                          stepType === 'initial'
                            ? '(.*Initial Email.*|.*Initial Follow-up.*)'
                            : stepType === 'first'
                              ? '(.*First Email.*|.*First Follow-up.*)'
                              : '(.*Second Email.*|.*Second Follow-up.*)',
                          'i'
                        ),
                      },
                    ],
                    active: true,
                  }));

                if (tpl) {
                  templateContent = fillTemplate(tpl.content, extractedFields);

                  console.log('✅ Delayed module template content resolved:', {
                    moduleId: delayedModule.id || delayedModule._id,
                    originalTemplateName: delayedModule.template,
                    templateId: tpl._id,
                    templateName: tpl.name,
                    service: tpl.service,
                    stepType,
                    preview: templateContent.slice(0, 200),
                  });
                } else {
                  templateContent = fillTemplate(
                    templateContent,
                    extractedFields
                  );

                  console.log(
                    '⚠️ Template not found for delayed module. Using fallback/direct template:',
                    {
                      moduleId: delayedModule.id || delayedModule._id,
                      originalTemplateName: delayedModule.template,
                      matchedService,
                      stepType,
                      preview: templateContent.slice(0, 200),
                    }
                  );
                }

                remainingModules.push({
                  ...delayedModule,
                  template: templateContent,
                  templateName: delayedModule.template,
                  templateId: tpl?._id || null,
                  service: tpl?.service || matchedService,
                  stepType,
                });
              }

              console.log(
                ` Remaining delayed email modules: ${remainingModules.length}`,
                remainingModules.map(moduleDebug)
              );

              if (remainingModules.length === 0) {
                console.log(
                  'Delay found but no valid email modules after delay. Job will NOT be created.'
                );

                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $push: { completedModules: module.id || module._id },
                  $set: {
                    status: 'partial',
                    lastExecutedAt: new Date(),
                  },
                });

                break;
              }

              addRunStep({
                stepKey: 'delay-job-create',
                stepName: 'Delay Job Create',
                status: 'success',
                message: 'Delay job created successfully.',
                location: '',
                meta: {
                  delayValue: module.delayValue,
                  delayUnit: module.delayUnit,
                  scheduledAt: new Date(Date.now() + delayMs),
                  modulesLeftCount: remainingModules.length,
                },
              });

              runLogDoc = await ScenarioRunLogModel.create({
                userId,
                scenarioId: scenario._id,
                scenarioName: scenario.name || '',
                scenarioType: scenario.type || 'shopify',
                runType: 'live',
                status: 'partial',
                message: 'Scenario waiting for delayed modules.',
                service:
                  runSteps.find((s) => s.meta?.service)?.meta?.service || '',
                businessEmail: from || '',
                customerName: extractedFields.FullName || '',
                parentEmailId: emailId || null,
                replyEmailId:
                  runSteps.find((s) => s.meta?.replyEmailId)?.meta
                    ?.replyEmailId || null,
                templateId:
                  runSteps.find((s) => s.meta?.templateId)?.meta?.templateId ||
                  null,
                templateName:
                  runSteps.find((s) => s.meta?.templateName)?.meta
                    ?.templateName || '',
                steps: runSteps,
                requestPayload: { userId, from, subject, body, emailId },
                responsePayload: {
                  completedSteps: runSteps.length,
                  delayedModulesCount: remainingModules.length,
                },
                startedAt: runStartedAt,
                completedAt: null,
              });

              const delayJob = await DelayJobModel.create({
                userId,
                emailData,
                emailId,
                scenarioId: scenario._id,
                runLogId: runLogDoc._id,
                modulesLeft: remainingModules,
                scheduledAt: new Date(Date.now() + delayMs),
              });

              delayCreated = true;

              await ScenarioRunLogModel.findByIdAndUpdate(
                runLogDoc._id,
                {
                  $set: {
                    'steps.$[delayStep].location': delayJob._id.toString(),
                    'steps.$[delayStep].meta.delayJobId': delayJob._id,
                    'steps.$[delayStep].meta.scheduledAt': delayJob.scheduledAt,
                  },
                },
                {
                  arrayFilters: [{ 'delayStep.stepKey': 'delay-job-create' }],
                }
              );
              console.log('DelayJob created:', {
                delayJobId: delayJob._id,
                scheduledAt: delayJob.scheduledAt,
                modulesLeftCount: remainingModules.length,
                modulesLeft: remainingModules.map(moduleDebug),
              });
              addRunStep({
                stepKey: 'delay-job-create',
                stepName: 'Delay Job Create',
                status: 'success',
                message: 'Delay job created successfully.',
                location: delayJob._id.toString(),
                meta: {
                  delayValue: module.delayValue,
                  delayUnit: module.delayUnit,
                  scheduledAt: delayJob.scheduledAt,
                  modulesLeftCount: remainingModules.length,
                },
              });
              await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                $push: { completedModules: module.id || module._id },
                $set: {
                  pendingModules: remainingModules.map((m) => m.id || m._id),
                  status: 'partial',
                  lastExecutedAt: new Date(),
                },
              });

              break;
            }
            if (['Send an Email', 'Custom Email'].includes(module.type)) {
              if (!module.connectionId) continue;

              let templateContent = module.template || 'Thanks for your email!';
              let stepType = 'initial';

              // const subjectLower = (subject || '').toLowerCase().trim();

              // if (
              //   !subjectLower.startsWith(
              //     'shopify partner directory: new service inquiry from'
              //   )
              // ) {
              //   continue;
              // }

              const lowerTpl = (module.template || '').toLowerCase();
              if (lowerTpl.includes('first')) stepType = 'first';
              else if (lowerTpl.includes('second')) stepType = 'second';

              const textToSearch = (subject + ' ' + body).toLowerCase();

              const defaultServices = [
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

              let matchedService = defaultServices.find((s) =>
                textToSearch.includes(s.toLowerCase())
              );
              matchedService = matchedService || 'General';

              const tpl =
                (await TemplateModel.findOne({
                  userId,
                  platform: 'shopify',
                  service: new RegExp(`^${matchedService}$`, 'i'),
                  $or: [
                    {
                      name: new RegExp(
                        stepType === 'initial'
                          ? '(.*Initial Email.*|.*Initial Follow-up.*)'
                          : stepType === 'first'
                            ? '(.*First Email.*|.*First Follow-up.*)'
                            : '(.*Second Email.*|.*Second Follow-up.*)',
                        'i'
                      ),
                    },
                  ],
                  active: true,
                })) ||
                (await TemplateModel.findOne({
                  userId,
                  platform: 'shopify',
                  service: /^General$/i,
                  $or: [
                    {
                      name: new RegExp(
                        stepType === 'initial'
                          ? '(.*Initial Email.*|.*Initial Follow-up.*)'
                          : stepType === 'first'
                            ? '(.*First Email.*|.*First Follow-up.*)'
                            : '(.*Second Email.*|.*Second Follow-up.*)',
                        'i'
                      ),
                    },
                  ],
                  active: true,
                }));

              if (tpl) templateContent = tpl.content;

              templateContent = fillTemplate(templateContent, extractedFields);

              const sendResult = await sendEmailModule(
                {
                  ...module,
                  template: templateContent,
                  templateId: tpl?._id || null,
                  templateName: tpl?.name || module.template || '',
                  service: matchedService,
                  stepType,
                },
                from,
                subject,
                emailId
              );

              if (sendResult?.success) {
                addRunStep({
                  stepKey: 'reply-email-send',
                  stepName: 'Reply Email Send',
                  status: 'success',
                  message: 'Reply email sent successfully.',
                  location: from,
                  meta: {
                    moduleId: module.id || module._id,
                    replyEmailId: sendResult.replyEmailId,
                    templateId: tpl?._id || null,
                    templateName: tpl?.name || module.template || '',
                    service: matchedService,
                    stepType,
                  },
                });
              }
              const updated = await AutomationStatusModel.findByIdAndUpdate(
                statusDoc._id,
                {
                  $push: { completedModules: module.id || module._id },
                  $pull: { pendingModules: module.id || module._id },
                  $set: { lastExecutedAt: new Date() },
                },
                { new: true }
              );

              if (updated.pendingModules.length === 0) {
                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $set: { status: 'completed' },
                });
              } else {
                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $set: { status: 'partial' },
                });
              }
            }
          } catch (err) {
            await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
              $set: { status: 'failed', lastExecutedAt: new Date() },
            });
          }
        }

        const finalDoc = await AutomationStatusModel.findById(statusDoc._id);
        if (
          finalDoc &&
          finalDoc.pendingModules.length === 0 &&
          finalDoc.status !== 'failed'
        ) {
          await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
            $set: { status: 'completed', lastExecutedAt: new Date() },
          });
        }
      }

      if (!delayCreated) {
        await ScenarioRunLogModel.create({
          userId,
          scenarioId: scenario._id,
          scenarioName: scenario.name || '',
          scenarioType: scenario.type || 'shopify',
          runType: 'live',
          status: runSteps.some((s) => s.status === 'failed')
            ? 'failed'
            : runSteps.length > 0
              ? 'success'
              : 'partial',
          message:
            runSteps.length > 0
              ? 'Live scenario executed successfully.'
              : 'Scenario matched but no executable step completed.',
          service: runSteps.find((s) => s.meta?.service)?.meta?.service || '',
          businessEmail: from || '',
          customerName: extractedFields.FullName || '',
          parentEmailId: emailId || null,
          replyEmailId:
            runSteps.find((s) => s.meta?.replyEmailId)?.meta?.replyEmailId ||
            null,
          templateId:
            runSteps.find((s) => s.meta?.templateId)?.meta?.templateId || null,
          templateName:
            runSteps.find((s) => s.meta?.templateName)?.meta?.templateName ||
            '',
          steps: runSteps,
          requestPayload: { userId, from, subject, body, emailId },
          responsePayload: { completedSteps: runSteps.length },
          startedAt: runStartedAt,
          completedAt: new Date(),
        });
      }
    }

    console.log('🎉 All Scenarios Execution Complete!');
    console.log('=======================================');
  } catch (err) {
    console.error('🔥 Fatal Error in executeScenarios:', err);
  }
};

const convertToMs = (value, unit) => {
  if (!value) return 0;
  if (unit === 'seconds') return value * 1000;
  if (unit === 'minutes') return value * 60 * 1000;
  if (unit === 'hours') return value * 60 * 60 * 1000;
  return value;
};

export const sendEmailModule = async (
  module,
  to,
  originalSubject,
  parentEmailId,
  threadId = null,
  parentMessageId = null
) => {
  const log = (...args) =>
    console.log(`[${new Date().toISOString()}]`, ...args);

  try {
    log('=========================================');
    log('📤 [sendEmailModule] Triggered');
    log('📦 Module received:', {
      id: module.id || module._id,
      type: module.type,
      connectionId: module.connectionId,
      subject: module.subject,
      hasTemplate: !!module.template,
      templateLength: module.template?.length || 0,
      app: module.app,
    });
    log('🎯 Recipient:', to);
    log('💬 Original Subject:', originalSubject);

    if (!module.connectionId) {
      log('❌ Missing connectionId — cannot send email!');
      return;
    }

    // const connection = await ConnectionModel.findById(module.connectionId);
const connection = await ConnectionModel.findById(
  module.connectionId
).select('+smtp.password');
    if (!connection) {
      log('❌ Connection not found:', module.connectionId);
      return;
    }

    log('🔌 Connection found:', {
      provider: connection.provider,
      email: connection.email,
    });
    const user = await authModel.findById(connection.userId).lean();

    const isPro = user?.subscription?.plan === 'pro';
    const isAIActive = user?.Ai === true;

    if (isPro && isAIActive) {
      log('🤖 PRO PLAN + AI ENABLED → Gemini generating email');

    const aiReply = await generateGeminiReply({
  from: to,
  subject: originalSubject,
  body: module.template || '',
  user,
});

      module.template = aiReply; // 🔥 TEMPLATE REPLACED BY AI
    }
    // ✅ Prepare Subject
    const finalSubject =
      module.subject && module.subject.trim() !== ''
        ? module.subject
        : `Re: ${originalSubject || 'Shopify Inquiry'}`;
    const safeSubject = finalSubject.replace(/\r?\n|\r/g, ' ').trim();

    // ✅ Prepare Body
    let emailBody = module.template?.trim() || 'Thanks for your email!';
    if (!emailBody || emailBody.length === 0) {
      log('⚠️ Email body is empty — using fallback text.');
      emailBody = 'Thanks for your email!';
    }

    // 🧠 Wrap non-HTML text in <div>
    if (!emailBody.startsWith('<')) {
      emailBody = `<div>${emailBody}</div>`;
    }

    log('📧 ================= EMAIL CONTENT START =================');
    log(emailBody);
    log('📧 ================= EMAIL CONTENT END ===================');
    log(`📏 Email body length: ${emailBody.length} characters`);
    log('🧩 Email Body Preview (first 300 chars):', emailBody.slice(0, 300));

    const cc =
      (Array.isArray(module.cc) ? module.cc.join(',') : module.cc) || '';
    const bcc =
      (Array.isArray(module.bcc) ? module.bcc.join(',') : module.bcc) || '';

    let sentOk = false;
    let sentThreadId = null;
    let sentProviderMessageId = null;
    // =====================================================================
    // ------------------------ 📧 GMAIL PROVIDER ---------------------------
    // =====================================================================
  if (connection.provider === 'gmail') {
  let transporter = null;

  try {
    log('📨 Sending through Gmail SMTP + App Password...');

    if (!connection.smtp?.password) {
      throw new Error(
        'Gmail App Password is missing. Please reconnect the Gmail account.'
      );
    }

    const decryptedAppPassword = decrypt(
      connection.smtp.password
    );

    if (!decryptedAppPassword || (connection.smtp.password.includes(":") && decryptedAppPassword === connection.smtp.password)) {
      throw new Error(
        'Gmail App Password decryption failed due to invalid encryption key. Please reconnect your Gmail account on the Connections page.'
      );
    }

    const smtpPort = Number(
      connection.smtp?.port || 465
    );

    transporter = nodemailer.createTransport({
      host:
        connection.smtp?.host ||
        'smtp.gmail.com',

      port: smtpPort,

      secure: smtpPort === 465,

      auth: {
        user:
          connection.smtp?.username ||
          connection.email,

        pass: decryptedAppPassword,
      },

      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    await transporter.verify();

    log('✅ Gmail SMTP connection verified.');

    const info = await transporter.sendMail({
      from: {
        name:
          connection.name ||
          user?.fullName ||
          user?.organizationName ||
          'Email Sender',

        address: connection.email,
      },

      to,

      cc: cc || undefined,

      bcc: bcc || undefined,

      subject: safeSubject,

      html: emailBody,

      text: emailBody
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim(),

      replyTo: connection.email,

      inReplyTo:
        parentMessageId || undefined,

      references: parentMessageId
        ? [parentMessageId]
        : undefined,
    });

    log('✅ [GMAIL SMTP] Email sent successfully!');
    log('📨 Message ID:', info.messageId);

    sentOk = true;

    sentProviderMessageId =
      info.messageId || null;

    sentThreadId =
      threadId ||
      parentMessageId ||
      info.messageId ||
      null;
  } catch (err) {
    log('❌ [GMAIL SMTP] Send Error:', {
      message: err?.message,
      code: err?.code,
      response: err?.response,
      responseCode: err?.responseCode,
    });
  } finally {
    if (transporter) {
      transporter.close();
    }
  }
}

    // =====================================================================
    // ------------------------ 🟣 OUTLOOK PROVIDER -------------------------
    // =====================================================================
    else if (connection.provider === 'outlook') {
      try {
        log('🟣 Sending via Outlook API...');
        log(
          '🧾 Email HTML Content (first 300 chars):',
          emailBody.slice(0, 300)
        );

        const extractEmail = (input) => {
          const match = input.match(/<(.+?)>/);
          return match ? match[1] : input.trim();
        };

        const toClean = extractEmail(to);
        const ccClean = cc
          ? cc.split(',').map((addr) => ({
              emailAddress: { address: extractEmail(addr.trim()) },
            }))
          : [];

        const message = {
          message: {
            subject: safeSubject,
            body: { contentType: 'HTML', content: emailBody },
            toRecipients: [{ emailAddress: { address: toClean } }],
            ccRecipients: ccClean,
          },
          saveToSentItems: true,
        };

        log('⚙️ Outlook Payload:', JSON.stringify(message, null, 2));

        const response = await fetch(
          'https://graph.microsoft.com/v1.0/me/sendMail',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${connection.tokens.access_token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(message),
          }
        );

        if (response.ok) {
          log('✅ [OUTLOOK] Email sent successfully!');
          sentOk = true;
        } else {
          const errorText = await response.text();
          log('❌ [OUTLOOK] API Error:', errorText);
        }
      } catch (err) {
        log('❌ [OUTLOOK] Send Error:', err.message);
      }
    }

    // =====================================================================
    // ------------------------ 🟠 SMTP PROVIDER ----------------------------
    // =====================================================================
    else if (connection.provider === 'smtp') {
      try {
        log('🟠 Sending via SMTP...');
        log('🧾 SMTP Email HTML (first 300 chars):', emailBody.slice(0, 300));

        if (
          !connection.smtp?.host ||
          !connection.smtp?.username ||
          !connection.smtp?.password
        ) {
          throw new Error(`[SMTP] Missing credentials for ${connection.email}`);
        }

        const transporter = nodemailer.createTransport({
          host: connection.smtp.host,
          port: connection.smtp.port || 465,
          secure: connection.smtp.port === 465,
          auth: {
            user: connection.smtp.username || connection.email,
            pass: connection.smtp.password,
          },
          tls: { rejectUnauthorized: false },
        });

        await transporter.verify();
        log('✅ [SMTP] Connection verified.');

        const info = await transporter.sendMail({
          from: `"${connection.name || 'SMTP Sender'}" <${connection.email}>`,
          to,
          cc,
          bcc,
          subject: safeSubject,
          html: emailBody,
          inReplyTo: parentMessageId || undefined,
          references: parentMessageId ? [parentMessageId] : undefined,
        });

        log('✅ [SMTP] Email sent successfully!');
        log('📨 Message ID:', info.messageId);
        sentProviderMessageId = info.messageId || null;
        sentOk = true;
      } catch (err) {
        log('❌ [SMTP] Send Error:', err.message);
      }
    } else {
      log('❌ Unknown provider:', connection.provider);
    }

    if (sentOk) {
      const plainTextBody = emailBody.replace(/<\/?[^>]+(>|$)/g, '');
      log('💾 Saving sent email record...');
      log('🧾 HTML Saved Body (first 200 chars):', emailBody.slice(0, 200));

      const sentDoc = new EmailModel({
        userId: connection.userId,
        senderAddress: connection.email,
        recipientAddress: to,
        subject: safeSubject,
        textBody: plainTextBody,
        htmlBody: emailBody,
        direction: 'outgoing',
        messageId: sentProviderMessageId,
        connectionId: module.connectionId,
        threadId: sentThreadId || threadId || parentMessageId || null,
        inReplyTo: parentMessageId || null,
        references: parentMessageId ? [parentMessageId] : [],
        templateId: module.templateId || null,

        service: module.service || 'Unknown',
        stepType: module.stepType || 'initial',
        cc: cc ? cc.split(',').map((a) => a.trim()) : [],
        bcc: bcc ? bcc.split(',').map((a) => a.trim()) : [],
        date: new Date(),
        isForwarded: true,
        parentEmailId: parentEmailId || null,
        forwardedMeta: {
          from: connection.email,
          to,
          subject: originalSubject,
          date: new Date().toISOString(),
          body: emailBody,
        },
      });

      await sentDoc.save();
      log(' Sent email saved in DB with ID:', sentDoc._id);
      return {
        success: true,
        replyEmailId: sentDoc._id,
        templateId: sentDoc.templateId || null,
        threadId: sentDoc.threadId,

        service: sentDoc.service || '',
        stepType: sentDoc.stepType || 'initial',
      };
    } else {
      log('⚠️ Email not sent — skipping save.');
      return {
        success: false,
        replyEmailId: null,
      };
    }

    log('=========================================');
  } catch (outerErr) {
    console.error('🔥 [sendEmailModule] Fatal Error:', outerErr);
  }
};

export const updateLeadStatus = async (req, res) => {
  try {
    const { emailId } = req.params;
    const { leadStatus } = req.body;

    const allowedStatuses = ['new_lead', 'secured', 'closed'];

    if (!allowedStatuses.includes(leadStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid lead status',
      });
    }

    const email = await EmailModel.findByIdAndUpdate(
      emailId,
      { leadStatus },
      { new: true }
    );

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Lead status updated',
      data: email,
    });
  } catch (error) {
    console.error('updateLeadStatus error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

export const deleteSingleLead = async (req, res) => {
  try {
    const { emailId } = req.params;

    const email = await EmailModel.findByIdAndUpdate(
      emailId,
      { isDeleted: true },
      { new: true }
    );

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Lead deleted',
    });
  } catch (error) {
    console.error('deleteSingleLead error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

export const deleteMultipleLeads = async (req, res) => {
  try {
    const { emailIds } = req.body;

    if (!Array.isArray(emailIds) || emailIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'emailIds array is required',
      });
    }

    const validIds = emailIds.filter((id) =>
      mongoose.Types.ObjectId.isValid(id)
    );

    await EmailModel.updateMany(
      { _id: { $in: validIds } },
      { isDeleted: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Selected leads deleted',
    });
  } catch (error) {
    console.error('deleteMultipleLeads error:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
    });
  }
};

export const addLeadDiscussion = async (req, res) => {
  const log = (...args) =>
    console.log(`[addLeadDiscussion ${new Date().toISOString()}]`, ...args);

  const extractEmail = (value = '') => {
    const match = value.match(/<(.+?)>/);
    return (match ? match[1] : value).trim().toLowerCase();
  };

  const extractCustomerEmailFromBody = (email) => {
    const source = `${email?.textBody || ''} ${email?.htmlBody || ''}`;

    const matches = source.match(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
    );

    if (!matches?.length) return null;

    return matches.find((item) => {
      const lower = item.toLowerCase();

      return (
        !lower.includes('replexengine.com') &&
        !lower.includes('mail.replexengine.com') &&
        !lower.includes('shopifyexpertsteam.com')
      );
    });
  };

  try {
    const { emailId } = req.params;
    const { message, userId, connectionId: manualConnectionId } = req.body;

    log('API called', { emailId, userId });

    if (!message?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    // -------------------------------
    // ROOT EMAIL
    // -------------------------------
    const rootEmail = await EmailModel.findById(emailId);

    if (!rootEmail) {
      return res.status(404).json({
        success: false,
        message: 'Email not found',
      });
    }

    // -------------------------------
    // SMART CHILD DETECTION
    // -------------------------------
    const lastOutgoingChild = await EmailModel.findOne({
      $or: [
        { parentEmailId: rootEmail._id },
        { parentEmailId: rootEmail._id?.toString() },
        { threadId: rootEmail.threadId },
        { messageId: rootEmail.messageId },
      ],
      direction: 'outgoing',
    }).sort({ date: -1 });

    log('Last outgoing child found:', !!lastOutgoingChild);

    // -------------------------------
    // NO CHILD → ASK USER CONNECTION
    // -------------------------------
    if (!lastOutgoingChild && !manualConnectionId) {
      const connections = await ConnectionModel.find({
        userId: rootEmail.userId,
        status: 'active',
      }).select('_id email provider');

      return res.status(200).json({
        success: false,
        needConnectionSelection: true,
        message: 'Select which email account to send reply from',
        connections,
      });
    }

    // -------------------------------
    // CONNECTION RESOLUTION
    // -------------------------------
    let connectionId =
      manualConnectionId ||
      lastOutgoingChild?.connectionId;

    if (!connectionId) {
      const senderEmail = extractEmail(lastOutgoingChild?.senderAddress);

      const matchedConnection = await ConnectionModel.findOne({
        userId: rootEmail.userId,
        email: senderEmail,
        status: 'active',
      });

      if (!matchedConnection) {
        return res.status(400).json({
          success: false,
          message: `No active connection found for sender email: ${senderEmail}`,
        });
      }

      connectionId = matchedConnection._id;
    }

    if (!connectionId) {
      return res.status(400).json({
        success: false,
        message: 'Connection is required to send email',
      });
    }

    // -------------------------------
    // CUSTOMER EMAIL RESOLUTION
    // -------------------------------
    const customerEmail =
      extractEmail(rootEmail.senderAddress) ||
      extractCustomerEmailFromBody(rootEmail) ||
      extractEmail(lastOutgoingChild?.recipientAddress);

    if (!customerEmail) {
      return res.status(400).json({
        success: false,
        message: 'Customer email not found',
      });
    }

    // -------------------------------
    // SUBJECT
    // -------------------------------
    const subject = lastOutgoingChild?.subject?.startsWith('Re:')
      ? lastOutgoingChild.subject
      : `Re: ${rootEmail.subject || 'Lead Inquiry'}`;

    const cleanMessage = message.trim();

    const threadId =
      rootEmail.threadId ||
      lastOutgoingChild?.threadId ||
      rootEmail.messageId;

    const parentMessageId =
      lastOutgoingChild?.messageId || rootEmail.messageId;

    // -------------------------------
    // PAYLOAD
    // -------------------------------
    const modulePayload = {
      connectionId,
      subject,
      template: `<div>${cleanMessage.replace(/\n/g, '<br/>')}</div>`,
      service: lastOutgoingChild?.service || rootEmail.service,
      stepType: 'Manual Reply',
    };

    log('Sending email module...', modulePayload);

    const sendResult = await sendEmailModule(
      modulePayload,
      customerEmail,
      rootEmail.subject,
      rootEmail._id,
      threadId,
      parentMessageId
    );

    if (!sendResult?.success) {
      return res.status(500).json({
        success: false,
        message: 'Email send failed',
      });
    }

    // -------------------------------
    // UPDATE ROOT EMAIL STATUS
    // -------------------------------
    const updatedEmail = await EmailModel.findByIdAndUpdate(
      emailId,
      {
        leadStatus:
          rootEmail.leadStatus === 'new_lead' ? 'awaiting' : rootEmail.leadStatus,
      },
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Email sent successfully',
      data: updatedEmail,
      sentEmail: sendResult,
    });
  } catch (error) {
    console.error('[addLeadDiscussion ERROR]', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};


// export const RunTestMode = async (req, res) => {
//   const startedAt = new Date();
//   const steps = [];

//   const addStep = ({
//     stepKey,
//     stepName,
//     status,
//     message = '',
//     issue = '',
//     location = '',
//     suggestion = '',
//     meta = {},
//   }) => {
//     steps.push({
//       stepKey,
//       stepName,
//       status,
//       message,
//       issue,
//       location,
//       suggestion,
//       meta,
//       startedAt: new Date(),
//       completedAt: new Date(),
//     });
//   };

//   const saveRunLog = async ({
//     status,
//     message,
//     errorSummary = '',
//     errorDetails = {},
//     userId,
//     scenarioId = null,
//     scenarioName = 'Shopify Scenario',
//     service = '',
//     businessEmail = '',
//     fullName = '',
//     useGeneralTemplate = false,
//     parentEmail = null,
//     replyEmail = null,
//     selectedTemplate = null,
//     requestPayload = {},
//     responsePayload = {},
//   }) => {
//     try {
//       await ScenarioRunLogModel.create({
//         userId,
//         scenarioId,
//         scenarioName,
//         scenarioType: 'shopify',
//         runType: 'test',
//         status,
//         message,
//         service,
//         usedGeneralTemplate: useGeneralTemplate,
//         businessEmail,
//         customerName: fullName,
//         parentEmailId: parentEmail?._id || null,
//         replyEmailId: replyEmail?._id || null,
//         templateId: selectedTemplate?._id || null,
//         templateName: selectedTemplate?.name || '',
//         steps,
//         errorSummary,
//         errorDetails,
//         requestPayload,
//         responsePayload,
//         startedAt,
//         completedAt: new Date(),
//       });
//     } catch (logErr) {
//       console.error('Failed to save scenario run log:', logErr);
//     }
//   };

//   try {
//     const {
//       userId,
//       fullName,
//       businessEmail,
//       storeName,
//       country,
//       service,
//       budget,
//       helpDescription,
//       useGeneralTemplate = false,
//     } = req.body;

//     if (!userId || !fullName || !businessEmail || !service) {
//       addStep({
//         stepKey: 'request-validation',
//         stepName: 'Request Validation',
//         status: 'failed',
//         message: 'Missing required fields.',
//         issue: 'userId, fullName, businessEmail, or service is missing.',
//         location: 'RunTestMode request body',
//         suggestion: 'Send all required fields from frontend.',
//         meta: { body: req.body },
//       });

//       if (userId) {
//         await saveRunLog({
//           status: 'failed',
//           message: 'Missing required fields.',
//           errorSummary: 'Request validation failed.',
//           userId,
//           service,
//           businessEmail,
//           fullName,
//           useGeneralTemplate,
//           requestPayload: req.body,
//         });
//       }

//       return res.status(400).json({
//         success: false,
//         message: 'Missing required fields.',
//       });
//     }

//     addStep({
//       stepKey: 'request-validation',
//       stepName: 'Request Validation',
//       status: 'success',
//       message: 'Required fields are valid.',
//       location: 'RunTestMode request body',
//     });

//     const user = await authModel.findById(userId);

//     if (!user || !user.mailhook) {
//       addStep({
//         stepKey: 'mailhook-check',
//         stepName: 'Mailhook Check',
//         status: 'failed',
//         message: 'Mailhook not found for this user.',
//         issue: 'User does not exist or mailhook is missing.',
//         location: 'authModel user record',
//         suggestion: 'Create/connect mailhook before running test.',
//       });

//       await saveRunLog({
//         status: 'failed',
//         message: 'Mailhook not found for this user.',
//         errorSummary: 'Mailhook missing.',
//         userId,
//         service,
//         businessEmail,
//         fullName,
//         useGeneralTemplate,
//         requestPayload: req.body,
//       });

//       return res.status(404).json({
//         success: false,
//         message: 'Mailhook not found for this user.',
//       });
//     }

//     addStep({
//       stepKey: 'mailhook-check',
//       stepName: 'Mailhook Check',
//       status: 'success',
//       message: 'Mailhook found.',
//       location: user.mailhook,
//     });

//     const mailhook = user.mailhook;
//     const partnerName = user.fullName || 'The Fold Tech';
//     const dummyCustomer = fullName || 'Dummy Customer';

//     let testData = await TestEmailDataModel.findOne({ userId });

//     if (testData) {
//       Object.assign(testData, {
//         fullName,
//         businessEmail,
//         storeName,
//         country,
//         service,
//         budget,
//         helpDescription,
//       });
//       await testData.save();

//       addStep({
//         stepKey: 'test-input-save',
//         stepName: 'Test Input Save',
//         status: 'success',
//         message: 'Existing test input updated.',
//         location: String(testData._id),
//       });
//     } else {
//       testData = await TestEmailDataModel.create({
//         userId,
//         fullName,
//         businessEmail,
//         storeName,
//         country,
//         service,
//         budget,
//         helpDescription,
//       });

//       addStep({
//         stepKey: 'test-input-save',
//         stepName: 'Test Input Save',
//         status: 'success',
//         message: 'New test input saved.',
//         location: String(testData._id),
//       });
//     }

//     const storeSlug = storeName
//       ? storeName.toLowerCase().replace(/\s+/g, '')
//       : 'example';

//     const storeUrl = `https://${storeSlug}.myshopify.com`;

//     const parentSubject = `Shopify Partner Directory: New Service Inquiry from ${dummyCustomer} to ${partnerName}`;
//     const parentTextBody = helpDescription || 'No description provided.';

//     const parentHtmlBody = `
// <div style="font-family: Arial, Helvetica, sans-serif; color:#2b2b2b; line-height:1.6; background:#fff; padding:20px;">
//   <p>Hello <strong>${partnerName}</strong> and <strong>${dummyCustomer}</strong>,</p>
//   <p>
//     ${dummyCustomer} has expressed interest in your services through the
//     <strong>Shopify Partner Directory</strong>. ${partnerName}, to initiate the
//     conversation, please follow up with ${dummyCustomer} directly by selecting
//     <em>“Reply all”</em> when you reach out.
//   </p>
//   <p>All further communications will be between you both directly.</p>
//   <p>Details about ${dummyCustomer}'s request are provided below:</p>
//   <div style="border:1px solid #ddd; border-radius:8px; padding:20px; background-color:#fafafa; margin-top:15px;">
//     <h2 style="margin-top:0; color:#111;">Contact Form Submission</h2>
//     <p style="margin:8px 0;"><strong>Full name</strong><br>${dummyCustomer}</p>
//     <p style="margin:8px 0;">
//       <strong>Business email</strong><br>
//       <a href="mailto:${businessEmail}" style="color:#006eff; text-decoration:none;">${businessEmail}</a>
//     </p>
//     <p style="margin:8px 0;">
//       <strong>Select the store you're working on</strong><br>
//       ${storeName || 'N/A'}<br>
//       <a href="${storeUrl}" style="color:#006eff; text-decoration:none;">${storeUrl}</a>
//     </p>
//     <p style="margin:8px 0;"><strong>Country</strong><br>${country || 'N/A'}</p>
//     <p style="margin:8px 0;"><strong>Select a service offered by ${partnerName}</strong><br>${service}</p>
//     <p style="margin:8px 0;"><strong>Budget (USD)</strong><br>${budget || 'Not specified'}</p>
//     <p style="margin:8px 0;"><strong>Description</strong><br>${helpDescription || 'No additional information provided.'}</p>
//   </div>
//   <p style="margin-top:20px;">
//     Thank you for being a part of the <strong>Shopify Partner Directory</strong>.
//   </p>
//   <p style="font-weight:bold; margin-top:8px;">Sincerely,<br>The Shopify Team</p>
// </div>
// `;

//     const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//       },
//     });

//     const fromAddress = `Replex Engine <${process.env.EMAIL_USER}>`;

//     const parentSendInfo = await transporter.sendMail({
//       from: fromAddress,
//       to: mailhook,
//       subject: parentSubject,
//       text: parentTextBody,
//       html: parentHtmlBody,
//     });

//     addStep({
//       stepKey: 'parent-email-send',
//       stepName: 'Parent Test Email Send',
//       status: 'success',
//       message: 'Parent test email sent to mailhook.',
//       location: mailhook,
//       meta: { messageId: parentSendInfo.messageId },
//     });

//     const parentEmail = await EmailModel.create({
//       userId,
//       senderFirstName: dummyCustomer.split(' ')[0] || '',
//       senderLastName: dummyCustomer.split(' ').slice(1).join(' ') || '',
//       senderAddress: businessEmail,
//       recipientAddress: mailhook,
//       subject: parentSubject,
//       textBody: parentTextBody,
//       htmlBody: parentHtmlBody,
//       service,
//       stepType: 'shopify-test-parent',
//       messageId: parentSendInfo.messageId,
//       threadId: parentSendInfo.messageId,
//       date: new Date(),
//       isForwarded: false,
//       parentEmailId: null,
//       isTestEmail: true,
//       isValidateTestEmail: true,
//       extraFields: {
//         storeName,
//         storeUrl,
//         country,
//         budget,
//         helpDescription,
//       },
//     });

//     addStep({
//       stepKey: 'parent-email-save',
//       stepName: 'Parent Test Email Save',
//       status: 'success',
//       message: 'Parent test email saved in database.',
//       location: String(parentEmail._id),
//     });

//     let selectedTemplate = null;

//     if (useGeneralTemplate) {
//       selectedTemplate = await TemplateModel.findOne({
//         userId,
//         service: { $regex: /^general$/i },
//         active: true,
//         name: { $regex: /initial/i },
//       });
//     } else {
//       selectedTemplate = await TemplateModel.findOne({
//         userId,
//         service: { $regex: new RegExp(`^${service}$`, 'i') },
//         active: true,
//         name: { $regex: /initial/i },
//       });

//       if (!selectedTemplate) {
//         selectedTemplate = await TemplateModel.findOne({
//           userId,
//           service: { $regex: /^general$/i },
//           active: true,
//           name: { $regex: /initial/i },
//         });
//       }
//     }

//     if (!selectedTemplate) {
//       addStep({
//         stepKey: 'template-check',
//         stepName: 'Template Check',
//         status: 'failed',
//         message: 'No active Initial Email template found.',
//         issue: 'No active service or General Initial Email template exists.',
//         location: useGeneralTemplate
//           ? 'General templates'
//           : `${service} templates`,
//         suggestion:
//           'Activate an Initial Email template and run the test again.',
//       });

//       await saveRunLog({
//         status: 'failed',
//         message: 'No active Initial Email template found.',
//         errorSummary: 'Template missing.',
//         userId,
//         service,
//         businessEmail,
//         fullName,
//         useGeneralTemplate,
//         parentEmail,
//         requestPayload: req.body,
//       });

//       return res.status(404).json({
//         success: false,
//         message: 'No active Initial Email template found.',
//         parentEmail,
//       });
//     }

//     addStep({
//       stepKey: 'template-check',
//       stepName: 'Template Check',
//       status: 'success',
//       message: 'Template selected successfully.',
//       location: selectedTemplate.name,
//       meta: {
//         templateId: selectedTemplate._id,
//         service: selectedTemplate.service,
//       },
//     });

//     const replaceTemplateFields = (content = '') => {
//       return content
//         .replace(/{{FullName}}/g, dummyCustomer)
//         .replace(/{{Full name}}/g, dummyCustomer)
//         .replace(/{{BusinessEmail}}/g, businessEmail || '')
//         .replace(/{{Business email}}/g, businessEmail || '')
//         .replace(/{{StoreName}}/g, storeName || '')
//         .replace(/{{Store name}}/g, storeName || '')
//         .replace(/{{StoreURL}}/g, storeUrl)
//         .replace(/{{Store URL}}/g, storeUrl)
//         .replace(/{{Country}}/g, country || '')
//         .replace(/{{Service}}/g, service || '')
//         .replace(/{{Budget}}/g, budget || '')
//         .replace(/{{ProblemGoal}}/g, helpDescription || '')
//         .replace(/{{Problem & Goal}}/g, helpDescription || '');
//     };

//     const replyHtmlBody = replaceTemplateFields(selectedTemplate.content || '');

//     const replySubject = parentSubject.startsWith('Re:')
//       ? parentSubject
//       : `Re: ${parentSubject}`;

//     const scenario = await scenarioModel.findOne({ userId }).lean();

//     const allModules =
//       scenario?.routerBranches?.flatMap((branch) => branch.modules || []) || [];

//     console.log(
//       'ALL MODULES FOR TEST:',
//       allModules.map((m) => ({
//         id: m.id || m._id,
//         appName: m.app?.name,
//         displayName: m.app?.displayName,
//         defaultTemplate: m.app?.defaultTemplate,
//         template: m.template,
//         type: m.type,
//         emailType: m.emailType,
//         connectionId: m.connectionId,
//       }))
//     );

//     const initialEmailModule = allModules.find((m) => {
//       const text = [
//         m.app?.name,
//         m.app?.displayName,
//         m.app?.defaultTemplate,
//         m.template,
//         m.type,
//         m.emailType,
//       ]
//         .filter(Boolean)
//         .join(' ')
//         .toLowerCase();

//       return text.includes('initial email');
//     });

//     if (!initialEmailModule) {
//       addStep({
//         stepKey: 'initial-email-module-check',
//         stepName: 'Initial Email Module Check',
//         status: 'failed',
//         message: 'Initial Email module not found.',
//         issue: 'No Initial Email module exists in scenario.',
//         location: 'scenario.routerBranches.modules',
//         suggestion: 'Add Initial Email module and select a connection.',
//       });

//       await saveRunLog({
//         status: 'failed',
//         message: 'Initial Email module not found.',
//         errorSummary: 'Missing Initial Email module.',
//         userId,
//         service,
//         businessEmail,
//         fullName,
//         useGeneralTemplate,
//         parentEmail,
//         selectedTemplate,
//         requestPayload: req.body,
//       });

//       return res.status(400).json({
//         success: false,
//         message:
//           'Initial Email module not found. Please add Initial Email module first.',
//       });
//     }

//     if (!initialEmailModule.connectionId) {
//       addStep({
//         stepKey: 'initial-email-connection-check',
//         stepName: 'Initial Email Connection Check',
//         status: 'failed',
//         message: 'Initial Email module has no selected connection.',
//         issue: 'connectionId is missing from Initial Email module.',
//         location: 'scenario.routerBranches.modules.connectionId',
//         suggestion:
//           'Select Gmail/Outlook/SMTP connection in Initial Email module.',
//       });

//       await saveRunLog({
//         status: 'failed',
//         message: 'Initial Email module connection is missing.',
//         errorSummary: 'Missing connectionId.',
//         userId,
//         service,
//         businessEmail,
//         fullName,
//         useGeneralTemplate,
//         parentEmail,
//         selectedTemplate,
//         requestPayload: req.body,
//       });

//       return res.status(400).json({
//         success: false,
//         message:
//           'Initial Email module has no selected connection. Please select Gmail/Outlook/SMTP connection.',
//       });
//     }

//     const emailModulePayload = {
//       ...initialEmailModule,
//       connectionId: initialEmailModule.connectionId,
//       subject: replySubject,
//       template: replyHtmlBody,
//       templateId: selectedTemplate._id,
//       service: useGeneralTemplate ? 'General' : service,
//       stepType: 'Initial Email',
//     };

//     const sendResult = await sendEmailModule(
//       emailModulePayload,
//       businessEmail,
//       parentSubject,
//       parentEmail._id
//     );

//     if (!sendResult?.success) {
//       addStep({
//         stepKey: 'reply-email-send',
//         stepName: 'Reply Email Send',
//         status: 'failed',
//         message: 'Reply email failed through selected connection.',
//         issue: 'sendEmailModule returned false.',
//         location: String(initialEmailModule.connectionId),
//         suggestion: 'Check selected connection tokens/SMTP credentials.',
//       });

//       await saveRunLog({
//         status: 'failed',
//         message: 'Failed to send reply using selected connection.',
//         errorSummary: 'sendEmailModule failed.',
//         userId,
//         service,
//         businessEmail,
//         fullName,
//         useGeneralTemplate,
//         parentEmail,
//         selectedTemplate,
//         requestPayload: req.body,
//       });

//       return res.status(500).json({
//         success: false,
//         message: 'Failed to send email through selected connection.',
//       });
//     }

//     const replyEmail = await EmailModel.findById(sendResult.replyEmailId);

//     addStep({
//       stepKey: 'reply-email-send',
//       stepName: 'Reply Email Send',
//       status: 'success',
//       message: 'Reply email sent using selected DB connection.',
//       location: businessEmail,
//       meta: {
//         replyEmailId: sendResult.replyEmailId,
//         connectionId: initialEmailModule.connectionId,
//         templateId: selectedTemplate._id,
//         service: sendResult.service,
//         stepType: sendResult.stepType,
//       },
//     });

//     addStep({
//       stepKey: 'reply-email-save',
//       stepName: 'Reply Email Save',
//       status: 'success',
//       message: 'Reply email saved in database by sendEmailModule.',
//       location: String(replyEmail?._id || sendResult.replyEmailId),
//     });

//     await executeScenarios({
//       userId,
//       from: fromAddress,
//       subject: parentSubject,
//       body: parentTextBody,
//       emailId: parentSendInfo.messageId,
//       parsedEmailObj: {
//         from: {
//           value: [{ name: 'Replex Engine', address: process.env.EMAIL_USER }],
//         },
//         subject: parentSubject,
//         text: parentTextBody,
//         html: parentHtmlBody,
//       },
//     });

//     addStep({
//       stepKey: 'scenario-execution',
//       stepName: 'Scenario Execution',
//       status: 'success',
//       message: 'Scenario executed successfully.',
//       location: 'executeScenarios',
//     });

//     const responsePayload = {
//       parentEmailId: parentEmail._id,
//       replyEmailId: replyEmail?._id || sendResult.replyEmailId,
//       templateId: selectedTemplate._id,
//       connectionId: initialEmailModule.connectionId,
//     };

//     await saveRunLog({
//       status: 'success',
//       message: `Test email created, reply sent to ${businessEmail} using selected connection, and scenario executed.`,
//       userId,
//       service,
//       businessEmail,
//       fullName,
//       useGeneralTemplate,
//       parentEmail,
//       replyEmail,
//       selectedTemplate,
//       requestPayload: req.body,
//       responsePayload,
//     });

//     return res.json({
//       success: true,
//       message: `Test email created, reply sent to ${businessEmail} using selected connection, and scenario executed.`,
//       parentEmail,
//       replyEmail,
//       selectedTemplate,
//       testInputData: testData,
//       connectionId: initialEmailModule.connectionId,
//     });
//   } catch (err) {
//     console.error('Run Test Error:', err);

//     const {
//       userId,
//       fullName,
//       businessEmail,
//       service,
//       useGeneralTemplate = false,
//     } = req.body || {};

//     addStep({
//       stepKey: 'unexpected-error',
//       stepName: 'Unexpected Error',
//       status: 'failed',
//       message: 'Run test failed due to unexpected error.',
//       issue: err.message,
//       location: 'RunTestMode API',
//       suggestion: 'Check backend logs and failed step details.',
//     });

//     if (userId) {
//       await saveRunLog({
//         status: 'failed',
//         message: 'Failed to send test email or execute scenario.',
//         errorSummary: err.message,
//         errorDetails: {
//           stack: err.stack,
//         },
//         userId,
//         service,
//         businessEmail,
//         fullName,
//         useGeneralTemplate,
//         requestPayload: req.body,
//       });
//     }

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to send test email or execute scenario.',
//       error: err.message,
//     });
//   }
// };

export const RunTestMode = async (req, res) => {
  const startedAt = new Date();
  const steps = [];

  const addStep = ({
    stepKey,
    stepName,
    status,
    message = '',
    issue = '',
    location = '',
    suggestion = '',
    meta = {},
  }) => {
    steps.push({
      stepKey,
      stepName,
      status,
      message,
      issue,
      location,
      suggestion,
      meta,
      startedAt: new Date(),
      completedAt: new Date(),
    });
  };

  const saveRunLog = async ({
    status,
    message,
    errorSummary = '',
    errorDetails = {},
    userId,
    scenarioId = null,
    scenarioName = 'Shopify Scenario',
    service = '',
    businessEmail = '',
    fullName = '',
    useGeneralTemplate = false,
    parentEmail = null,
    replyEmail = null,
    selectedTemplate = null,
    requestPayload = {},
    responsePayload = {},
  }) => {
    try {
      await ScenarioRunLogModel.create({
        userId,
        scenarioId,
        scenarioName,
        scenarioType: 'shopify',
        runType: 'test',
        status,
        message,
        service,
        usedGeneralTemplate: useGeneralTemplate,
        businessEmail,
        customerName: fullName,
        parentEmailId: parentEmail?._id || null,
        replyEmailId: replyEmail?._id || null,
        templateId: selectedTemplate?._id || null,
        templateName: selectedTemplate?.name || '',
        steps,
        errorSummary,
        errorDetails,
        requestPayload,
        responsePayload,
        startedAt,
        completedAt: new Date(),
      });
    } catch (logErr) {
      console.error(
        '[RunTestMode] Failed to save scenario run log:',
        logErr
      );
    }
  };

  /*
   * ConnectionModel mein email field ka exact naam project ke
   * mutabiq mukhtalif ho sakta hai.
   *
   * Ye helper common field names check karega.
   */
  const getConnectionEmail = (connection = {}) => {
    const possibleEmails = [
      connection.email,
      connection.emailAddress,
      connection.accountEmail,
      connection.gmailEmail,
      connection.connectionEmail,
      connection.username,
      connection.userEmail,
      connection.profile?.email,
      connection.credentials?.email,
      connection.auth?.email,
    ];

    const email = possibleEmails.find(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0
    );

    return email?.trim() || '';
  };

  try {
    const {
      userId,
      scenarioId,
      fullName,
      businessEmail,
      storeName,
      country,
      service,
      budget,
      helpDescription,
      useGeneralTemplate = false,
    } = req.body;

    /*
     * Request validation
     */
    if (
      !userId ||
      !fullName ||
      !businessEmail ||
      !service
    ) {
      addStep({
        stepKey: 'request-validation',
        stepName: 'Request Validation',
        status: 'failed',
        message: 'Missing required fields.',
        issue:
          'userId, fullName, businessEmail, or service is missing.',
        location: 'RunTestMode request body',
        suggestion:
          'Send all required fields from frontend.',
        meta: {
          body: req.body,
        },
      });

      if (userId) {
        await saveRunLog({
          status: 'failed',
          message: 'Missing required fields.',
          errorSummary:
            'Request validation failed.',
          userId,
          scenarioId: scenarioId || null,
          service,
          businessEmail,
          fullName,
          useGeneralTemplate,
          requestPayload: req.body,
        });
      }

      return res.status(400).json({
        success: false,
        message:
          'userId, fullName, businessEmail and service are required.',
      });
    }

    addStep({
      stepKey: 'request-validation',
      stepName: 'Request Validation',
      status: 'success',
      message: 'Required fields are valid.',
      location: 'RunTestMode request body',
    });

    /*
     * User check
     */
    const user = await authModel
      .findById(userId)
      .lean();

    if (!user) {
      addStep({
        stepKey: 'user-check',
        stepName: 'User Check',
        status: 'failed',
        message: 'User not found.',
        issue: 'Invalid userId.',
        location: 'authModel',
        suggestion:
          'Login again and run the test.',
      });

      await saveRunLog({
        status: 'failed',
        message: 'User not found.',
        errorSummary: 'Invalid userId.',
        userId,
        scenarioId: scenarioId || null,
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        requestPayload: req.body,
      });

      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    addStep({
      stepKey: 'user-check',
      stepName: 'User Check',
      status: 'success',
      message: 'User found successfully.',
      location: String(user._id),
    });

    /*
     * Exact Shopify scenario load karein.
     *
     * scenarioId frontend se ho to exact scenario load hoga.
     * scenarioId na ho to current user's Shopify scenario load hoga.
     */
    const scenarioQuery = {
      userId,
      type: 'shopify',
    };

    if (scenarioId) {
      scenarioQuery._id = scenarioId;
    }

    const scenario = await scenarioModel
      .findOne(scenarioQuery)
      .sort({ updatedAt: -1 })
      .lean();

    if (!scenario) {
      addStep({
        stepKey: 'scenario-check',
        stepName: 'Scenario Check',
        status: 'failed',
        message: 'Shopify scenario not found.',
        issue:
          'Scenario does not exist or does not belong to this user.',
        location: 'scenarioModel',
        suggestion:
          'Save the Shopify scenario before running the test.',
      });

      await saveRunLog({
        status: 'failed',
        message: 'Shopify scenario not found.',
        errorSummary: 'Scenario missing.',
        userId,
        scenarioId: scenarioId || null,
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        requestPayload: req.body,
      });

      return res.status(404).json({
        success: false,
        message:
          'Shopify scenario not found. Save the scenario before running the test.',
      });
    }

    addStep({
      stepKey: 'scenario-check',
      stepName: 'Scenario Check',
      status: 'success',
      message: 'Shopify scenario found.',
      location: String(scenario._id),
      meta: {
        scenarioName: scenario.name,
      },
    });

    /*
     * Incoming Leads connection ID
     */
    const incomingLeadConnectionId =
      scenario.incomingLead?.connectionId?._id ||
      scenario.incomingLead?.connectionId ||
      '';

    if (!incomingLeadConnectionId) {
      addStep({
        stepKey:
          'incoming-lead-connection-check',
        stepName:
          'Incoming Leads Connection Check',
        status: 'failed',
        message:
          'Incoming Leads connection is not configured.',
        issue:
          'scenario.incomingLead.connectionId is missing.',
        location:
          'scenario.incomingLead.connectionId',
        suggestion:
          'Open Incoming Leads node, select Gmail connection and save the scenario.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'Incoming Leads connection is not configured.',
        errorSummary:
          'Incoming Leads connection missing.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        requestPayload: req.body,
      });

      return res.status(400).json({
        success: false,
        message:
          'Incoming Leads connection is not configured. Select a Gmail connection first.',
      });
    }

    /*
     * Incoming Leads selected connection load karein
     */
    const incomingConnection =
      await ConnectionModel.findOne({
        _id: incomingLeadConnectionId,
        userId,
        status: 'active',
      }).lean();

    if (!incomingConnection) {
      addStep({
        stepKey:
          'incoming-lead-connection-check',
        stepName:
          'Incoming Leads Connection Check',
        status: 'failed',
        message:
          'Incoming Leads connection is invalid or inactive.',
        issue:
          'Connection does not exist, is inactive, or belongs to another user.',
        location: String(
          incomingLeadConnectionId
        ),
        suggestion:
          'Reconnect the account from the Incoming Leads node.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'Incoming Leads connection is invalid or inactive.',
        errorSummary:
          'Invalid or inactive Incoming Leads connection.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        requestPayload: req.body,
      });

      return res.status(400).json({
        success: false,
        message:
          'Incoming Leads email connection is invalid or inactive. Please reconnect it.',
      });
    }

    /*
     * Selected connection se configured email address nikalein
     */
    const incomingLeadEmail =
      getConnectionEmail(incomingConnection);

    if (!incomingLeadEmail) {
      addStep({
        stepKey:
          'incoming-lead-email-check',
        stepName:
          'Incoming Leads Email Check',
        status: 'failed',
        message:
          'Selected connection does not contain an email address.',
        issue:
          'Email field was not found in ConnectionModel record.',
        location: String(
          incomingConnection._id
        ),
        suggestion:
          'Store the connected account email in the connection document.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'Incoming Leads email address was not found.',
        errorSummary:
          'Connection email missing.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        requestPayload: req.body,
      });

      return res.status(400).json({
        success: false,
        message:
          'Email address was not found in the selected Incoming Leads connection.',
      });
    }

    addStep({
      stepKey:
        'incoming-lead-connection-check',
      stepName:
        'Incoming Leads Connection Check',
      status: 'success',
      message:
        'Incoming Leads connection loaded successfully.',
      location: incomingLeadEmail,
      meta: {
        connectionId:
          incomingConnection._id,
        provider:
          incomingConnection.provider ||
          incomingConnection.type ||
          incomingConnection.appName ||
          scenario.incomingLead?.app?.name ||
          'Gmail',
      },
    });

    const partnerName =
      user.fullName || 'The Fold Tech';

    const dummyCustomer =
      fullName || 'Dummy Customer';

    /*
     * Test input save/update
     */
    let testData =
      await TestEmailDataModel.findOne({
        userId,
      });

    if (testData) {
      Object.assign(testData, {
        fullName,
        businessEmail,
        storeName,
        country,
        service,
        budget,
        helpDescription,
      });

      await testData.save();

      addStep({
        stepKey: 'test-input-save',
        stepName: 'Test Input Save',
        status: 'success',
        message:
          'Existing test input updated.',
        location: String(testData._id),
      });
    } else {
      testData =
        await TestEmailDataModel.create({
          userId,
          fullName,
          businessEmail,
          storeName,
          country,
          service,
          budget,
          helpDescription,
        });

      addStep({
        stepKey: 'test-input-save',
        stepName: 'Test Input Save',
        status: 'success',
        message: 'New test input saved.',
        location: String(testData._id),
      });
    }

    const storeSlug = storeName
      ? storeName
          .toLowerCase()
          .replace(/\s+/g, '')
      : 'example';

    const storeUrl =
      `https://${storeSlug}.myshopify.com`;

    /*
     * Incoming Leads node ka subject filter use karein.
     */
    const configuredSubjectFilter =
      scenario.incomingLead?.subjectFilter?.trim() ||
      'Shopify Partner Directory: New Service Inquiry from';

    const parentSubject =
      `${configuredSubjectFilter} ${dummyCustomer} to ${partnerName}`;

    const parentTextBody =
      helpDescription ||
      'No description provided.';

    const parentHtmlBody = `
<div style="font-family: Arial, Helvetica, sans-serif; color:#2b2b2b; line-height:1.6; background:#fff; padding:20px;">
  <p>Hello <strong>${partnerName}</strong> and <strong>${dummyCustomer}</strong>,</p>

  <p>
    ${dummyCustomer} has expressed interest in your services through the
    <strong>Shopify Partner Directory</strong>. ${partnerName}, to initiate the
    conversation, please follow up with ${dummyCustomer} directly by selecting
    <em>“Reply all”</em> when you reach out.
  </p>

  <p>All further communications will be between you both directly.</p>

  <p>Details about ${dummyCustomer}'s request are provided below:</p>

  <div style="border:1px solid #ddd; border-radius:8px; padding:20px; background-color:#fafafa; margin-top:15px;">
    <h2 style="margin-top:0; color:#111;">Contact Form Submission</h2>

    <p style="margin:8px 0;">
      <strong>Full name</strong><br>
      ${dummyCustomer}
    </p>

    <p style="margin:8px 0;">
      <strong>Business email</strong><br>
      <a href="mailto:${businessEmail}" style="color:#006eff; text-decoration:none;">
        ${businessEmail}
      </a>
    </p>

    <p style="margin:8px 0;">
      <strong>Select the store you're working on</strong><br>
      ${storeName || 'N/A'}<br>
      <a href="${storeUrl}" style="color:#006eff; text-decoration:none;">
        ${storeUrl}
      </a>
    </p>

    <p style="margin:8px 0;">
      <strong>Country</strong><br>
      ${country || 'N/A'}
    </p>

    <p style="margin:8px 0;">
      <strong>Select a service offered by ${partnerName}</strong><br>
      ${service}
    </p>

    <p style="margin:8px 0;">
      <strong>Budget (USD)</strong><br>
      ${budget || 'Not specified'}
    </p>

    <p style="margin:8px 0;">
      <strong>Description</strong><br>
      ${helpDescription || 'No additional information provided.'}
    </p>
  </div>

  <p style="margin-top:20px;">
    Thank you for being a part of the
    <strong>Shopify Partner Directory</strong>.
  </p>

  <p style="font-weight:bold; margin-top:8px;">
    Sincerely,<br>
    The Shopify Team
  </p>
</div>
`;

    /*
     * System sender transporter.
     *
     * Test lead configured Incoming Leads inbox par jayegi.
     */
    const transporter =
      nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS,
        },
      });

    const fromAddress =
      `Replex Engine <${process.env.EMAIL_USER}>`;

    const parentSendInfo =
      await transporter.sendMail({
        from: fromAddress,

        // Incoming Leads node ka configured email
        to: incomingLeadEmail,

        // Reply karne par customer email use hogi
        replyTo: businessEmail,

        subject: parentSubject,
        text: parentTextBody,
        html: parentHtmlBody,
      });

    addStep({
      stepKey: 'parent-email-send',
      stepName: 'Parent Test Email Send',
      status: 'success',
      message:
        'Parent test email sent to Incoming Leads configured inbox.',
      location: incomingLeadEmail,
      meta: {
        messageId:
          parentSendInfo.messageId,
        incomingConnectionId:
          incomingConnection._id,
        subjectFilter:
          configuredSubjectFilter,
      },
    });

    /*
     * Parent email DB save
     */
    const parentEmail =
      await EmailModel.create({
        userId,

        senderFirstName:
          dummyCustomer.split(' ')[0] || '',

        senderLastName:
          dummyCustomer
            .split(' ')
            .slice(1)
            .join(' ') || '',

        senderAddress: businessEmail,

        // Incoming Leads configured email
        recipientAddress:
          incomingLeadEmail,

        subject: parentSubject,
        textBody: parentTextBody,
        htmlBody: parentHtmlBody,
        service,
        stepType: 'shopify-test-parent',
        messageId:
          parentSendInfo.messageId,
        threadId:
          parentSendInfo.messageId,
        date: new Date(),
        isForwarded: false,
        parentEmailId: null,
        isTestEmail: true,
        isValidateTestEmail: true,

        extraFields: {
          storeName,
          storeUrl,
          country,
          budget,
          helpDescription,
          scenarioId: scenario._id,
          incomingConnectionId:
            incomingConnection._id,
          incomingLeadEmail,
          configuredSubjectFilter,
        },
      });

    addStep({
      stepKey: 'parent-email-save',
      stepName: 'Parent Test Email Save',
      status: 'success',
      message:
        'Parent test email saved in database.',
      location: String(parentEmail._id),
    });

    /*
     * Template selection
     */
    let selectedTemplate = null;

    if (useGeneralTemplate) {
      selectedTemplate =
        await TemplateModel.findOne({
          userId,
          service: {
            $regex: /^general$/i,
          },
          active: true,
          name: {
            $regex: /initial/i,
          },
        });
    } else {
      selectedTemplate =
        await TemplateModel.findOne({
          userId,
          service: {
            $regex: new RegExp(
              `^${service}$`,
              'i'
            ),
          },
          active: true,
          name: {
            $regex: /initial/i,
          },
        });

      if (!selectedTemplate) {
        selectedTemplate =
          await TemplateModel.findOne({
            userId,
            service: {
              $regex: /^general$/i,
            },
            active: true,
            name: {
              $regex: /initial/i,
            },
          });
      }
    }

    if (!selectedTemplate) {
      addStep({
        stepKey: 'template-check',
        stepName: 'Template Check',
        status: 'failed',
        message:
          'No active Initial Email template found.',
        issue:
          'No active service or General Initial Email template exists.',
        location: useGeneralTemplate
          ? 'General templates'
          : `${service} templates`,
        suggestion:
          'Activate an Initial Email template and run the test again.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'No active Initial Email template found.',
        errorSummary: 'Template missing.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        parentEmail,
        requestPayload: req.body,
      });

      return res.status(404).json({
        success: false,
        message:
          'No active Initial Email template found.',
        parentEmail,
      });
    }

    addStep({
      stepKey: 'template-check',
      stepName: 'Template Check',
      status: 'success',
      message:
        'Template selected successfully.',
      location: selectedTemplate.name,
      meta: {
        templateId:
          selectedTemplate._id,
        service:
          selectedTemplate.service,
      },
    });

    /*
     * Template variables replace
     */
    const replaceTemplateFields = (
      content = ''
    ) => {
      return content
        .replace(
          /{{FullName}}/g,
          dummyCustomer
        )
        .replace(
          /{{Full name}}/g,
          dummyCustomer
        )
        .replace(
          /{{BusinessEmail}}/g,
          businessEmail || ''
        )
        .replace(
          /{{Business email}}/g,
          businessEmail || ''
        )
        .replace(
          /{{StoreName}}/g,
          storeName || ''
        )
        .replace(
          /{{Store name}}/g,
          storeName || ''
        )
        .replace(
          /{{StoreURL}}/g,
          storeUrl
        )
        .replace(
          /{{Store URL}}/g,
          storeUrl
        )
        .replace(
          /{{Country}}/g,
          country || ''
        )
        .replace(
          /{{Service}}/g,
          service || ''
        )
        .replace(
          /{{Budget}}/g,
          budget || ''
        )
        .replace(
          /{{ProblemGoal}}/g,
          helpDescription || ''
        )
        .replace(
          /{{Problem & Goal}}/g,
          helpDescription || ''
        );
    };

    const replyHtmlBody =
      replaceTemplateFields(
        selectedTemplate.content || ''
      );

    const replySubject =
      parentSubject.startsWith('Re:')
        ? parentSubject
        : `Re: ${parentSubject}`;

    /*
     * Scenario pehle load ho chuka hai.
     * Dobara scenarioModel.findOne ki zarurat nahi.
     */
    const allModules =
      scenario?.routerBranches?.flatMap(
        (branch) =>
          branch.modules || []
      ) || [];

    console.log(
      '[RunTestMode] ALL MODULES:',
      allModules.map((module) => ({
        id: module.id || module._id,
        appName: module.app?.name,
        displayName:
          module.app?.displayName,
        defaultTemplate:
          module.app?.defaultTemplate,
        template: module.template,
        type: module.type,
        emailType: module.emailType,
        connectionId:
          module.connectionId,
      }))
    );

    /*
     * Initial Email module find
     */
    const initialEmailModule =
      allModules.find((module) => {
        const moduleText = [
          module.app?.name,
          module.app?.displayName,
          module.app?.defaultTemplate,
          module.type,
          module.emailType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return moduleText.includes(
          'initial email'
        );
      });

    if (!initialEmailModule) {
      addStep({
        stepKey:
          'initial-email-module-check',
        stepName:
          'Initial Email Module Check',
        status: 'failed',
        message:
          'Initial Email module not found.',
        issue:
          'No Initial Email module exists in scenario.',
        location:
          'scenario.routerBranches.modules',
        suggestion:
          'Add Initial Email module and select a connection.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'Initial Email module not found.',
        errorSummary:
          'Missing Initial Email module.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        parentEmail,
        selectedTemplate,
        requestPayload: req.body,
      });

      return res.status(400).json({
        success: false,
        message:
          'Initial Email module not found. Please add Initial Email module first.',
      });
    }

    if (!initialEmailModule.connectionId) {
      addStep({
        stepKey:
          'initial-email-connection-check',
        stepName:
          'Initial Email Connection Check',
        status: 'failed',
        message:
          'Initial Email module has no selected connection.',
        issue:
          'connectionId is missing from Initial Email module.',
        location:
          'scenario.routerBranches.modules.connectionId',
        suggestion:
          'Select Gmail, Outlook, or SMTP connection in Initial Email module.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'Initial Email module connection is missing.',
        errorSummary:
          'Missing connectionId.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        parentEmail,
        selectedTemplate,
        requestPayload: req.body,
      });

      return res.status(400).json({
        success: false,
        message:
          'Initial Email module has no selected connection. Please select Gmail, Outlook, or SMTP connection.',
      });
    }

    /*
     * Initial reply module payload
     */
    const emailModulePayload = {
      ...initialEmailModule,
      connectionId:
        initialEmailModule.connectionId,
      subject: replySubject,
      template: replyHtmlBody,
      templateId:
        selectedTemplate._id,
      service: useGeneralTemplate
        ? 'General'
        : service,
      stepType: 'Initial Email',
    };

    /*
     * Reply test customer's business email par jayega
     */
    const sendResult =
      await sendEmailModule(
        emailModulePayload,
        businessEmail,
        parentSubject,
        parentEmail._id
      );

    if (!sendResult?.success) {
      addStep({
        stepKey: 'reply-email-send',
        stepName: 'Reply Email Send',
        status: 'failed',
        message:
          'Reply email failed through selected connection.',
        issue:
          'sendEmailModule returned false.',
        location: String(
          initialEmailModule.connectionId
        ),
        suggestion:
          'Check selected connection tokens or SMTP credentials.',
      });

      await saveRunLog({
        status: 'failed',
        message:
          'Failed to send reply using selected connection.',
        errorSummary:
          'sendEmailModule failed.',
        userId,
        scenarioId: scenario._id,
        scenarioName:
          scenario.name || 'Shopify Scenario',
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        parentEmail,
        selectedTemplate,
        requestPayload: req.body,
      });

      return res.status(500).json({
        success: false,
        message:
          'Failed to send email through selected Initial Email connection.',
      });
    }

    const replyEmail =
      await EmailModel.findById(
        sendResult.replyEmailId
      );

    addStep({
      stepKey: 'reply-email-send',
      stepName: 'Reply Email Send',
      status: 'success',
      message:
        'Reply email sent using selected Initial Email connection.',
      location: businessEmail,
      meta: {
        replyEmailId:
          sendResult.replyEmailId,
        connectionId:
          initialEmailModule.connectionId,
        templateId:
          selectedTemplate._id,
        service: sendResult.service,
        stepType:
          sendResult.stepType,
      },
    });

    addStep({
      stepKey: 'reply-email-save',
      stepName: 'Reply Email Save',
      status: 'success',
      message:
        'Reply email saved in database by sendEmailModule.',
      location: String(
        replyEmail?._id ||
        sendResult.replyEmailId
      ),
    });

    /*
     * Scenario execution
     */
    await executeScenarios({
      userId,
      scenarioId: scenario._id,

      /*
       * Logical parsed sender test customer hai.
       */
      from: businessEmail,

      to: incomingLeadEmail,
      subject: parentSubject,
      body: parentTextBody,
      emailId:
        parentSendInfo.messageId,

      parsedEmailObj: {
        from: {
          value: [
            {
              name: dummyCustomer,
              address: businessEmail,
            },
          ],
        },

        to: {
          value: [
            {
              name:
                incomingConnection.name ||
                scenario.incomingLead?.app
                  ?.name ||
                'Incoming Leads',
              address:
                incomingLeadEmail,
            },
          ],
        },

        replyTo: {
          value: [
            {
              name: dummyCustomer,
              address: businessEmail,
            },
          ],
        },

        subject: parentSubject,
        text: parentTextBody,
        html: parentHtmlBody,
      },
    });

    addStep({
      stepKey: 'scenario-execution',
      stepName: 'Scenario Execution',
      status: 'success',
      message:
        'Scenario executed successfully.',
      location: 'executeScenarios',
      meta: {
        scenarioId: scenario._id,
        incomingLeadEmail,
      },
    });

    const responsePayload = {
      scenarioId: scenario._id,
      parentEmailId:
        parentEmail._id,
      replyEmailId:
        replyEmail?._id ||
        sendResult.replyEmailId,
      templateId:
        selectedTemplate._id,
      incomingConnectionId:
        incomingConnection._id,
      incomingLeadEmail,
      initialEmailConnectionId:
        initialEmailModule.connectionId,
      subjectFilter:
        configuredSubjectFilter,
    };

    await saveRunLog({
      status: 'success',
      message:
        `Test lead sent to ${incomingLeadEmail}, reply sent to ${businessEmail}, and scenario executed.`,
      userId,
      scenarioId: scenario._id,
      scenarioName:
        scenario.name ||
        'Shopify Scenario',
      service,
      businessEmail,
      fullName,
      useGeneralTemplate,
      parentEmail,
      replyEmail,
      selectedTemplate,
      requestPayload: req.body,
      responsePayload,
    });

    return res.status(200).json({
      success: true,
      message:
        `Test lead sent to ${incomingLeadEmail}. Initial reply sent to ${businessEmail}.`,

      scenarioId: scenario._id,

      incomingLead: {
        email: incomingLeadEmail,
        connectionId:
          incomingConnection._id,
        subjectFilter:
          configuredSubjectFilter,
      },

      parentEmail,
      replyEmail,
      selectedTemplate,
      testInputData: testData,

      initialEmailConnectionId:
        initialEmailModule.connectionId,
    });
  } catch (err) {
    console.error(
      '[RunTestMode] Error:',
      err
    );

    const {
      userId,
      scenarioId,
      fullName,
      businessEmail,
      service,
      useGeneralTemplate = false,
    } = req.body || {};

    addStep({
      stepKey: 'unexpected-error',
      stepName: 'Unexpected Error',
      status: 'failed',
      message:
        'Run test failed due to unexpected error.',
      issue:
        err?.message ||
        'Unknown error',
      location: 'RunTestMode API',
      suggestion:
        'Check backend logs and failed step details.',
    });

    if (userId) {
      await saveRunLog({
        status: 'failed',
        message:
          'Failed to send test email or execute scenario.',
        errorSummary:
          err?.message ||
          'Unknown error',
        errorDetails: {
          stack: err?.stack || '',
        },
        userId,
        scenarioId:
          scenarioId || null,
        service,
        businessEmail,
        fullName,
        useGeneralTemplate,
        requestPayload:
          req.body || {},
      });
    }

    return res.status(500).json({
      success: false,
      message:
        'Failed to send test email or execute scenario.',
      error:
        err?.message ||
        'Unknown error',
    });
  }
};

export const RunCustomTestMode = async (req, res) => {
  try {
    const { userId, emailType, subject, body } = req.body;

    if (!userId || !emailType || !subject || !body) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields.',
      });
    }

    const user = await authModel.findById(userId);
    if (!user || !user.mailhook) {
      return res.status(404).json({
        success: false,
        message: 'Mailhook not found for this user.',
      });
    }

    const mailhook = user.mailhook;
    const partnerName = user.fullName || 'Replex Engine';

    let testData = await TestEmailDataModel.findOne({ userId });

    if (testData) {
      Object.assign(testData, {
        Emailtype: emailType,
        helpDescription: body,
        service: 'custom',
        lastUpdated: new Date(),
      });
      await testData.save();
    } else {
      testData = await TestEmailDataModel.create({
        userId,
        businessEmail: 'custom@test.com',
        Emailtype: emailType,
        helpDescription: body,
        service: 'custom',
      });
    }

    const htmlBody = `
      <div style="font-family: Arial; color:#333">
        <p><strong>Custom Test Email Triggered</strong></p>
        <p><strong>Email Type:</strong> ${emailType}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Body:</strong><br>${body}</p>

        <hr style="margin-top:20px;">
        <p>This email was generated for testing your custom scenario.</p>
      </div>
    `;

    const textBody = body;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const emailId = `custom-test-${Date.now()}`;
    const fromAddress = `Replex Engine <${process.env.EMAIL_USER}>`;

    await transporter.sendMail({
      from: fromAddress,
      to: mailhook,
      subject,
      text: textBody,
      html: htmlBody,
    });

    const savedEmail = await EmailModel.create({
      userId,
      senderFirstName: partnerName,
      senderAddress: process.env.EMAIL_USER,
      recipientAddress: mailhook,
      subject,
      textBody,
      htmlBody,
      isForwarded: false,
      parentEmailId: emailId,
      date: new Date(),
      isTestEmail: true,
      emailType: 'custom',
    });

    await executeScenarios({
      userId,
      from: fromAddress,
      subject,
      body: textBody,
      emailId,
      parsedEmailObj: {
        from: {
          value: [{ name: 'Replex Engine', address: process.env.EMAIL_USER }],
        },
        subject,
        text: textBody,
        html: htmlBody,
      },
    });

    res.json({
      success: true,
      message: 'Custom test email sent & scenario executed successfully.',
      testEmail: savedEmail,
      testInputData: testData,
    });
  } catch (err) {
    console.error('Custom Run Test Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to execute custom test scenario.',
      error: err.message,
    });
  }
};

export const getTestEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId in request params',
      });
    }

    const latestEmail = await EmailModel.findOne({
      userId,
      isTestEmail: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!latestEmail) {
      return res.status(404).json({
        success: false,
        message: 'No test email found for this user.',
      });
    }

    res.json({
      success: true,
      message: 'Latest test email fetched successfully!',
      email: latestEmail,
    });
  } catch (error) {
    console.error('[getTestEmail] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching test email.',
      error: error.message,
    });
  }
};

export const getLatestServiceEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId in request params',
      });
    }

    const latestEmail = await TestEmailDataModel.findOne({
      userId,
      service: 'custom', // FIXED → always custom
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!latestEmail) {
      return res.status(404).json({
        success: false,
        message: 'No custom service email found.',
      });
    }

    res.json({
      success: true,
      message: 'Latest custom email fetched successfully!',
      email: latestEmail,
    });
  } catch (error) {
    console.error('[getLatestServiceEmail] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching latest custom email.',
      error: error.message,
    });
  }
};

export const getEmailsForUsers = async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const totalEmails = await EmailModel.countDocuments({
      userId,
      isForwarded: false,
      parentEmailId: null,
    });

    const emails = await EmailModel.find({
      userId,
      isForwarded: false,
      parentEmailId: null,
    })
      .sort({ date: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    if (!emails || emails.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No parent emails found for this user',
      });
    }

    const emailIds = emails.map((e) => e._id.toString());

    const statuses = await AutomationStatusModel.find({
      userId,
      emailId: { $in: emailIds },
    })
      .populate('scenarioId', 'name type')
      .lean();

    const statusMap = {};
    statuses.forEach((s) => {
      if (!statusMap[s.emailId]) statusMap[s.emailId] = [];
      statusMap[s.emailId].push(s);
    });

    const result = emails.map((email) => ({
      ...email,
      statuses: statusMap[email._id.toString()] || [],
    }));

    const allEmails = await EmailModel.find({
      userId,
      isForwarded: false,
      parentEmailId: null,
    }).lean();

    let stats = {
      total: allEmails.length,
      processed: 0,
      partial: 0,
      failed: 0,
      pending: 0,
    };

    const allStatuses = await AutomationStatusModel.find({
      userId,
      emailId: { $in: allEmails.map((e) => e._id.toString()) },
    }).lean();

    const allStatusMap = {};
    allStatuses.forEach((s) => {
      if (!allStatusMap[s.emailId]) allStatusMap[s.emailId] = [];
      allStatusMap[s.emailId].push(s);
    });

    allEmails.forEach((email) => {
      const sList = allStatusMap[email._id.toString()] || [];

      if (!sList.length) {
        stats.pending++;
      } else if (sList.every((s) => s.status === 'completed')) {
        stats.processed++;
      } else if (sList.every((s) => s.status === 'failed')) {
        stats.failed++;
      } else if (sList.some((s) => s.status === 'partial')) {
        stats.partial++;
      } else if (sList.every((s) => s.status === 'pending')) {
        stats.pending++;
      } else {
        stats.pending++;
      }
    });

    return res.json({
      success: true,
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalEmails / parseInt(limit)),
      totalEmails,
      stats,
      data: result,
    });
  } catch (err) {
    console.error('❌ getEmailsForUsers error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching parent emails',
    });
  }
};

// export const getEmailDataforUser = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     if (!userId) {
//       return res.status(400).json({
//         success: false,
//         message: 'User ID is required',
//       });
//     }

//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid user ID format',
//       });
//     }

//     // 1️⃣ Get all emails for this user
//     const userEmails = await EmailModel.find({ userId })
//       .populate('userId', 'name email')
//       .populate('templateId')
//       .lean();

//     if (!userEmails.length) {
//       return res.status(404).json({
//         success: false,
//         message: 'No emails found for this user',
//       });
//     }

//     // 2️⃣ Create a lookup map for quick access
//     const emailMap = {};
//     userEmails.forEach(
//       (email) => (emailMap[email._id] = { ...email, children: [] })
//     );

//     // 3️⃣ Build the tree (root → replies)
//     const rootEmails = [];
//     userEmails.forEach((email) => {
//       if (email.parentEmailId && emailMap[email.parentEmailId]) {
//         emailMap[email.parentEmailId].children.push(emailMap[email._id]);
//       } else {
//         rootEmails.push(emailMap[email._id]);
//       }
//     });

//     // 4️⃣ Fetch automation statuses for all emails
//     const emailIds = userEmails.map((e) => e._id);
//     const statuses = await AutomationStatusModel.find({
//       emailId: { $in: emailIds },
//     })
//       .populate('scenarioId', 'name description')
//       .lean();

//     // 5️⃣ Return full user email hierarchy
//     res.status(200).json({
//       success: true,
//       data: {
//         userId,
//         totalEmails: userEmails.length,
//         rootEmails, // 👈 parent emails (with nested replies)
//         statuses, // 👈 all automation statuses for this user’s emails
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching emails for user:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error while fetching emails for user',
//       error: error.message,
//     });
//   }
// };

export const getEmailDataforUser = async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('\n=======================================');
    console.log(`📥 GET /mailhook/getAllEmailsData Triggered for User ID: ${userId}`);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.log(`❌ Invalid user ID format: ${userId}`);
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format',
      });
    }

    const userObjId = new mongoose.Types.ObjectId(userId);

    // 1. Fetch user account details
    const userDoc = await authModel.findById(userId).select('email mailhook').lean();
    console.log(`👤 User Account:`, userDoc ? { email: userDoc.email, mailhook: userDoc.mailhook } : 'Not found');

    // 2. Fetch all connections associated with this user
    const userConnections = await ConnectionModel.find({
      $or: [{ userId: userId }, { userId: userObjId }],
    }).select('_id email provider').lean();

    const connIds = userConnections.map((c) => c._id);
    const userEmailAddresses = [
      userDoc?.email,
      userDoc?.mailhook,
      ...userConnections.map((c) => c.email),
    ].filter(Boolean);

    console.log(`🔌 User Connections (${userConnections.length}):`, userConnections.map(c => `${c.provider}: ${c.email}`));
    console.log(`✉️ Search Target Addresses:`, userEmailAddresses);

    // 3. Build comprehensive query matching ANY user criteria (userId, connectionId, recipientAddress, senderAddress)
    const queryConditions = [
      { userId: userId },
      { userId: userObjId },
      ...(connIds.length ? [{ connectionId: { $in: connIds } }] : []),
    ];

    userEmailAddresses.forEach((addr) => {
      if (addr && typeof addr === 'string') {
        const cleanAddr = addr.trim();
        if (cleanAddr) {
          queryConditions.push({ recipientAddress: { $regex: cleanAddr, $options: 'i' } });
          queryConditions.push({ senderAddress: { $regex: cleanAddr, $options: 'i' } });
        }
      }
    });

    const userEmails = await EmailModel.find({ $or: queryConditions })
      .populate('userId', 'name email')
      .populate('templateId')
      .sort({ createdAt: -1 })
      .lean();

    console.log(`📄 Total Raw Emails Fetched from DB: ${userEmails.length}`);

    if (!userEmails.length) {
      console.log(`ℹ️ 0 emails found in DB for user ${userId}`);
      console.log('=======================================\n');
      return res.status(200).json({
        success: true,
        data: {
          userId,
          totalThreads: 0,
          threads: [],
        },
      });
    }

    // 4. Return ALL emails: identify root emails or fallback to all top-level emails without discarding any email
    let rootEmails = userEmails.filter((email) => {
      const hasNoParent =
        !email.parentEmailId ||
        email.parentEmailId === null ||
        email.parentEmailId === undefined ||
        email.parentEmailId === '';
      return hasNoParent;
    });

    if (!rootEmails.length) {
      rootEmails = userEmails;
    }

    console.log(`🌱 Root Lead Threads Identified: ${rootEmails.length}`);

    // Attach thread conversation items (strictly direct child replies or outgoing thread items)
    const emailsWithThreads = rootEmails.map((root) => {
      const rootIdStr = root._id.toString();

      const thread = userEmails.filter((e) => {
        const eIdStr = e._id.toString();
        const eParentStr = e.parentEmailId ? e.parentEmailId.toString() : '';

        // 1. Root email itself
        if (eIdStr === rootIdStr) return true;

        // 2. Direct child reply (incoming customer reply or outgoing scenario reply)
        if (eParentStr === rootIdStr) return true;

        // 3. Matching threadId for child/reply emails
        if (root.threadId && e.threadId && root.threadId === e.threadId && eParentStr) {
          return true;
        }

        return false;
      });

      console.log(`  🧵 Thread [Root ID: ${root._id}] "${root.subject}" => ${thread.length} message(s)`);

      return {
        ...root,
        conversation: thread.sort(
          (a, b) => new Date(a.date || a.createdAt) - new Date(b.date || b.createdAt)
        ),
      };
    });

    console.log(`✅ Returning ${emailsWithThreads.length} Thread(s) to Inbox UI`);
    console.log('=======================================\n');

    return res.status(200).json({
      success: true,
      data: {
        userId,
        totalThreads: emailsWithThreads.length,
        threads: emailsWithThreads,
      },
    });

  } catch (error) {
    console.error('❌ Error fetching emails for user:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message,
    });
  }
};

 

export const deleteAllConnections = async (req, res) => {
  try {
    const result = await ConnectionModel.deleteMany({});
    return res.status(200).json({
      success: true,
      message: 'All connections deleted successfully.',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('❌ [deleteAllConnections] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete connections.',
      error: error.message,
    });
  }
};

export const clearAllEmailsAndConnections = async (req, res) => {
  try {
    console.log('\n=======================================');
    console.log('🧹 CLEARING ALL EMAILS & CONNECTIONS DB...');
    const emailResult = await EmailModel.deleteMany({});
    const connResult = await ConnectionModel.deleteMany({});
    const statusResult = await AutomationStatusModel.deleteMany({});
    console.log(`✅ Cleared ${emailResult.deletedCount} Email record(s)`);
    console.log(`✅ Cleared ${connResult.deletedCount} Connection record(s)`);
    console.log(`✅ Cleared ${statusResult.deletedCount} AutomationStatus record(s)`);
    console.log('=======================================\n');

    return res.status(200).json({
      success: true,
      message: 'Emails, Connections, and Automation Status DB cleared successfully.',
      emailsDeleted: emailResult.deletedCount,
      connectionsDeleted: connResult.deletedCount,
      automationStatusesDeleted: statusResult.deletedCount,
    });
  } catch (error) {
    console.error('❌ [clearAllEmailsAndConnections] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to clear DB.',
      error: error.message,
    });
  }
};

export const getLatestVerificationEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    // 🔹 Fetch the latest email for the user (any sender)
    const email = await EmailModel.findOne({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (!email) {
      return res
        .status(404)
        .json({ message: 'No emails found for this user.' });
    }

    // 🔹 Build response with safe defaults
    const result = {
      subject: email.subject || '(No Subject)',
      date: email.date || email.createdAt,
      sender: email.senderAddress || 'Unknown Sender',
      textBody:
        email.textBody?.slice(0, 1000) ||
        email.htmlBody?.replace(/<[^>]*>?/gm, '').slice(0, 1000) ||
        '(No Content)',
      verificationUrl:
        email.verificationUrl ||
        email.extraFields?.https ||
        email.extraFields?.visit ||
        null,
      verificationCode: email.verificationCode || null,
    };

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('❌ Error fetching latest email:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const validateTestEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { toEmail } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid user ID.' });
    }

    if (!toEmail) {
      return res.status(400).json({
        success: false,
        message: 'Missing recipient email address (toEmail).',
      });
    }

    const user = await authModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: 'User not found.' });
    }

    const existing = await mailhookModel.findOne({
      userId,
      forwardingEmail: toEmail.toLowerCase(),
    });

    // if (existing) {
    //   return res.status(400).json({
    //     success: false,
    //     message: ` Forwarding is already set up for ${toEmail}. Please use a different email address.`,
    //   });
    // }

    const testSubject = 'Replex Engine Forwarding Validation Test';
    const testBody = `Hello,

This is a test email from Replex Engine to confirm that your email forwarding setup is working correctly.

If you receive this email, your mail forwarding is active and functioning.

— Replex Engine Team`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Replex Engine" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: testSubject,
      text: testBody,
    });

    return res.json({
      success: true,
      message: ` Test email sent to ${toEmail}. Once it reaches your mailhook, it will be recorded automatically.`,
      sentTo: toEmail,
    });
  } catch (err) {
    console.error('❌ Error sending validation test email:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email.',
      error: err.message,
    });
  }
};

export const getValidateEmail = async (req, res) => {
  console.log('================= VALIDATE EMAIL API START =================');

  try {
    const { userId } = req.params;
    const { cardId } = req.query;

    console.log('➡️ Incoming Params:', { userId });
    console.log('➡️ Incoming Query:', { cardId });

    // --------------------------------------------------
    // 1️⃣ Validate userId
    // --------------------------------------------------
    const isValidUserId = mongoose.Types.ObjectId.isValid(userId);
    console.log('🧪 userId valid:', isValidUserId);

    if (!isValidUserId) {
      console.log('❌ Invalid userId provided');
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID.',
      });
    }

    // --------------------------------------------------
    // 2️⃣ Find validation test record
    // --------------------------------------------------
    const testSubject = 'Replex Engine Forwarding Validation Test';
    console.log('🔍 Searching validation record with subject:', testSubject);

    const testRecord = await validationModel
      .findOne({ userId, subject: testSubject })
      .sort({ createdAt: -1 })
      .lean();

    console.log('📨 Validation record result:', testRecord);

    if (!testRecord) {
      console.log('⚠️ No validation email found yet');
      return res.status(404).json({
        success: false,
        message: 'Test forwarding email not yet received or verified.',
      });
    }

    // --------------------------------------------------
    // 3️⃣ Check verification status
    // --------------------------------------------------
    console.log('✅ Validation verified status:', testRecord.verified);

    if (testRecord.verified) {
      console.log('🟢 Validation PASSED, continuing...');

      // --------------------------------------------------
      // 4️⃣ Fetch user
      // --------------------------------------------------
      const user = await authModel.findById(userId).select('mailhook');
      console.log('👤 User fetched:', user);

      if (!user) {
        console.log('❌ User not found in DB');
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // --------------------------------------------------
      // 5️⃣ Check existing mailhook
      // --------------------------------------------------
      const existing = await mailhookModel.findOne({
        userId,
        forwardingEmail: testRecord.toEmail,
      });

      console.log('📎 Existing mailhook record:', existing);

      let updatedMailhook;

      // --------------------------------------------------
      // 6️⃣ Update existing card (if cardId present)
      // --------------------------------------------------
      if (cardId && mongoose.Types.ObjectId.isValid(cardId)) {
        console.log('✏️ Updating existing mailhook card:', cardId);

        updatedMailhook = await mailhookModel.findByIdAndUpdate(
          cardId,
          {
            forwardingEmail: testRecord.toEmail,
            connectionVerified: true,
            validationId: testRecord._id,
          },
          { new: true }
        );

        console.log('✏️ Update result:', updatedMailhook);

        if (!updatedMailhook) {
          console.log('❌ Mailhook card not found for update');
          return res.status(404).json({
            success: false,
            message: 'Mailhook card not found for the given ID.',
          });
        }
      }

      // --------------------------------------------------
      // 7️⃣ Create new mailhook (if no cardId)
      // --------------------------------------------------
      else {
        console.log('➕ Creating new mailhook card');

        if (!existing) {
          const newMailhook = new mailhookModel({
            userId,
            mailhook: user.mailhook,
            forwardingEmail: testRecord.toEmail,
            connectionVerified: true,
            validationId: testRecord._id,
          });

          updatedMailhook = await newMailhook.save();
          console.log('🆕 New mailhook created:', updatedMailhook);
        } else {
          console.log('⚠️ Mailhook already exists, skipping creation');
        }
      }
    } else {
      console.log('⏳ Validation email found BUT not verified yet');
    }

    // --------------------------------------------------
    // 8️⃣ Final Response
    // --------------------------------------------------
    console.log('📤 Sending final API response');

    return res.json({
      success: true,
      message: testRecord.verified
        ? '✅ Forwarding test verified and mailhook updated successfully.'
        : '⚙️ Test email found but not yet verified.',
      data: {
        id: testRecord._id,
        subject: testRecord.subject,
        toEmail: testRecord.toEmail,
        sentAt: testRecord.sentAt,
        verified: testRecord.verified,
        verifiedAt: testRecord.verifiedAt,
        status: testRecord.status,
        notes: testRecord.notes,
      },
    });
  } catch (err) {
    console.error('🔥 VALIDATE EMAIL API ERROR:', err);

    return res.status(500).json({
      success: false,
      message: 'Server error while checking forwarding validation.',
      error: err.message,
    });
  } finally {
    console.log('================= VALIDATE EMAIL API END =================\n');
  }
};

export const getTestEmailData = async (req, res) => {
  try {
    const { userId } = req.params;

    console.log(
      '🚀 [getTestEmailData] Starting Gmail forwarding verification for user:',
      userId
    );

    // Step 1️⃣: Check test data
    console.log('🔍 Searching test data for user...');
    const testData = await TestEmailDataModel.findOne({ userId });

    if (!testData) {
      console.warn('❌ No test data found for user:', userId);
      return res
        .status(404)
        .json({ success: false, message: 'No test data found.' });
    }

    console.log('✅ Test data found!');
    console.log('🧾 Test Data ID:', testData._id);

    // Step 2️⃣: Find Zenith test email
    console.log('🔍 Searching Zenith validation email...');
    const zenithEmail = await EmailModel.findOne({
      userId,
      subject: {
        $regex: 'Replex Engine Forwarding Validation Test',
        $options: 'i',
      },
      senderAddress: { $regex: process.env.EMAIL_USER, $options: 'i' },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!zenithEmail) {
      console.warn('❌ No Zenith validation email found for user:', userId);
      return res.status(404).json({
        success: false,
        message: 'No Zenith validation email received yet.',
      });
    }

    console.log('✅ Zenith validation email found!');
    console.log('🆔 Zenith Email ID:', zenithEmail._id);
    console.log('📨 Zenith Subject:', zenithEmail.subject);
    console.log('📧 Zenith From:', zenithEmail.senderAddress);
    console.log('📬 Zenith To:', zenithEmail.recipientAddress);

    // Step 3️⃣: Find Gmail confirmation email
    console.log('🔍 Searching Gmail forwarding confirmation email...');
    const gmailEmail = await EmailModel.findOne({
      userId,
      senderAddress: { $regex: 'forwarding-noreply@google.com', $options: 'i' },
      subject: { $regex: 'Gmail Forwarding Confirmation', $options: 'i' },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!gmailEmail) {
      console.warn(
        '❌ No Gmail forwarding confirmation email found for user:',
        userId
      );
      return res.status(404).json({
        success: false,
        message: 'No Gmail forwarding confirmation email received yet.',
      });
    }

    console.log('✅ Gmail forwarding confirmation email found!');
    console.log('🆔 Gmail Email ID:', gmailEmail._id);
    console.log('📧 Gmail From:', gmailEmail.senderAddress);
    console.log('📅 Gmail Date:', gmailEmail.date);

    // Step 4️⃣: Extract Gmail address from Zenith "From"
    console.log('🔍 Extracting Gmail address from Zenith sender...');
    const zenithSender = zenithEmail.senderAddress?.toLowerCase() || '';
    const extractedGmail = zenithSender.match(/<([^>]+)>/)?.[1] || zenithSender;

    console.log('📤 Extracted Gmail address from Zenith:', extractedGmail);

    const bodyText = gmailEmail.textBody?.toLowerCase() || '';
    console.log('🧾 Checking Gmail email body for match...');

    const isMatched = bodyText.includes(extractedGmail);

    if (!isMatched) {
      console.warn('❌ Gmail address mismatch detected!');
      console.warn('🔸 Expected Gmail:', extractedGmail);
      console.warn(
        '🔸 Gmail Body (first 200 chars):',
        bodyText.substring(0, 200)
      );

      return res.status(400).json({
        success: false,
        message:
          'Gmail address mismatch between Zenith and Gmail verification email.',
        data: {
          testDataId: testData._id,
          zenithEmailId: zenithEmail._id,
          gmailEmailId: gmailEmail._id,
          expectedGmail: extractedGmail,
        },
      });
    }

    console.log('✅ Gmail address successfully matched!');
    console.log('🎉 Gmail forwarding verification complete for user:', userId);

    // Step 5️⃣: Return success with all data
    return res.json({
      success: true,
      message:
        'Forwarding verification successful — Gmail and Zenith emails match.',
      data: {
        testData,
        zenithEmailId: zenithEmail._id,
        gmailEmailId: gmailEmail._id,
        gmailSubject: gmailEmail.subject,
        gmailDate: gmailEmail.date,
        verifiedGmail: extractedGmail,
      },
    });
  } catch (err) {
    console.error('💥 [getTestEmailData] Error:', err);
    res.status(500).json({
      success: false,
      message: 'Server error verifying forwarding setup.',
      error: err.message,
    });
  }
};

export const deleteConnectionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: 'Connection ID is required.' });
    }

    const existing = await ConnectionModel.findById(id);
    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: 'Connection not found.' });
    }

    await ConnectionModel.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: `Connection for ${existing.email} deleted successfully.`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Internal server error while deleting connection.',
      error: error.message,
    });
  }
};

export const updateConnectionById = async (req, res) => {
  try {
    const { id } = req.params;

    const { email, name, verified, status, smtp } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Connection ID is required.',
      });
    }

    const existing = await ConnectionModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Connection not found.',
      });
    }

    const updateData = {};

    if (email !== undefined) {
      updateData.email = email;
    }

    if (name !== undefined) {
      updateData.name = name;
    }

    if (verified !== undefined) {
      updateData.verified = verified;
    }

    if (status !== undefined) {
      if (!['active', 'disconnected'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status value.',
        });
      }

      updateData.status = status;
    }

    if (smtp !== undefined) {
      if (existing.provider !== 'smtp') {
        return res.status(400).json({
          success: false,
          message: 'SMTP details can only be updated for SMTP connections.',
        });
      }

      updateData.smtp = {
        ...existing.smtp,
        ...smtp,
      };
    }

    const updatedConnection = await ConnectionModel.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).select('-tokens -smtp.password');

    return res.status(200).json({
      success: true,
      message: 'Connection updated successfully.',
      data: updatedConnection,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A connection with this email already exists for this user.',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error while updating connection.',
      error: error.message,
    });
  }
};

export const sendTestEmail = async (req, res) => {
  try {
    const { toEmail, userId } = req.body;

    if (!toEmail || !userId) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing email or user ID' });
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

    const mailOptions = {
      from:
        process.env.SMTP_FROM || `"Replex Engine" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Replex Engine Test Email',
      text: `Hello,

This is a test email from Replex Engine to confirm that your mail forwarding is set up correctly.

If you received this email, forwarding is working fine.

Thank you,
Replex Engine Team`,
    };

    // 🔹 Send the
    await transporter.sendMail(mailOptions);

    return res.json({
      success: true,
      message: ` Test email sent successfully to ${toEmail}`,
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Failed to send test email', error });
  }
};

export const verifyConnection = async (req, res) => {
  const { connectionId } = req.body;

  console.log('🔍 [verifyConnection] Verifying connection:', connectionId);

  if (!connectionId) {
    return res
      .status(400)
      .json({ success: false, message: 'connectionId is required' });
  }

  try {
    const connection = await ConnectionModel.findById(connectionId);
    if (!connection) {
      return res
        .status(404)
        .json({ success: false, message: 'Connection not found' });
    }

    console.log(
      '🔌 Provider:',
      connection.provider,
      '| Email:',
      connection.email
    );

    let verified = false;

    if (connection.provider === 'gmail') {
      try {
        console.log('📨 Verifying Gmail OAuth2...');

        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials(connection.tokens);

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        await gmail.users.getProfile({ userId: 'me' });

        verified = true;
        console.log('✅ Gmail verification successful!');
      } catch (err) {
        console.error('❌ Gmail verification failed:', err.message);
      }
    } else if (connection.provider === 'outlook') {
      try {
        console.log('📨 Verifying Outlook token...');
        const resp = await fetch('https://graph.microsoft.com/v1.0/me', {
          headers: {
            Authorization: `Bearer ${connection.tokens.access_token}`,
          },
        });

        if (resp.ok) {
          verified = true;
          console.log('✅ Outlook verification successful!');
        } else {
          const error = await resp.text();
          console.error('❌ Outlook token invalid:', error);
        }
      } catch (err) {
        console.error('❌ Outlook verification failed:', err.message);
      }
    } else if (connection.provider === 'smtp') {
      try {
        console.log('📨 Verifying SMTP credentials...');

        if (
          !connection.smtp?.host ||
          !connection.smtp?.username ||
          !connection.smtp?.password
        ) {
          throw new Error('Missing SMTP credentials');
        }

        // const transporter = nodemailer.createTransport({
        //   host: connection.smtp.host,
        //   port: connection.smtp.port || 465,
        //   secure: connection.smtp.port === 465,
        //   auth: {
        //     user: connection.smtp.username,
        //     pass: connection.smtp.password,
        //   },
        //   tls: { rejectUnauthorized: false },
        // });
        const smtpPort = Number(connection.smtp.port || 587);
        console.log('SMTP CONFIG:', {
          host: connection.smtp.host,
          port: smtpPort,
          secure: smtpPort === 465,
          username: connection.smtp.username,
          email: connection.email,
        });

        const transporter = nodemailer.createTransport({
          host: connection.smtp.host,
          port: smtpPort,
          secure: smtpPort === 465,
          requireTLS: smtpPort === 587,
          auth: {
            user: connection.smtp.username || connection.email,
            pass: connection.smtp.password,
          },
          tls: {
            rejectUnauthorized: false,
          },
          connectionTimeout: 20000,
          greetingTimeout: 20000,
          socketTimeout: 30000,
        });
        await transporter.verify();
        verified = true;
        console.log('✅ SMTP verification successful!');
      } catch (err) {
        console.error('❌ SMTP verification failed:', err.message);
      }
    } else {
      console.error('❌ Unknown provider:', connection.provider);
    }

    if (verified) {
      connection.verified = true;
      await connection.save();

      console.log('💾 Connection marked as verified in DB:', connection._id);
      return res.json({
        success: true,
        message: 'Connection verified successfully!',
      });
    } else {
      connection.verified = false;
      await connection.save();

      return res.status(400).json({
        success: false,
        message: 'Verification failed. Invalid or expired credentials.',
      });
    }
  } catch (error) {
    console.error('🔥 [verifyConnection] Error:', error);
    res
      .status(500)
      .json({ success: false, message: 'Server error', error: error.message });
  }
};

export const getConnectionById = async (req, res) => {
  try {
    const connection = await ConnectionModel.findById(req.params.id);

    if (!connection) {
      return res
        .status(404)
        .json({ success: false, message: 'Connection not found' });
    }

    res.status(200).json(connection); // includes "verified"
  } catch (err) {
    console.error('❌ [getConnectionById] Error:', err);
    res
      .status(500)
      .json({ success: false, message: 'Server error', error: err.message });
  }
};
