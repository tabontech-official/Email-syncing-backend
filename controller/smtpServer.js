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

export const mailHookWebhook = async (req, res) => {
  try {
    console.log('==============================');
    console.log('📩 Incoming MailHook Webhook Triggered');
    console.log('Headers:', req.headers);
    console.log('Body keys:', Object.keys(req.body));
    console.log('Envelope:', req.body.envelope);
    console.log('Raw "to":', req.body.to);
    console.log('Raw "from":', req.body.from);
    console.log('Raw "subject":', req.body.subject);
    console.log('==============================');

    const rawEmail = req.body.email || null;
    let parsed = {};

    if (rawEmail) {
      console.log('📦 Raw email found — parsing with simpleParser...');
      parsed = await simpleParser(rawEmail);
    } else {
      console.log('⚙️ No raw email — using manual fallback parser...');
      parsed = {
        from: { value: [{ address: req.body.from, name: req.body.from }] },
        to: { value: [{ address: req.body.to, name: req.body.to }] },
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
        headers: req.body.headers || '',
      };
    }

    // 📜 Parsed summary
    console.log('📄 Parsed Email Summary:');
    console.log('  FROM:', parsed.from?.value?.[0]);
    console.log('  TO:', parsed.to?.value?.[0]);
    console.log('  SUBJECT:', parsed.subject);
    console.log('  TEXT LENGTH:', parsed.text?.length || 0);
    console.log('  HTML LENGTH:', parsed.html?.length || 0);
    console.log('----------------------------------------');

    const senderAddress = parsed.from?.value?.[0]?.address?.toLowerCase() || '';
    let mailhookAddress =
      req.body.envelope?.to ||
      (Array.isArray(req.body.to) ? req.body.to[0] : req.body.to) ||
      parsed.to?.value?.[0]?.address ||
      '';

    const headersRaw = req.body.headers || '';
    console.log('📫 Initial mailhookAddress candidate:', mailhookAddress);
    console.log('📋 Raw headers text:', headersRaw?.slice(0, 400), '...');

    // 🔍 Detect forwarding headers
    const forwardedMatch =
      headersRaw.match(/x-forwarded-to:\s*([^\s>]+)/i) ||
      headersRaw.match(/x-forwarded-for:\s*[^\s]+\s+([^\s>]+)/i) ||
      headersRaw.match(/delivered-to:\s*([^\s>]+)/i) ||
      headersRaw.match(/original-to:\s*([^\s>]+)/i);

    if (forwardedMatch && forwardedMatch[1]) {
      console.log('📬 Forwarding header found =>', forwardedMatch[1]);
      mailhookAddress = forwardedMatch[1];
    }

    if (mailhookAddress.includes('<')) {
      mailhookAddress = mailhookAddress.split('<')[1].replace('>', '').trim();
    }

    mailhookAddress = mailhookAddress.trim().toLowerCase();
    console.log('🎯 Final mailhookAddress:', mailhookAddress);

    // Check mailhook domain
    if (!mailhookAddress.endsWith('@mail.brandfer.com')) {
      console.log('⛔ Ignored — not a @mail.brandfer.com address.');
      console.log('🚫 mailhookAddress:', mailhookAddress);
      console.log('==============================');
      return res.status(200).send('Ignored — not a mailhook email.');
    }

    // Find user
    const user = await authModel.findOne({ mailhook: mailhookAddress });
    if (!user) {
      console.warn('⚠️ No matching user found for mailhook:', mailhookAddress);
      console.log('==============================');
      return res.status(200).send('No matching user found for mailhook.');
    }

    console.log('👤 Matched user:', user.email || user._id?.toString());

    // Forward detection
    let isForwarded = false;
    let headerString = '';

    if (parsed.headers && typeof parsed.headers.keys === 'function') {
      for (const [key, val] of parsed.headers.entries()) {
        headerString += `${key}: ${val}\n`;
      }
    } else if (typeof parsed.headers === 'string') {
      headerString = parsed.headers;
    } else if (headersRaw) {
      headerString = headersRaw;
    }

    const headerLower = headerString.toLowerCase();

    isForwarded =
      headerLower.includes('x-forwarded-for') ||
      headerLower.includes('x-forwarded-to') ||
      headerLower.includes('forwarding-noreply@google.com') ||
      headerLower.includes('@mail.brandfer.com') ||
      headerLower.includes('mail forwarding') ||
      parsed.subject?.toLowerCase().startsWith('fwd:') ||
      parsed.text?.toLowerCase().includes('forwarded message');

    console.log('📡 isForwarded?', isForwarded);
    console.log('Header sample:', headerString.slice(0, 400), '...');

    if (!isForwarded) {
      console.log('⏭️ Ignored — not a forwarded email.');
      console.log('==============================');
      return res.status(200).send('Ignored — not a forwarded email.');
    }

    // Validation forwarding test
    if (parsed.subject?.includes('Zenith Forwarding Validation Test')) {
      console.log('✅ Forwarding validation email detected...');
      let originalEmail = senderAddress;
      const xForwardedFor = headerLower.match(/x-forwarded-for:\s*([^\s]+)/i);
      if (xForwardedFor && xForwardedFor[1].includes('@')) {
        originalEmail = xForwardedFor[1].toLowerCase();
      }

      console.log('💡 Original email:', originalEmail);

      const existing = await validationModel.findOne({ userId: user._id });
      if (existing) {
        Object.assign(existing, {
          toEmail: originalEmail,
          subject: parsed.subject,
          body: parsed.text || parsed.html,
          sentAt: new Date(),
          verified: true,
          verifiedAt: new Date(),
          status: 'verified',
          notes: 'Forwarding verified successfully (via mailhook).',
        });
        await existing.save();
        console.log('🔄 Updated existing validation record');
      } else {
        await validationModel.create({
          userId: user._id,
          toEmail: originalEmail,
          subject: parsed.subject,
          body: parsed.text || parsed.html,
          sentAt: new Date(),
          verified: true,
          verifiedAt: new Date(),
          status: 'verified',
          notes: 'Forwarding verified successfully (via mailhook).',
        });
        console.log('✅ Created new validation record');
      }

      console.log('==============================');
      return res.status(200).send('✅ Forwarding verified successfully.');
    }

    // Forwarded normal email
    console.log('📨 Forwarded normal email detected — saving to DB...');
    const senderName = parsed.from?.value?.[0]?.name || '';
    const { firstName: senderFirstName, lastName: senderLastName } =
      splitName(senderName);
    const { firstName: recipientFirstName, lastName: recipientLastName } =
      splitName(mailhookAddress);

    const cc = parsed.cc?.value?.map((c) => c.address) || [];
    const bcc = parsed.bcc?.value?.map((b) => b.address) || [];
    const date = parsed.date || new Date();
    const messageId = parsed.messageId || '';
    const inReplyTo = parsed.inReplyTo || '';
    const references = parsed.references || [];
    const attachments =
      parsed.attachments?.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      })) || [];

    console.log('📎 Attachments:', attachments.length);

    const extraFields = parseKeyValuePairs(parsed.text || '');
    const emailDoc = new EmailModel({
      userId: user._id,
      senderFirstName,
      senderLastName,
      senderAddress,
      recipientFirstName,
      recipientLastName,
      recipientAddress: mailhookAddress,
      subject: parsed.subject,
      textBody: parsed.text,
      htmlBody: parsed.html,
      cc,
      bcc,
      date,
      messageId,
      inReplyTo,
      references,
      attachments,
      extraFields,
      notes: 'Forwarded email captured (debug mode).',
    });

    await emailDoc.save();
    console.log('💾 Email saved with ID:', emailDoc._id);

    await executeScenarios({
      userId: user._id,
      from: senderAddress,
      subject: parsed.subject,
      body: parsed.text || parsed.html || '',
      emailId: emailDoc._id.toString(),
      parsedEmailObj: parsed,
    });

    console.log('✅ Scenarios executed.');
    console.log('==============================');
    return res.status(200).send('📥 Forwarded email saved and processed.');
  } catch (err) {
    console.error('❌ Error processing mailhook:', err);
    console.log('==============================');
    res.status(500).send('Error processing email');
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

// export const executeScenarios = async (emailData) => {
//   try {
//     console.log('=======================================');
//     console.log('🚀 EXECUTE SCENARIOS Triggered (Shopify + Other)');
//     console.log('📩 Incoming Email Data:', emailData);
//     console.log('=======================================');

//     const { userId, from, subject, body, emailId, parsedEmailObj } = emailData;

//     // 🧩 Extract fields for Shopify
//     const extractedFields = extractFieldsFromEmail(
//       parsedEmailObj || { text: body, subject, from }
//     );

//     // 🧠 🟢 Fetch ALL scenarios (shopify + other)
//     const scenarios = await scenarioModel.find({ userId }).lean();
//     console.log(`📚 Found ${scenarios.length} total scenario(s)`);

//     if (!scenarios.length) {
//       console.log('⚠️ No scenarios found — stopping execution.');
//       return;
//     }

//     // 🔁 Loop through ALL scenarios
//     for (const scenario of scenarios) {
//       console.log('=======================================');
//       console.log(`🎯 Executing Scenario: ${scenario.name} (${scenario.type})`);
//       console.log('=======================================');

//       if (!scenario.routerBranches?.length) continue;

//       // 🟦 IF SCENARIO IS "OTHER" → RUN SIMPLE LOGIC
//       if (scenario.type === "other") {
//         console.log("⚙️ Running OTHER scenario logic...");

//         for (const branch of scenario.routerBranches) {
//           console.log(`🌿 OTHER Branch ID: ${branch.id}`);
//           console.log(`🔎 Conditions: ${branch.filter?.conditions?.length}`);

//           const matches = branch.filter?.conditions?.length
//             ? branch.filter.conditions.every((cond) => {
//                 let fieldValue = "";

//                 switch (cond.field?.toLowerCase()) {
//                   case 'subject':
//                     fieldValue = (subject || '').toLowerCase();
//                     break;
//                   case 'body':
//                     fieldValue = (body || '').toLowerCase();
//                     break;
//                   case 'from':
//                     fieldValue = (from || '').toLowerCase();
//                     break;
//                   default:
//                     return false;
//                 }

//                 const condValue = (cond.value || '').toLowerCase();

//                 if (cond.operator === "Contains")
//                   return fieldValue.includes(condValue);

//                 if (["Equal to", "Equals"].includes(cond.operator))
//                   return fieldValue === condValue;

//                 return false;
//               })
//             : true;

//           if (!matches) {
//             console.log('❌ OTHER: Branch conditions did NOT match — skipping.');
//             continue;
//           }

//           console.log('✅ OTHER: Branch conditions matched — executing modules');

//           for (const module of branch.modules) {
//             console.log(`⚙️ OTHER: Executing module → ${module.type}`);

//             if (module.type === "Delay") {
//               console.log("⏳ OTHER Delay detected — currently skipping");
//               continue;
//             }

//             if (module.type === "Send Email") {
//               console.log("📧 OTHER: Sending Email...");
//               await sendEmailModule(module, from, subject, emailId);
//             }
//           }
//         }

//         // 🟢 DO NOT run Shopify logic for this scenario
//         continue;
//       }

//       // 🟥 ELSE → RUN EXISTING SHOPIFY LOGIC (UNCHANGED)
//       console.log("🛍 Running Shopify Scenario Logic...");

//       // ---- YOUR FULL SHOPIFY LOGIC STARTS HERE ----
//       // (Everything below is original code unchanged)

//       console.log(`🧱 Branch Count: ${scenario.routerBranches?.length || 0}`);

//       for (const branch of scenario.routerBranches) {
//         console.log('---------------------------------------');
//         console.log(`🌿 Branch ID: ${branch.id || branch._id}`);
//         console.log(
//           `🔎 Branch Conditions: ${branch.filter?.conditions?.length || 0}`
//         );

//         const matches = branch.filter?.conditions?.length
//           ? branch.filter.conditions.every((cond) => {
//               const fieldValue =
//                 cond.field?.toLowerCase() === 'body'
//                   ? (body || '').toLowerCase()
//                   : cond.field?.toLowerCase() === 'subject'
//                     ? (subject || '').toLowerCase()
//                     : '';
//               const condValue = (cond.value || '').toLowerCase();

//               console.log(
//                 `   ➤ Checking: [${cond.field}] ${cond.operator} "${cond.value}"`
//               );

//               switch (cond.operator?.toLowerCase()) {
//                 case 'contains':
//                   return fieldValue.includes(condValue);
//                 case 'equals':
//                 case 'equal to':
//                   return fieldValue === condValue;
//                 default:
//                   return false;
//               }
//             })
//           : true;

//         if (!matches) {
//           console.log('❌ Branch conditions did NOT match — skipping.');
//           continue;
//         }

//         console.log('✅ Branch conditions matched — proceeding...');
//         if (!branch.modules?.length) {
//           console.log('⚠️ No modules found in this branch, skipping...');
//           continue;
//         }

//         console.log(`📦 Modules found: ${branch.modules.length}`);

//         let statusDoc = await AutomationStatusModel.create({
//           userId,
//           emailId,
//           scenarioId: scenario._id,
//           branchId: branch.id || branch._id,
//           status: 'pending',
//           completedModules: [],
//           pendingModules: branch.modules.map((m) => m.id || m._id),
//         });
//         console.log('🗂️ Created AutomationStatus:', statusDoc._id);

//         for (let i = 0; i < branch.modules.length; i++) {
//           const module = branch.modules[i];
//           console.log(`---------------------------------------`);
//           console.log(
//             `⚙️ Executing Module: ${module.app?.name || module.type} (Index ${i})`
//           );

//           try {
//             const rawType = (
//               module.type ||
//               module.app?.name ||
//               ''
//             ).toLowerCase();
//             if (
//               rawType.includes('gmail') ||
//               rawType.includes('email') ||
//               rawType.includes('follow') ||
//               rawType.includes('initial')
//             ) {
//               module.type = 'Send an Email';
//             } else if (rawType.includes('delay')) {
//               module.type = 'Delay';
//             }

//             if (module.type === 'Delay') {
//               if (!module.delayValue || !module.delayUnit) continue;

//               const delayMs = convertToMs(module.delayValue, module.delayUnit);

//               const remainingModules = branch.modules
//                 .slice(i + 1)
//                 .filter((m) =>
//                   ['Send an Email', 'Custom Email'].includes(m.type)
//                 );

//               await DelayJobModel.create({
//                 userId,
//                 emailData,
//                 emailId,
//                 scenarioId: scenario._id,
//                 modulesLeft: remainingModules,
//                 scheduledAt: new Date(Date.now() + delayMs),
//               });

//               await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//                 $push: { completedModules: module.id || module._id },
//                 $set: {
//                   pendingModules: remainingModules.map((m) => m.id || m._id),
//                   status: 'partial',
//                   lastExecutedAt: new Date(),
//                 },
//               });

//               break;
//             }

//             if (['Send an Email', 'Custom Email'].includes(module.type)) {
//               if (!module.connectionId) continue;

//               let templateContent =
//                 module.template || 'Thanks for your email!';
//               let stepType = 'initial';

//               const subjectLower = (subject || '').toLowerCase().trim();

//               if (
//                 !subjectLower.startsWith(
//                   'shopify partner directory: new service inquiry from'
//                 )
//               ) {
//                 continue;
//               }

//               const lowerTpl = (module.template || '').toLowerCase();
//               if (lowerTpl.includes('first')) stepType = 'first';
//               else if (lowerTpl.includes('second')) stepType = 'second';

//               const textToSearch = (subject + ' ' + body).toLowerCase();

//               const defaultServices = [
//                 'General',
//                 'Troubleshooting',
//                 'Theme customization',
//                 'Store build or redesign',
//                 'Store migration',
//                 'Website and marketing content',
//                 'SEO',
//                 'Site performance and speed',
//                 'Custom apps and integrations',
//                 'Store settings configuration',
//                 'Product and collection setup',
//                 'Social media marketing',
//                 'Product descriptions',
//                 'Search engine advertising',
//                 'POS setup and migration',
//                 'Custom domain setup',
//                 'Conversion rate optimization',
//                 'Analytics and tracking',
//                 'Sales channel setup',
//                 'Logo and visual branding',
//                 'Business strategy guidance',
//                 'Website audit and optimization strategy',
//                 'Sales tax guidance',
//                 'Product photography',
//                 'Email marketing',
//                 '3D modelling',
//                 'Banner ads',
//                 'Video and illustrations',
//                 'Content marketing',
//                 'Product sourcing guidance',
//               ];

//               let matchedService = defaultServices.find((s) =>
//                 textToSearch.includes(s.toLowerCase())
//               );
//               matchedService = matchedService || 'General';

//               const tpl =
//                 (await TemplateModel.findOne({
//                   userId,
//                   platform: 'shopify',
//                   service: new RegExp(`^${matchedService}$`, 'i'),
//                   $or: [
//                     {
//                       name: new RegExp(
//                         stepType === 'initial'
//                           ? '(.*Initial Email.*|.*Initial Follow-up.*)'
//                           : stepType === 'first'
//                             ? '(.*First Email.*|.*First Follow-up.*)'
//                             : '(.*Second Email.*|.*Second Follow-up.*)',
//                         'i'
//                       ),
//                     },
//                   ],
//                   active: true,
//                 })) ||
//                 (await TemplateModel.findOne({
//                   userId,
//                   platform: 'shopify',
//                   service: /^General$/i,
//                   $or: [
//                     {
//                       name: new RegExp(
//                         stepType === 'initial'
//                           ? '(.*Initial Email.*|.*Initial Follow-up.*)'
//                           : stepType === 'first'
//                             ? '(.*First Email.*|.*First Follow-up.*)'
//                             : '(.*Second Email.*|.*Second Follow-up.*)',
//                         'i'
//                       ),
//                     },
//                   ],
//                   active: true,
//                 }));

//               if (tpl) templateContent = tpl.content;

//               templateContent = fillTemplate(templateContent, extractedFields);

//               await sendEmailModule(
//                 {
//                   ...module,
//                   template: templateContent,
//                   templateId: tpl?._id || null,
//                   service: matchedService,
//                   stepType,
//                 },
//                 from,
//                 subject,
//                 emailId
//               );

//               const updated = await AutomationStatusModel.findByIdAndUpdate(
//                 statusDoc._id,
//                 {
//                   $push: { completedModules: module.id || module._id },
//                   $pull: { pendingModules: module.id || module._id },
//                   $set: { lastExecutedAt: new Date() },
//                 },
//                 { new: true }
//               );

//               if (updated.pendingModules.length === 0) {
//                 await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//                   $set: { status: 'completed' },
//                 });
//               } else {
//                 await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//                   $set: { status: 'partial' },
//                 });
//               }
//             }
//           } catch (err) {
//             await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//               $set: { status: 'failed', lastExecutedAt: new Date() },
//             });
//           }
//         }

//         const finalDoc = await AutomationStatusModel.findById(statusDoc._id);
//         if (
//           finalDoc &&
//           finalDoc.pendingModules.length === 0 &&
//           finalDoc.status !== 'failed'
//         ) {
//           await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//             $set: { status: 'completed', lastExecutedAt: new Date() },
//           });
//         }
//       }

//       console.log('=======================================');
//     }

//     console.log('🎉 All Scenarios Execution Complete!');
//     console.log('=======================================');
//   } catch (err) {
//     console.error('🔥 Fatal Error in executeScenarios:', err);
//   }
// };

export const executeScenarios = async (emailData) => {
  try {
    console.log('=======================================');
    console.log('🚀 EXECUTE SCENARIOS Triggered (Shopify + Other)');
    console.log('📩 Incoming Email Data:', emailData);
    console.log('=======================================');

    const { userId, from, subject, body, emailId, parsedEmailObj } = emailData;

    // 🧩 Extract fields for Shopify
    const extractedFields = extractFieldsFromEmail(
      parsedEmailObj || { text: body, subject, from }
    );

    // 🧠 🟢 Fetch ALL scenarios (shopify + other)
    const scenarios = await scenarioModel.find({ userId }).lean();
    console.log(`📚 Found ${scenarios.length} total scenario(s)`);

    if (!scenarios.length) {
      console.log('⚠️ No scenarios found — stopping execution.');
      return;
    }

    for (const scenario of scenarios) {
      console.log('=======================================');
      console.log(`🎯 Executing Scenario: ${scenario.name} (${scenario.type})`);
      console.log('=======================================');

      if (!scenario.routerBranches?.length) continue;

      if (scenario.type === 'other') {
        console.log(' Running OTHER scenario logic...');

        for (const branch of scenario.routerBranches) {
          console.log(`OTHER Branch ID: ${branch.id}`);
          console.log(`Conditions: ${branch.filter?.conditions?.length}`);

          const matches = branch.filter?.conditions?.length
            ? branch.filter.conditions.every((cond) => {
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
              })
            : true;

          if (!matches) {
            console.log(
              'OTHER: Branch conditions did NOT match — skipping.'
            );
            continue;
          }

          console.log(
            'OTHER: Branch conditions matched — executing modules'
          );

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
              }

              // CASE 3: Nothing present, fallback
              else {
                finalTemplateContent = '';
              }

              // Send email with final template
              await sendEmailModule(
                {
                  ...module,
                  template: finalTemplateContent, // 🔥 FINAL HTML CONTENT HERE
                },
                from,
                subject,
                emailId
              );
            }
          }
        }

        // 🟢 DO NOT run Shopify logic for this scenario
        continue;
      }

      // 🟥 ELSE → RUN EXISTING SHOPIFY LOGIC (UNCHANGED)
      console.log('🛍 Running Shopify Scenario Logic...');

      // ---- YOUR FULL SHOPIFY LOGIC STARTS HERE ----
      // (Everything below is original code unchanged)

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
                `   ➤ Checking: [${cond.field}] ${cond.operator} "${cond.value}"`
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
            const rawType = (
              module.type ||
              module.app?.name ||
              ''
            ).toLowerCase();
            if (
              rawType.includes('gmail') ||
              rawType.includes('email') ||
              rawType.includes('follow') ||
              rawType.includes('initial')
            ) {
              module.type = 'Send an Email';
            } else if (rawType.includes('delay')) {
              module.type = 'Delay';
            }

            if (module.type === 'Delay') {
              if (!module.delayValue || !module.delayUnit) continue;

              const delayMs = convertToMs(module.delayValue, module.delayUnit);

              const remainingModules = branch.modules
                .slice(i + 1)
                .filter((m) =>
                  ['Send an Email', 'Custom Email'].includes(m.type)
                );

              await DelayJobModel.create({
                userId,
                emailData,
                emailId,
                scenarioId: scenario._id,
                modulesLeft: remainingModules,
                scheduledAt: new Date(Date.now() + delayMs),
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

              const subjectLower = (subject || '').toLowerCase().trim();

              if (
                !subjectLower.startsWith(
                  'shopify partner directory: new service inquiry from'
                )
              ) {
                continue;
              }

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

              await sendEmailModule(
                {
                  ...module,
                  template: templateContent,
                  templateId: tpl?._id || null,
                  service: matchedService,
                  stepType,
                },
                from,
                subject,
                emailId
              );

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

      console.log('=======================================');
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
  parentEmailId
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

    const connection = await ConnectionModel.findById(module.connectionId);
    if (!connection) {
      log('❌ Connection not found:', module.connectionId);
      return;
    }

    log('🔌 Connection found:', {
      provider: connection.provider,
      email: connection.email,
    });

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

    // =====================================================================
    // ------------------------ 📧 GMAIL PROVIDER ---------------------------
    // =====================================================================
    if (connection.provider === 'gmail') {
      try {
        log('📨 Sending via Gmail API...');

        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials(connection.tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        // ✅ Correct MIME Format — DOUBLE CRLF before body!
        const rawMessage =
          `From: ${connection.email}\r\n` +
          `To: ${to}\r\n` +
          (cc ? `Cc: ${cc}\r\n` : '') +
          (bcc ? `Bcc: ${bcc}\r\n` : '') +
          `Subject: ${safeSubject}\r\n` +
          'MIME-Version: 1.0\r\n' +
          'Content-Type: text/html; charset=UTF-8\r\n' +
          '\r\n' + // DOUBLE CRLF separates headers from body
          emailBody +
          '\r\n';

        log('📄 Gmail MIME Raw Message (first 400 chars):');
        log(rawMessage.slice(0, 400));

        const raw = Buffer.from(rawMessage, 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        log('⚙️ Gmail payload prepared (base64 length):', raw.length);

        const result = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw },
        });

        log('✅ [GMAIL] Message sent successfully!');
        log('📨 Gmail Message ID:', result.data.id);
        sentOk = true;
      } catch (err) {
        log('❌ [GMAIL] Send Error:', err.response?.data || err.message);
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
        });

        log('✅ [SMTP] Email sent successfully!');
        log('📨 Message ID:', info.messageId);
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
      log('✅ Sent email saved in DB with ID:', sentDoc._id);
    } else {
      log('⚠️ Email not sent — skipping save.');
    }

    log('=========================================');
  } catch (outerErr) {
    console.error('🔥 [sendEmailModule] Fatal Error:', outerErr);
  }
};

export const RunTestMode = async (req, res) => {
  try {
    const {
      userId,
      fullName,
      businessEmail,
      storeName,
      country,
      service,
      budget,
      helpDescription,
    } = req.body;

    if (!userId || !fullName || !businessEmail || !service) {
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
    const partnerName = user.fullName || 'The Fold Tech';
    const dummyCustomer = 'Dummy Customer';

    let testData = await TestEmailDataModel.findOne({ userId });
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
      console.log('🔁 Updated existing test input for user:', userId);
    } else {
      testData = await TestEmailDataModel.create({
        userId,
        fullName,
        businessEmail,
        storeName,
        country,
        service,
        budget,
        helpDescription,
      });
      console.log('Saved new test input for user:', userId);
    }

    const subject = `FW: Shopify Partner Directory: New Service Inquiry from ${dummyCustomer} to ${partnerName}`;

    const textBody = helpDescription || 'No description provided.';

    const htmlBody = `
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

    <p style="margin:8px 0;"><strong>Full name</strong><br>${dummyCustomer}</p>

    <p style="margin:8px 0;">
      <strong>Business email</strong><br>
      <a href="mailto:${businessEmail}" style="color:#006eff; text-decoration:none;">${businessEmail}</a>
    </p>

    <p style="margin:8px 0;">
      <strong>Select the store you're working on</strong><br>
      ${storeName || 'N/A'}<br>
      <a href="https://${storeName ? storeName.toLowerCase().replace(/\s+/g, '') : 'example'}.myshopify.com" 
         style="color:#006eff; text-decoration:none;">
         https://${storeName ? storeName.toLowerCase().replace(/\s+/g, '') : 'example'}.myshopify.com
      </a>
    </p>

    <p style="margin:8px 0;"><strong>Country</strong><br>${country}</p>

    <p style="margin:8px 0;"><strong>Select a service offered by ${partnerName}</strong><br>${service}</p>

    <p style="margin:8px 0;"><strong>Budget (USD)</strong><br>${budget || 'Not specified'}</p>

    <p style="margin:8px 0;"><strong>Description</strong><br>${helpDescription || 'No additional information provided.'}</p>

  </div>

  <p style="margin-top:20px;">
    Thank you for being a part of the <strong>Shopify Partner Directory</strong>.
  </p>

  <p style="font-weight:bold; margin-top:8px;">Sincerely,<br>The Shopify Team</p>
</div>
`;

    // ✅ STEP 3: Send test email
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const emailId = `test-${Date.now()}`;
    const fromAddress = `Zenith Inbox <${process.env.EMAIL_USER}>`;

    await transporter.sendMail({
      from: fromAddress,
      to: mailhook,
      subject,
      text: textBody,
      html: htmlBody,
    });

    console.log(`✅ Test email sent → ${mailhook}`);

    // ✅ STEP 4: Save email record
    const savedEmail = await EmailModel.create({
      userId,
      senderFirstName: dummyCustomer.split(' ')[0],
      senderAddress: businessEmail,
      recipientAddress: mailhook,
      subject,
      textBody,
      htmlBody,
      isForwarded: false,
      parentEmailId: emailId,
      date: new Date(),
      isTestEmail: true,
    });

    console.log('💾 Saved test email:', savedEmail._id);

    // ✅ STEP 5: Execute scenario (unchanged)
    await executeScenarios({
      userId,
      from: fromAddress,
      subject,
      body: textBody,
      emailId,
      parsedEmailObj: {
        from: {
          value: [{ name: 'Zenith Inbox', address: process.env.EMAIL_USER }],
        },
        subject,
        text: textBody,
        html: htmlBody,
      },
    });

    res.json({
      success: true,
      message: `Test email sent and scenario executed for ${mailhook}`,
      testEmail: savedEmail,
      testInputData: testData,
    });
  } catch (err) {
    console.error('Run Test Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to send test email or execute scenario.',
      error: err.message,
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
    const partnerName = user.fullName || 'Zenith Inbox';

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
    const fromAddress = `Zenith Inbox <${process.env.EMAIL_USER}>`;

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
          value: [{ name: 'Zenith Inbox', address: process.env.EMAIL_USER }],
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

export const getEmailDataforUser = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user ID format',
      });
    }

    // 1️⃣ Get all emails for this user
    const userEmails = await EmailModel.find({ userId })
      .populate('userId', 'name email')
      .populate('templateId')
      .lean();

    if (!userEmails.length) {
      return res.status(404).json({
        success: false,
        message: 'No emails found for this user',
      });
    }

    // 2️⃣ Create a lookup map for quick access
    const emailMap = {};
    userEmails.forEach(
      (email) => (emailMap[email._id] = { ...email, children: [] })
    );

    // 3️⃣ Build the tree (root → replies)
    const rootEmails = [];
    userEmails.forEach((email) => {
      if (email.parentEmailId && emailMap[email.parentEmailId]) {
        emailMap[email.parentEmailId].children.push(emailMap[email._id]);
      } else {
        rootEmails.push(emailMap[email._id]);
      }
    });

    // 4️⃣ Fetch automation statuses for all emails
    const emailIds = userEmails.map((e) => e._id);
    const statuses = await AutomationStatusModel.find({
      emailId: { $in: emailIds },
    })
      .populate('scenarioId', 'name description')
      .lean();

    // 5️⃣ Return full user email hierarchy
    res.status(200).json({
      success: true,
      data: {
        userId,
        totalEmails: userEmails.length,
        rootEmails, // 👈 parent emails (with nested replies)
        statuses, // 👈 all automation statuses for this user’s emails
      },
    });
  } catch (error) {
    console.error('Error fetching emails for user:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching emails for user',
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

// export const validateTestEmail = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const { toEmail } = req.body;

//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: 'Invalid user ID.' });
//     }

//     if (!toEmail) {
//       return res.status(400).json({
//         success: false,
//         message: 'Missing recipient email address (toEmail).',
//       });
//     }

//     const user = await authModel.findById(userId);
//     if (!user) {
//       return res
//         .status(404)
//         .json({ success: false, message: 'User not found.' });
//     }

//     const testSubject = 'Zenith Forwarding Validation Test';
//     const testBody = `Hello,

// This is a test email from Zenith Inbox to confirm that your email forwarding setup is working correctly.

// If you receive this email, your mail forwarding is active and functioning.

// — Zenith Inbox Team`;

//     const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//       },
//     });

//     await transporter.sendMail({
//       from: `"Zenith System" <${process.env.EMAIL_USER}>`,
//       to: toEmail,
//       subject: testSubject,
//       text: testBody,
//     });

//     return res.json({
//       success: true,
//       message: `✅ Test email sent to ${toEmail}. Once it reaches your mailhook, it will be recorded automatically.`,
//       sentTo: toEmail,
//     });
//   } catch (err) {
//     res.status(500).json({
//       success: false,
//       message: 'Failed to send test email.',
//       error: err.message,
//     });
//   }
// };

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

    const testSubject = 'Zenith Forwarding Validation Test';
    const testBody = `Hello,

This is a test email from Zenith Inbox to confirm that your email forwarding setup is working correctly.

If you receive this email, your mail forwarding is active and functioning.

— Zenith Inbox Team`;

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"Zenith System" <${process.env.EMAIL_USER}>`,
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

// export const getValidateEmail = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: 'Invalid user ID.' });
//     }

//     const testSubject = 'Zenith Forwarding Validation Test';

//     const testRecord = await validationModel
//       .findOne({ userId, subject: testSubject })
//       .sort({ createdAt: -1 })
//       .lean();

//     if (!testRecord) {
//       return res.status(404).json({
//         success: false,
//         message: 'Test forwarding email not yet received or verified.',
//       });
//     }

//     return res.json({
//       success: true,
//       message: testRecord.verified
//         ? '✅ Forwarding test verified successfully.'
//         : '⚙️ Test email found but not yet verified.',
//       data: {
//         id: testRecord._id,
//         subject: testRecord.subject,
//         toEmail: testRecord.toEmail,
//         sentAt: testRecord.sentAt,
//         verified: testRecord.verified,
//         verifiedAt: testRecord.verifiedAt,
//         status: testRecord.status,
//         notes: testRecord.notes,
//       },
//     });
//   } catch (err) {
//     console.error('❌ Error checking forwarding validation:', err);
//     return res.status(500).json({
//       success: false,
//       message: 'Server error while checking forwarding validation.',
//       error: err.message,
//     });
//   }
// };

// export const getValidateEmail = async (req, res) => {
//   try {
//     const { userId } = req.params;
//     const { cardId } = req.query;

//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return res
//         .status(400)
//         .json({ success: false, message: "Invalid user ID." });
//     }

//     const testSubject = "Zenith Forwarding Validation Test";

//     // 🟡 Find latest test record for this user
//     const testRecord = await validationModel
//       .findOne({ userId, subject: testSubject })
//       .sort({ createdAt: -1 })
//       .lean();

//     if (!testRecord) {
//       return res.status(404).json({
//         success: false,
//         message: "Test forwarding email not yet received or verified.",
//       });
//     }

//     // 🟢 Proceed only if test verified
//     if (testRecord.verified) {
//       const user = await authModel.findById(userId).select("mailhook");

//       if (!user) {
//         return res
//           .status(404)
//           .json({ success: false, message: "User not found" });
//       }

//       // 🧩 Check for duplicate forwarding email
//       const existing = await mailhookModel.findOne({
//         userId,
//         forwardingEmail: testRecord.toEmail,
//       });

//       if (existing) {
//         console.log(
//           `⚠️ Forwarding already exists for ${testRecord.toEmail}, skipping update/create.`
//         );
//         return res.status(400).json({
//           success: false,
//           message: `⚠️ Forwarding is already set up for ${testRecord.toEmail}. Please use a different email address.`,
//         });
//       }

//       let updatedMailhook;

//       // 🧠 CASE 1: Update existing Mailhook card by ID
//       if (cardId && mongoose.Types.ObjectId.isValid(cardId)) {
//         updatedMailhook = await mailhookModel.findByIdAndUpdate(
//           cardId,
//           {
//             forwardingEmail: testRecord.toEmail,
//             connectionVerified: true,
//             validationId: testRecord._id, // 🟢 save validation record ID
//           },
//           { new: true }
//         );

//         if (!updatedMailhook) {
//           return res.status(404).json({
//             success: false,
//             message: "Mailhook card not found for the given ID.",
//           });
//         }

//         console.log("✅ Mailhook card updated:", updatedMailhook._id);
//       } else {
//         // 🧠 CASE 2: Create new Mailhook if not exists
//         const newMailhook = new mailhookModel({
//           userId,
//           mailhook: user.mailhook,
//           forwardingEmail: testRecord.toEmail,
//           connectionVerified: true,
//           validationId: testRecord._id, // 🟢 also save validation record ID
//         });

//         updatedMailhook = await newMailhook.save();
//         console.log("🆕 New mailhook created:", updatedMailhook._id);
//       }
//     }

//     // ✅ Final Response
//     return res.json({
//       success: true,
//       message: testRecord.verified
//         ? "✅ Forwarding test verified and mailhook updated successfully."
//         : "⚙️ Test email found but not yet verified.",
//       data: {
//         id: testRecord._id,
//         subject: testRecord.subject,
//         toEmail: testRecord.toEmail,
//         sentAt: testRecord.sentAt,
//         verified: testRecord.verified,
//         verifiedAt: testRecord.verifiedAt,
//         status: testRecord.status,
//         notes: testRecord.notes,
//       },
//     });
//   } catch (err) {
//     console.error("❌ Error checking forwarding validation:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error while checking forwarding validation.",
//       error: err.message,
//     });
//   }
// };

export const getValidateEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { cardId } = req.query;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid user ID.' });
    }

    const testSubject = 'Zenith Forwarding Validation Test';

    // 🟡 Get latest test email for verification
    const testRecord = await validationModel
      .findOne({ userId, subject: testSubject })
      .sort({ createdAt: -1 })
      .lean();

    if (!testRecord) {
      return res.status(404).json({
        success: false,
        message: 'Test forwarding email not yet received or verified.',
      });
    }

    // 🟢 Only proceed if the test is verified
    if (testRecord.verified) {
      const user = await authModel.findById(userId).select('mailhook');
      if (!user) {
        return res
          .status(404)
          .json({ success: false, message: 'User not found' });
      }

      // 🧠 Check if that email already exists for this user (avoid duplicates)
      const existing = await mailhookModel.findOne({
        userId,
        forwardingEmail: testRecord.toEmail,
      });

      // If found and not the same cardId → block creation or update
      // if (existing && existing._id.toString() !== cardId) {
      //   console.log(
      //     `⚠️ Duplicate forwarding attempt for ${testRecord.toEmail}, blocked.`
      //   );
      //   return res.status(400).json({
      //     success: false,
      //     message: `⚠️ Forwarding is already set up for ${testRecord.toEmail}. Please use a different email address.`,
      //   });
      // }

      let updatedMailhook;

      if (cardId && mongoose.Types.ObjectId.isValid(cardId)) {
        updatedMailhook = await mailhookModel.findByIdAndUpdate(
          cardId,
          {
            forwardingEmail: testRecord.toEmail,
            connectionVerified: true,
            validationId: testRecord._id,
          },
          { new: true }
        );

        if (!updatedMailhook) {
          return res.status(404).json({
            success: false,
            message: 'Mailhook card not found for the given ID.',
          });
        }

        console.log('✅ Existing Mailhook card updated:', updatedMailhook._id);
      } else {
        // 🧩 CASE 2: Create new mailhook only if not exists
        if (!existing) {
          const newMailhook = new mailhookModel({
            userId,
            mailhook: user.mailhook,
            forwardingEmail: testRecord.toEmail,
            connectionVerified: true,
            validationId: testRecord._id,
          });

          updatedMailhook = await newMailhook.save();
          console.log('🆕 New mailhook created:', updatedMailhook._id);
        }
      }
    }

    // ✅ Final Response
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
    console.error('❌ Error checking forwarding validation:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while checking forwarding validation.',
      error: err.message,
    });
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
      subject: { $regex: 'Zenith Forwarding Validation Test', $options: 'i' },
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

export const sendTestEmail = async (req, res) => {
  try {
    const { toEmail, userId } = req.body;

    if (!toEmail || !userId) {
      return res
        .status(400)
        .json({ success: false, message: 'Missing email or user ID' });
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // 🔹 Email content
    const mailOptions = {
      from: `"Zenith Inbox" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: 'Zenith Inbox Test Email',
      text: `Hello,

This is a test email from Zenith Inbox to confirm that your mail forwarding is set up correctly.

If you received this email, forwarding is working fine 

Thank you,
Zenith Inbox Team`,
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

        const transporter = nodemailer.createTransport({
          host: connection.smtp.host,
          port: connection.smtp.port || 465,
          secure: connection.smtp.port === 465,
          auth: {
            user: connection.smtp.username,
            pass: connection.smtp.password,
          },
          tls: { rejectUnauthorized: false },
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
