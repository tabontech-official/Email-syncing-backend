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
    console.log('[mailHookWebhook] Incoming request body:', req.body);

    const rawEmail = req.body.email || null;
    let parsed = {};

    if (rawEmail) {
      console.log('Raw email string detected, parsing with simpleParser...');
      parsed = await simpleParser(rawEmail);
    } else {
      console.log('No raw email, falling back to manual parsing...');
      parsed = {
        from: { value: [{ address: req.body.from, name: req.body.from }] },
        to: { value: [{ address: req.body.to, name: req.body.to }] },
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
      };
    }
    console.log('Parsed email object:', parsed);

    const senderAddress = parsed.from?.value?.[0]?.address || '';
    const senderName = parsed.from?.value?.[0]?.name || '';
    console.log(' Sender:', senderName, `<${senderAddress}>`);

    const { firstName: senderFirstName, lastName: senderLastName } =
      splitName(senderName);

    const headerRecipient = parsed.to?.value?.[0]?.address || '';
    let mailhookAddress =
      req.body.envelope?.to ||
      (Array.isArray(req.body.to) ? req.body.to[0] : req.body.to) ||
      headerRecipient;

    console.log(' Initial mailhook address:', mailhookAddress);

    if (Array.isArray(req.body.to)) {
      const brandferAddress = req.body.to.find((a) =>
        a.includes('@mail.brandfer.com')
      );
      if (brandferAddress) {
        console.log(' Found brandfer address:', brandferAddress);
        mailhookAddress = brandferAddress;
      }
    }

    if (mailhookAddress.includes('<')) {
      mailhookAddress = mailhookAddress.split('<')[1].replace('>', '').trim();
    }
    mailhookAddress = mailhookAddress.trim().toLowerCase();
    console.log(' Final mailhookAddress:', mailhookAddress);

    const { firstName: recipientFirstName, lastName: recipientLastName } =
      splitName(mailhookAddress);

    const subject = parsed.subject || '';
    const textBody = parsed.text || '';
    const htmlBody = parsed.html || '';
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

    console.log(' Email meta extracted:', {
      subject,
      cc,
      bcc,
      attachmentsCount: attachments.length,
      date,
    });

    let verificationCode = null;
    let verificationUrl = null;
    if (subject.includes('Gmail Forwarding Confirmation')) {
      console.log(' Gmail forwarding confirmation detected');
      const codeMatch = textBody.match(/Confirmation code:\s*(\d+)/i);
      if (codeMatch) verificationCode = codeMatch[1];
      const urlMatch = textBody.match(
        /https:\/\/mail-settings\.google\.com\/mail\/vf-[\S]+/i
      );
      if (urlMatch) verificationUrl = urlMatch[0];
    }

    const extraFields = parseKeyValuePairs(textBody);
    console.log(' Extra fields extracted:', extraFields);

    const user = await authModel.findOne({ mailhook: mailhookAddress });
    if (!user) {
      console.warn('⚠️ No matching user found for mailhook:', mailhookAddress);
      return res.status(200).send('No matching user found');
    }
    console.log('👤 User found:', user._id.toString(), user.email);

    const templates = await TemplateModel.find({
      userId: user._id,
      active: true,
    });
    console.log(` Found ${templates.length} active templates for user`);

    let matchedTemplate = null;
    for (const tpl of templates) {
      if (
        subject.includes(tpl.keyword) ||
        textBody.includes(tpl.keyword) ||
        htmlBody.includes(tpl.keyword)
      ) {
        matchedTemplate = tpl;
        console.log(' Matched template:', tpl._id.toString(), tpl.name);
        break;
      }
    }

    const emailDoc = new EmailModel({
      userId: user._id,
      templateId: matchedTemplate?._id || null,
      senderFirstName,
      senderLastName,
      senderAddress,
      recipientFirstName,
      recipientLastName,
      recipientAddress: mailhookAddress,
      subject,
      textBody,
      htmlBody,
      cc,
      bcc,
      date,
      messageId,
      inReplyTo,
      references,
      attachments,
      verificationCode,
      verificationUrl,
      extraFields,
    });

    await emailDoc.save();
    console.log(' Email saved to DB:', emailDoc._id.toString());

    console.log(' Executing scenarios for this email...');
    await executeScenarios({
      userId: user._id,
      from: senderAddress,
      subject,
      body: textBody || htmlBody || '',
      emailId: emailDoc._id.toString(),
      parsedEmailObj: parsed,
    });
    console.log('Scenarios executed for email:', emailDoc._id.toString());

    res.status(200).send('Email processed and saved');
  } catch (err) {
    console.error('mailHookWebhook ERROR:', err.message, err.stack);
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
//     const { userId, from, subject, body, emailId, parsedEmailObj } = emailData;
//     console.log(' [executeScenarios] START EXECUTION');
//     console.log(' Incoming email data:', emailData);
//     const extractedFields = extractFieldsFromEmail(
//       parsedEmailObj || { text: body, subject, from }
//     );
//     console.log('📡 Fetching scenarios for user:', userId);

//     const scenarios = await scenarioModel.find({ userId });

//     for (const scenario of scenarios) {
//       if (!scenario.routerBranches || scenario.routerBranches.length === 0)
//         continue;

//       for (const branch of scenario.routerBranches) {
//         if (!branch.filter || !Array.isArray(branch.filter.conditions))
//           continue;

//         const matches = branch.filter.conditions.every((cond) => {
//           const fieldValue =
//             cond.field === 'Body'
//               ? (body || '').toLowerCase()
//               : cond.field === 'Subject'
//                 ? (subject || '').toLowerCase()
//                 : '';
//           const condValue = (cond.value || '').toLowerCase();

//           if (cond.operator === 'Contains')
//             return fieldValue.includes(condValue);
//           if (cond.operator === 'Equal to') return fieldValue === condValue;
//           return false;
//         });

//         if (!matches) continue;
//         if (!branch.modules || branch.modules.length === 0) continue;

//         let statusDoc = await AutomationStatusModel.create({
//           userId,
//           emailId,
//           scenarioId: scenario._id,
//           branchId: branch.id || branch._id,
//           status: 'pending',
//           completedModules: [],
//           pendingModules: branch.modules.map((m) => m.id || m._id),
//         });

//         for (let i = 0; i < branch.modules.length; i++) {
//           const module = branch.modules[i];

//           try {
//             // 🟢 Normalize module types for Shopify scenarios
// if (scenario.type?.toLowerCase() === "shopify") {
//   const rawType = (module.type || module.app?.name || "").toLowerCase();

//   if (
//     rawType.includes("gmail") ||
//     rawType.includes("email") ||
//     rawType.includes("follow") ||
//     rawType.includes("initial")
//   ) {
//     module.type = "Send an Email";
//   } else if (rawType.includes("delay")) {
//     module.type = "Delay";
//   } else if (rawType.includes("router")) {
//     module.type = "Router";
//   } else if (rawType.includes("webhook")) {
//     module.type = "Webhooks";
//   }
// }

//             if (
//               module.type === 'Delay' ||
//               (!module.type && module.app?.name === 'Delay')
//             ) {
              
//               const delayMs = convertToMs(module.delayValue, module.delayUnit);
//               const remainingModules = [];

//               for (const nextModule of branch.modules.slice(i + 1)) {
//                 const plain = nextModule.toObject
//                   ? nextModule.toObject()
//                   : { ...nextModule };

//                 if (
//                   plain.type === 'Send an Email' ||
//                   plain.type === 'Custom Email'
//                 ) {
//                   let templateContent =
//                     plain.template || 'Thanks for your email!';

//                   if (scenario.type?.toLowerCase() === 'shopify') {
//                     let stepType = 'initial';
//                     const lower = (plain.template || '').toLowerCase();
//                     if (lower.includes('first')) stepType = 'first';
//                     else if (lower.includes('second')) stepType = 'second';

//                     const defaultServices = [
//                       'General',
//                       'Troubleshooting',
//                       'Theme customization',
//                       'Store build or redesign',
//                       'Store migration',
//                       'Website and marketing content',
//                       'SEO',
//                       'Site performance and speed',
//                       'Custom apps and integrations',
//                       'Store settings configuration',
//                       'Product and collection setup',
//                       'Social media marketing',
//                       'Product descriptions',
//                       'Search engine advertising',
//                       'POS setup and migration',
//                       'Custom domain setup',
//                       'Conversion rate optimization',
//                       'Analytics and tracking',
//                       'Sales channel setup',
//                       'Logo and visual branding',
//                       'Business strategy guidance',
//                       'Website audit and optimization strategy',
//                       'Sales tax guidance',
//                       'Product photography',
//                       'Email marketing',
//                       '3D modelling',
//                       'Banner ads',
//                       'Video and illustrations',
//                       'Content marketing',
//                       'Product sourcing guidance',
//                     ];

//                     let matchedService = 'General';
//                     const textToSearch = (subject + ' ' + body).toLowerCase();
//                     const found = defaultServices.find((s) =>
//                       textToSearch.includes(s.toLowerCase())
//                     );
//                     if (found) matchedService = found;

//                     const tpl = await TemplateModel.findOne({
//                       userId,
//                       platform: 'shopify',
//                       service: new RegExp(`^${matchedService}$`, 'i'),
//                       name: new RegExp(
//                         stepType === 'initial'
//                           ? 'Initial Email'
//                           : stepType === 'first'
//                             ? 'First Email'
//                             : 'Second Email',
//                         'i'
//                       ),
//                       active: true,
//                     });

//                     if (tpl) templateContent = tpl.content;
//                     else {
//                       const generalTpl = await TemplateModel.findOne({
//                         userId,
//                         platform: 'shopify',
//                         service: /^General$/i,
//                         name: new RegExp(
//                           stepType === 'initial'
//                             ? 'Initial Email'
//                             : stepType === 'first'
//                               ? 'First Email'
//                               : 'Second Email',
//                           'i'
//                         ),
//                         active: true,
//                       });
//                       if (generalTpl) templateContent = generalTpl.content;
//                     }
//                   }

//                   plain.template = fillTemplate(
//                     templateContent,
//                     extractedFields
//                   );
//                 }

//                 remainingModules.push(plain);
//               }

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

//             if (
//               module.type === 'Send an Email' ||
//               module.type === 'Custom Email'
//             ) {
//               let templateContent = module.template || 'Thanks for your email!';

//               if (scenario.type && scenario.type.toLowerCase() === 'shopify') {
//                 let stepType = 'initial';
//                 const subjectLower = (subject || '').toLowerCase().trim();

//                 const isValidShopify = subjectLower.startsWith(
//                   'shopify partner directory: new service inquiry from'
//                 );

//                 if (!isValidShopify) {
//                   console.log(
//                     '🚫 Skipping Shopify scenario — subject invalid for trigger:',
//                     subject
//                   );
//                   continue;
//                 }
//                 const lower = (module.template || '').toLowerCase();
//                 if (lower.includes('first')) stepType = 'first';
//                 else if (lower.includes('second')) stepType = 'second';

//                 const defaultServices = [
//                   'General',
//                   'Troubleshooting',
//                   'Theme customization',
//                   'Store build or redesign',
//                   'Store migration',
//                   'Website and marketing content',
//                   'SEO',
//                   'Site performance and speed',
//                   'Custom apps and integrations',
//                   'Store settings configuration',
//                   'Product and collection setup',
//                   'Social media marketing',
//                   'Product descriptions',
//                   'Search engine advertising',
//                   'POS setup and migration',
//                   'Custom domain setup',
//                   'Conversion rate optimization',
//                   'Analytics and tracking',
//                   'Sales channel setup',
//                   'Logo and visual branding',
//                   'Business strategy guidance',
//                   'Website audit and optimization strategy',
//                   'Sales tax guidance',
//                   'Product photography',
//                   'Email marketing',
//                   '3D modelling',
//                   'Banner ads',
//                   'Video and illustrations',
//                   'Content marketing',
//                   'Product sourcing guidance',
//                 ];

//                 let matchedService = 'General';
//                 const textToSearch = (subject + ' ' + body).toLowerCase();
//                 const found = defaultServices.find((s) =>
//                   textToSearch.includes(s.toLowerCase())
//                 );
//                 if (found) matchedService = found;

//                 const tpl = await TemplateModel.findOne({
//                   userId,
//                   platform: 'shopify',
//                   service: new RegExp(`^${matchedService}$`, 'i'),
//                   name: new RegExp(
//                     stepType === 'initial'
//                       ? 'Initial Email'
//                       : stepType === 'first'
//                         ? 'First Email'
//                         : 'Second Email',
//                     'i'
//                   ),
//                   active: true,
//                 });

//                 if (tpl) templateContent = tpl.content;
//                 else {
//                   const generalTpl = await TemplateModel.findOne({
//                     userId,
//                     platform: 'shopify',
//                     service: /^General$/i,
//                     name: new RegExp(
//                       stepType === 'initial'
//                         ? 'Initial Email'
//                         : stepType === 'first'
//                           ? 'First Email'
//                           : 'Second Email',
//                       'i'
//                     ),
//                     active: true,
//                   });
//                   if (generalTpl) templateContent = generalTpl.content;
//                 }
//               }

//               templateContent = fillTemplate(templateContent, extractedFields);

//               const plainModule = module.toObject ? module.toObject() : module;
//               await sendEmailModule(
//                 { ...plainModule, template: templateContent },
//                 from,
//                 subject,
//                 emailId
//               );

//               const updatedDoc = await AutomationStatusModel.findByIdAndUpdate(
//                 statusDoc._id,
//                 {
//                   $push: { completedModules: module.id || module._id },
//                   $pull: { pendingModules: module.id || module._id },
//                   $set: { lastExecutedAt: new Date() },
//                 },
//                 { new: true }
//               );

//               if (updatedDoc.pendingModules.length > 0) {
//                 await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//                   $set: { status: 'partial' },
//                 });
//               } else {
//                 await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//                   $set: { status: 'completed' },
//                 });
//               }
//             } else {
//               console.log('⚠️ Unsupported module type:', module.type);
//             }
//           } catch (err) {
//             console.error('❌ Error in module execution:', err);
//             await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//               $set: { status: 'failed', lastExecutedAt: new Date() },
//             });
//           }
//         }

//         const finalDoc = await AutomationStatusModel.findById(statusDoc._id);
//         if (
//           finalDoc.pendingModules.length === 0 &&
//           finalDoc.status !== 'failed'
//         ) {
//           await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
//             $set: { status: 'completed', lastExecutedAt: new Date() },
//           });
//         }
//       }
//     }
//   } catch (err) {
//     console.error('❌ [executeScenarios] ERROR:', err);
//   }
// };


export const executeScenarios = async (emailData) => {
  try {
    const { userId, from, subject, body, emailId, parsedEmailObj } = emailData;
    console.log("\n🚀 [executeScenarios] START EXECUTION");
    console.log("📩 Incoming email data:", {
      userId,
      from,
      subject,
      emailId,
    });

    const extractedFields = extractFieldsFromEmail(
      parsedEmailObj || { text: body, subject, from }
    );

    console.log("🔍 Extracted fields:", extractedFields);
    console.log("📡 Fetching scenarios for user:", userId);

    const scenarios = await scenarioModel.find({ userId });
    console.log(`📦 Found ${scenarios.length} scenario(s) for user ${userId}`);

    for (const scenario of scenarios) {
      console.log(`\n🧩 Running Scenario: "${scenario.name}" (${scenario.type})`);

      if (!scenario.routerBranches?.length) {
        console.log("⚠️ No router branches found — skipping scenario.");
        continue;
      }

      for (const branch of scenario.routerBranches) {
        console.log(`➡️ Processing Branch ID: ${branch.id || branch._id}`);

        if (!branch.filter?.conditions?.length) {
          console.log("⚠️ No filter conditions — executing unconditionally.");
        }

        const matches = branch.filter?.conditions
          ? branch.filter.conditions.every((cond) => {
              const fieldValue =
                cond.field === "Body"
                  ? (body || "").toLowerCase()
                  : cond.field === "Subject"
                  ? (subject || "").toLowerCase()
                  : "";
              const condValue = (cond.value || "").toLowerCase();

              if (cond.operator === "Contains")
                return fieldValue.includes(condValue);
              if (cond.operator === "Equal to") return fieldValue === condValue;
              return false;
            })
          : true;

        if (!matches) {
          console.log("❌ Branch filter conditions not met — skipping.");
          continue;
        }

        if (!branch.modules?.length) {
          console.log("⚠️ No modules found in branch — skipping.");
          continue;
        }

        console.log(
          `✅ Branch matched — executing ${branch.modules.length} module(s)...`
        );

        let statusDoc = await AutomationStatusModel.create({
          userId,
          emailId,
          scenarioId: scenario._id,
          branchId: branch.id || branch._id,
          status: "pending",
          completedModules: [],
          pendingModules: branch.modules.map((m) => m.id || m._id),
        });

        for (let i = 0; i < branch.modules.length; i++) {
          const module = branch.modules[i];
          console.log(
            `\n⚙️ [Module ${i + 1}/${branch.modules.length}] Type: ${
              module.type || module.app?.name
            }`
          );

          try {
            // 🟢 Normalize module types for Shopify
            if (scenario.type?.toLowerCase() === "shopify") {
              const rawType = (module.type || module.app?.name || "").toLowerCase();
              if (
                rawType.includes("gmail") ||
                rawType.includes("email") ||
                rawType.includes("follow") ||
                rawType.includes("initial")
              ) {
                module.type = "Send an Email";
              } else if (rawType.includes("delay")) {
                module.type = "Delay";
              } else if (rawType.includes("router")) {
                module.type = "Router";
              } else if (rawType.includes("webhook")) {
                module.type = "Webhooks";
              }
              console.log(`🧠 Normalized Shopify module type → ${module.type}`);
            }

            // ============ DELAY MODULE ============
            if (module.type === "Delay") {
              console.log("⏳ Delay module detected. Scheduling follow-up...");

              const delayMs = convertToMs(module.delayValue, module.delayUnit);
              console.log(
                `🕒 Delay: ${module.delayValue} ${module.delayUnit} (${delayMs}ms)`
              );

              const remainingModules = [];

              for (const nextModule of branch.modules.slice(i + 1)) {
                const plain = nextModule.toObject
                  ? nextModule.toObject()
                  : { ...nextModule };

                const nextType = (plain.type || plain.app?.name || "").toLowerCase();
                if (
                  !(
                    nextType.includes("email") ||
                    nextType.includes("gmail") ||
                    nextType.includes("follow") ||
                    nextType.includes("initial")
                  )
                ) {
                  console.log(
                    `⚠️ Skipping non-email module after delay: ${plain.type}`
                  );
                  continue;
                }

                let templateContent = plain.template || "Thanks for your email!";
                let selectedTemplateName = "";
                let selectedService = "General";
                let stepType = "initial";

                if (scenario.type?.toLowerCase() === "shopify") {
                  const lower = (plain.template || "").toLowerCase();
                  if (lower.includes("first")) stepType = "first";
                  else if (lower.includes("second")) stepType = "second";

                  const textToSearch = (subject + " " + body).toLowerCase();
                  const defaultServices = [
                    "General",
                    "Troubleshooting",
                    "Theme customization",
                    "Store build or redesign",
                    "Store migration",
                    "Website and marketing content",
                    "SEO",
                    "Site performance and speed",
                    "Custom apps and integrations",
                    "Store settings configuration",
                    "Product and collection setup",
                    "Social media marketing",
                    "Product descriptions",
                    "Search engine advertising",
                    "POS setup and migration",
                    "Custom domain setup",
                    "Conversion rate optimization",
                    "Analytics and tracking",
                    "Sales channel setup",
                    "Logo and visual branding",
                    "Business strategy guidance",
                    "Website audit and optimization strategy",
                    "Sales tax guidance",
                    "Product photography",
                    "Email marketing",
                    "3D modelling",
                    "Banner ads",
                    "Video and illustrations",
                    "Content marketing",
                    "Product sourcing guidance",
                  ];

                  let matchedService = defaultServices.find((s) =>
                    textToSearch.includes(s.toLowerCase())
                  );
                  matchedService = matchedService || "General";

                  const tpl = await TemplateModel.findOne({
                    userId,
                    platform: "shopify",
                    service: new RegExp(`^${matchedService}$`, "i"),
                    name: new RegExp(
                      stepType === "initial"
                        ? "Initial Email"
                        : stepType === "first"
                        ? "First Email"
                        : "Second Email",
                      "i"
                    ),
                    active: true,
                  });

                  if (tpl) {
                    templateContent = tpl.content;
                    selectedTemplateName = tpl.name;
                    selectedService = matchedService;
                    console.log(
                      `✅ [Shopify] Found specific template "${tpl.name}" for service "${matchedService}" (${stepType})`
                    );
                  } else {
                    const generalTpl = await TemplateModel.findOne({
                      userId,
                      platform: "shopify",
                      service: /^General$/i,
                      name: new RegExp(
                        stepType === "initial"
                          ? "Initial Email"
                          : stepType === "first"
                          ? "First Email"
                          : "Second Email",
                        "i"
                      ),
                      active: true,
                    });
                    if (generalTpl) {
                      templateContent = generalTpl.content;
                      selectedTemplateName = generalTpl.name;
                      selectedService = "General";
                      console.log(
                        `ℹ️ [Shopify] Using fallback General template "${generalTpl.name}" (${stepType})`
                      );
                    } else {
                      console.warn(
                        `⚠️ [Shopify] No template found for step: ${stepType} (${matchedService})`
                      );
                    }
                  }
                }

                plain.template = fillTemplate(templateContent, extractedFields);
                remainingModules.push(plain);
              }

              await DelayJobModel.create({
                userId,
                emailData,
                emailId,
                scenarioId: scenario._id,
                modulesLeft: remainingModules,
                scheduledAt: new Date(Date.now() + delayMs),
              });
              console.log(`🕒 Created delay job with ${remainingModules.length} module(s).`);

              await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                $push: { completedModules: module.id || module._id },
                $set: {
                  pendingModules: remainingModules.map((m) => m.id || m._id),
                  status: "partial",
                  lastExecutedAt: new Date(),
                },
              });
              break;
            }

            // ============ SEND EMAIL MODULE ============
            if (module.type === "Send an Email" || module.type === "Custom Email") {
              console.log("📤 Executing Send Email module...");

              let templateContent = module.template || "Thanks for your email!";
              let selectedTemplateName = "";
              let selectedService = "General";
              let stepType = "initial";

              if (scenario.type?.toLowerCase() === "shopify") {
                const subjectLower = (subject || "").toLowerCase().trim();
                const isValidShopify = subjectLower.startsWith(
                  "shopify partner directory: new service inquiry from"
                );
                if (!isValidShopify) {
                  console.log(
                    `🚫 Skipping Shopify email — subject doesn't match trigger: "${subject}"`
                  );
                  continue;
                }

                const lower = (module.template || "").toLowerCase();
                if (lower.includes("first")) stepType = "first";
                else if (lower.includes("second")) stepType = "second";

                const textToSearch = (subject + " " + body).toLowerCase();
                const defaultServices = [
                  "General",
                  "Troubleshooting",
                  "Theme customization",
                  "Store build or redesign",
                  "Store migration",
                  "Website and marketing content",
                  "SEO",
                  "Site performance and speed",
                  "Custom apps and integrations",
                  "Store settings configuration",
                  "Product and collection setup",
                  "Social media marketing",
                  "Product descriptions",
                  "Search engine advertising",
                  "POS setup and migration",
                  "Custom domain setup",
                  "Conversion rate optimization",
                  "Analytics and tracking",
                  "Sales channel setup",
                  "Logo and visual branding",
                  "Business strategy guidance",
                  "Website audit and optimization strategy",
                  "Sales tax guidance",
                  "Product photography",
                  "Email marketing",
                  "3D modelling",
                  "Banner ads",
                  "Video and illustrations",
                  "Content marketing",
                  "Product sourcing guidance",
                ];

                let matchedService = defaultServices.find((s) =>
                  textToSearch.includes(s.toLowerCase())
                );
                matchedService = matchedService || "General";

                const tpl = await TemplateModel.findOne({
                  userId,
                  platform: "shopify",
                  service: new RegExp(`^${matchedService}$`, "i"),
                  name: new RegExp(
                    stepType === "initial"
                      ? "Initial Email"
                      : stepType === "first"
                      ? "First Email"
                      : "Second Email",
                    "i"
                  ),
                  active: true,
                });

                if (tpl) {
                  templateContent = tpl.content;
                  selectedTemplateName = tpl.name;
                  selectedService = matchedService;
                  console.log(
                    `✅ [Shopify] Found template "${tpl.name}" for service "${matchedService}" (${stepType})`
                  );
                } else {
                  const generalTpl = await TemplateModel.findOne({
                    userId,
                    platform: "shopify",
                    service: /^General$/i,
                    name: new RegExp(
                      stepType === "initial"
                        ? "Initial Email"
                        : stepType === "first"
                        ? "First Email"
                        : "Second Email",
                      "i"
                    ),
                    active: true,
                  });
                  if (generalTpl) {
                    templateContent = generalTpl.content;
                    selectedTemplateName = generalTpl.name;
                    selectedService = "General";
                    console.log(
                      `ℹ️ [Shopify] Using fallback General template "${generalTpl.name}" (${stepType})`
                    );
                  } else {
                    console.warn(
                      `⚠️ [Shopify] No template found for ${stepType} email (${matchedService})`
                    );
                  }
                }
              }

              console.log(
                `📧 Final Template: "${selectedTemplateName}" | Service: "${selectedService}" | Step: "${stepType}"`
              );

              templateContent = fillTemplate(templateContent, extractedFields);
              const plainModule = module.toObject ? module.toObject() : module;

              await sendEmailModule(
                { ...plainModule, template: templateContent },
                from,
                subject,
                emailId
              );

              console.log("✅ Email sent successfully for module.");

              const updatedDoc = await AutomationStatusModel.findByIdAndUpdate(
                statusDoc._id,
                {
                  $push: { completedModules: module.id || module._id },
                  $pull: { pendingModules: module.id || module._id },
                  $set: { lastExecutedAt: new Date() },
                },
                { new: true }
              );

              if (updatedDoc.pendingModules.length > 0) {
                console.log("🔁 Still modules remaining — status: partial");
                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $set: { status: "partial" },
                });
              } else {
                console.log("🏁 All modules completed — marking status completed.");
                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $set: { status: "completed" },
                });
              }
            } else {
              console.log(`⚠️ Unsupported module type: ${module.type}`);
            }
          } catch (err) {
            console.error("❌ Error executing module:", err);
            await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
              $set: { status: "failed", lastExecutedAt: new Date() },
            });
          }
        }

        const finalDoc = await AutomationStatusModel.findById(statusDoc._id);
        if (finalDoc?.pendingModules.length === 0 && finalDoc.status !== "failed") {
          console.log("🏆 Scenario branch execution complete — marking completed.");
          await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
            $set: { status: "completed", lastExecutedAt: new Date() },
          });
        }
      }
    }

    console.log("\n✅ [executeScenarios] All scenarios executed successfully.\n");
  } catch (err) {
    console.error("❌ [executeScenarios] FATAL ERROR:", err);
  }
};


const convertToMs = (value, unit) => {
  if (!value) return 0;
  if (unit === 'seconds') return value * 1000;
  if (unit === 'minutes') return value * 60 * 1000;
  if (unit === 'hours') return value * 60 * 60 * 1000;
  return value;
};

// export const sendEmailModule = async (
//   module,
//   to,
//   originalSubject,
//   parentEmailId
// ) => {
//   console.log(' [sendEmailModule] START =====================================');
//   console.log('[sendEmailModule] Function called with:', {
//     moduleId: module?._id || null,
//     to,
//     originalSubject,
//     parentEmailId,
//   });

//   try {
//     console.log(' [sendEmailModule] Fetching connection...');
//     const connection = await ConnectionModel.findById(module.connectionId);
//     if (!connection) {
//       console.error(
//         ' [sendEmailModule] No connection found for module:',
//         module.connectionId
//       );
//       return;
//     }

//     console.log('[sendEmailModule] Connection found:', {
//       provider: connection.provider,
//       email: connection.email,
//       smtpHost: connection.smtpHost,
//       smtpPort: connection.smtpPort,
//     });

//     const norm = (v) => {
//       const val = Array.isArray(v)
//         ? v.filter(Boolean).join(', ')
//         : (v || '').toString().trim();
//       console.log('📏 [norm] normalized value:', val);
//       return val;
//     };

//     const cc = norm(module.cc);
//     const bcc = norm(module.bcc);

//     console.log(' [sendEmailModule] Preparing email headers:', {
//       from: connection.email,
//       to,
//       cc,
//       bcc,
//     });

//     const finalSubject =
//       module.subject && module.subject.trim() !== ''
//         ? module.subject
//         : `Re: ${originalSubject || 'No Subject'}`;

//     console.log('[sendEmailModule] Final subject computed:', finalSubject);

//     const emailBody = module.template || 'Thanks for your email!';
//     console.log('[sendEmailModule] Email body length:', emailBody.length);

//     let sentOk = false;

//     if (connection.provider === 'gmail') {
//       console.log('[sendEmailModule] Gmail provider detected');
//       try {
//         console.log(' [GMAIL] Preparing OAuth2 client...');
//         const oauth2Client = new google.auth.OAuth2(
//           process.env.GOOGLE_CLIENT_ID,
//           process.env.GOOGLE_CLIENT_SECRET,
//           process.env.GOOGLE_REDIRECT_URI
//         );

//         console.log(' [GMAIL] Setting credentials...');
//         oauth2Client.setCredentials(connection.tokens);

//         console.log(' [GMAIL] Creating Gmail client...');
//         const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

//         const lines = [
//           `From: ${connection.email}`,
//           `To: ${to}`,
//           ...(cc ? [`Cc: ${cc}`] : []),
//           ...(bcc ? [`Bcc: ${bcc}`] : []),
//           `Subject: ${finalSubject}`,
//           'MIME-Version: 1.0',
//           'Content-Type: text/html; charset=UTF-8',
//           '',
//           emailBody,
//         ];

//         const rawMessage = lines.join('\n').trim();
//         console.log('[GMAIL] Raw message built, size:', rawMessage.length);

//         const encodedMessage = Buffer.from(rawMessage)
//           .toString('base64')
//           .replace(/\+/g, '-')
//           .replace(/\//g, '_')
//           .replace(/=+$/, '');

//         console.log(' [GMAIL] Sending email via Gmail API...');
//         const result = await gmail.users.messages.send({
//           userId: 'me',
//           requestBody: { raw: encodedMessage },
//         });

//         console.log(' [GMAIL] Email sent successfully:', result.data.id);
//         sentOk = true;
//       } catch (err) {
//         console.error(' [GMAIL] send error:', err);
//       }
//     } else if (
//       connection.provider === 'outlook' ||
//       connection.provider === 'smtp'
//     ) {
//       console.log(
//         '[sendEmailModule] SMTP/Outlook provider detected:',
//         connection.provider
//       );
//       try {
//         const isOutlook = connection.provider === 'outlook';
//         console.log(' [SMTP] Preparing transporter config...');

//         const transporterConfig = {
//           host:
//             connection.smtpHost ||
//             connection.smtp?.host ||
//             (isOutlook ? 'smtp.office365.com' : undefined),
//           port: connection.smtpPort || connection.smtp?.port || 587,
//           secure: (connection.smtpPort || connection.smtp?.port) === 465,
//           auth: {
//             user:
//               connection.smtpUser ||
//               connection.smtp?.username ||
//               connection.email,
//             pass: connection.smtpPass || connection.smtp?.password,
//           },
//         };

//         console.log('🔧 [SMTP] Transporter configuration:', transporterConfig);

//         console.log(
//           `[${connection.provider.toUpperCase()}] Creating transporter...`
//         );
//         const transporter = nodemailer.createTransport(transporterConfig);

//         console.log(`[${connection.provider.toUpperCase()}] Sending email...`);
//         const info = await transporter.sendMail({
//           from: connection.email,
//           to,
//           cc: cc || undefined,
//           bcc: bcc || undefined,
//           subject: finalSubject,
//           html: emailBody,
//         });

//         console.log(
//           `[${connection.provider.toUpperCase()}] Email sent:`,
//           info.messageId
//         );
//         sentOk = true;
//       } catch (err) {
//         console.error(
//           `[${connection.provider.toUpperCase()}] send error:`,
//           err
//         );
//       }
//     } else {
//       console.warn(
//         '[sendEmailModule] Unsupported provider:',
//         connection.provider
//       );
//     }

//     console.log(' [sendEmailModule] Checking if email was sent...');
//     if (sentOk) {
//       try {
//         console.log(' [sendEmailModule] Preparing to save sent email in DB...');

//         const sentDoc = new EmailModel({
//           userId: connection.userId,
//           senderAddress: connection.email,
//           recipientAddress: to,
//           subject: finalSubject,
//           textBody: emailBody.replace(/<\/?[^>]+(>|$)/g, ''),
//           htmlBody: emailBody,
//           cc: cc ? cc.split(',').map((a) => a.trim()) : [],
//           bcc: bcc ? bcc.split(',').map((a) => a.trim()) : [],
//           date: new Date(),
//           isForwarded: true,
//           parentEmailId: parentEmailId || null,
//           forwardedMeta: {
//             from: connection.email,
//             to,
//             subject: originalSubject,
//             date: new Date().toISOString(),
//             body: emailBody,
//           },
//         });

//         console.log('🗄️ [sendEmailModule] Saving document...');
//         await sentDoc.save();

//         console.log(
//           ' [sendEmailModule] Email saved in DB:',
//           sentDoc._id.toString()
//         );
//       } catch (err) {
//         console.error(' [sendEmailModule] Error saving sent email:', err);
//       }
//     } else {
//       console.warn(' [sendEmailModule] Email not sent, skipping DB save.');
//     }

//     console.log(
//       '[sendEmailModule] END =====================================\n'
//     );
//   } catch (outerErr) {
//     console.error(
//       ' [sendEmailModule] Unexpected error in main try block:',
//       outerErr
//     );
//   }
// };

export const sendEmailModule = async (
  module,
  to,
  originalSubject,
  parentEmailId
) => {
  console.log(' [sendEmailModule] START =====================================');
  console.log('[sendEmailModule] Function called with:', {
    moduleId: module?._id || null,
    to,
    originalSubject,
    parentEmailId,
  });

  try {
    const connection = await ConnectionModel.findById(module.connectionId);
    if (!connection) {
      console.error(
        ' [sendEmailModule] No connection found for module:',
        module.connectionId
      );
      return;
    }

    console.log('[sendEmailModule] Connection found:', {
      provider: connection.provider,
      email: connection.email,
    });

    const finalSubject =
      module.subject && module.subject.trim() !== ''
        ? module.subject
        : `Re: ${originalSubject || 'No Subject'}`;

    const emailBody = module.template || 'Thanks for your email!';
    const cc =
      (Array.isArray(module.cc) ? module.cc.join(',') : module.cc) || '';
    const bcc =
      (Array.isArray(module.bcc) ? module.bcc.join(',') : module.bcc) || '';

    let sentOk = false;

    if (connection.provider === 'gmail') {
      try {
        console.log('[GMAIL] Preparing OAuth2 client...');
        const oauth2Client = new google.auth.OAuth2(
          process.env.GOOGLE_CLIENT_ID,
          process.env.GOOGLE_CLIENT_SECRET,
          process.env.GOOGLE_REDIRECT_URI
        );
        oauth2Client.setCredentials(connection.tokens);

        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

        const lines = [
          `From: ${connection.email}`,
          `To: ${to}`,
          cc ? `Cc: ${cc}` : '',
          bcc ? `Bcc: ${bcc}` : '',
          `Subject: ${finalSubject}`,
          'MIME-Version: 1.0',
          'Content-Type: text/html; charset=UTF-8',
          '',
          emailBody,
        ].filter(Boolean);

        const raw = Buffer.from(lines.join('\n'))
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');

        const result = await gmail.users.messages.send({
          userId: 'me',
          requestBody: { raw },
        });

        console.log('[GMAIL] Sent message:', result.data.id);
        sentOk = true;
      } catch (err) {
        console.error('[GMAIL] send error:', err);
      }
    } else if (connection.provider === 'outlook') {
      try {
        console.log('[OUTLOOK] Sending via Microsoft Graph API...');

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
            subject: finalSubject,
            body: { contentType: 'HTML', content: emailBody },
            toRecipients: [{ emailAddress: { address: toClean } }],
            ccRecipients: ccClean,
          },
          saveToSentItems: true,
        };

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
          console.log('[OUTLOOK] Email sent successfully via Graph API');
          sentOk = true;
        } else {
          const error = await response.text();
          console.error('[OUTLOOK] Graph API error:', error);
        }
      } catch (err) {
        console.error('[OUTLOOK] send error:', err);
      }
    } else if (connection.provider === 'smtp') {
      try {
        console.log('[SMTP] Sending via nodemailer...');
        const transporter = nodemailer.createTransport({
          host: connection.smtpHost,
          port: connection.smtpPort || 587,
          secure: connection.smtpPort === 465,
          auth: {
            user: connection.smtpUser || connection.email,
            pass: connection.smtpPass,
          },
        });

        const info = await transporter.sendMail({
          from: connection.email,
          to,
          cc,
          bcc,
          subject: finalSubject,
          html: emailBody,
        });

        console.log('[SMTP] Email sent:', info.messageId);
        sentOk = true;
      } catch (err) {
        console.error('[SMTP] send error:', err);
      }
    }

    if (sentOk) {
      const sentDoc = new EmailModel({
        userId: connection.userId,
        senderAddress: connection.email,
        recipientAddress: to,
        subject: finalSubject,
        textBody: emailBody.replace(/<\/?[^>]+(>|$)/g, ''),
        htmlBody: emailBody,
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
      console.log('[sendEmailModule] Email saved:', sentDoc._id.toString());
    } else {
      console.warn('[sendEmailModule] Email not sent, skipping save.');
    }

    console.log(
      '[sendEmailModule] END =====================================\n'
    );
  } catch (outerErr) {
    console.error('[sendEmailModule] Unexpected error:', outerErr);
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
      return res.status(400).json({ message: "userId is required" });
    }

    // 🔹 Fetch the latest email for the user (any sender)
    const email = await EmailModel.findOne({ userId })
      .sort({ createdAt: -1 })
      .lean();

    if (!email) {
      return res.status(404).json({ message: "No emails found for this user." });
    }

    // 🔹 Build response with safe defaults
    const result = {
      subject: email.subject || "(No Subject)",
      date: email.date || email.createdAt,
      sender: email.senderAddress || "Unknown Sender",
      textBody:
        email.textBody?.slice(0, 1000) ||
        email.htmlBody?.replace(/<[^>]*>?/gm, "").slice(0, 1000) ||
        "(No Content)",
      verificationUrl:
        email.verificationUrl ||
        email.extraFields?.https ||
        email.extraFields?.visit ||
        null,
      verificationCode: email.verificationCode || null,
    };

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("❌ Error fetching latest email:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const validateTestEmail = async (req, res) => {
  try {
    const { userId } = req.params;
    const { toEmail } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    if (!toEmail) {
      return res.status(400).json({
        success: false,
        message: "Missing recipient email address (toEmail).",
      });
    }

    const user = await authModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const testSubject = "Zenith Forwarding Validation Test";
    const testBody = `Hello ,
    
This is a test email from Zenith Inbox to confirm that your email forwarding setup is working correctly.

If you receive this email, your mail forwarding is active and functioning.

— Zenith Inbox Team`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
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

    console.log(`✅ Test email sent to: ${toEmail}`);

    return res.json({
      success: true,
      message: `Test email successfully sent to ${toEmail}. Please check your inbox and verify forwarding.`,
      sentTo: toEmail,
    });
  } catch (err) {
    console.error("💥 Error sending test email:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send test email.",
      error: err.message,
    });
  }
};
export const getValidateEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    const email = await EmailModel.findOne({
      userId,
      senderAddress: /forwarding-noreply@google.com/i,
      subject: { $regex: 'Gmail Forwarding Confirmation', $options: 'i' },
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!email) {
      return res.status(404).json({
        success: false,
        message: 'No Gmail validation email found yet.',
      });
    }

    const verificationUrl =
      email.verificationUrl ||
      (email.textBody?.match(
        /https:\/\/mail-settings\.google\.com\/mail\/vf-[^\s]+/i
      ) || [])[0] ||
      null;

    return res.json({
      success: true,
      email: {
        id: email._id,
        subject: email.subject,
        sender: email.senderAddress,
        date: email.date,
        verificationUrl,
        textBody: email.textBody,
      },
    });
  } catch (err) {
    console.error('Error fetching validation email:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

export const getTestEmailData = async (req, res) => {
  try {
    const { userId } = req.params;
    const testData = await TestEmailDataModel.findOne({ userId });

    if (!testData) {
      return res
        .status(404)
        .json({ success: false, message: 'No test data found' });
    }

    res.json({ success: true, data: testData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};


export const deleteConnectionById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ success: false, message: "Connection ID is required." });
    }

    const existing = await ConnectionModel.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Connection not found." });
    }

    await ConnectionModel.findByIdAndDelete(id);


    return res.status(200).json({
      success: true,
      message: `Connection for ${existing.email} deleted successfully.`,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error while deleting connection.",
      error: error.message,
    });
  }
};