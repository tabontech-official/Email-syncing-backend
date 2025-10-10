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
    `✅ Condition result [${condition.field} ${condition.operator} ${condition.value}] = ${result}`
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
      console.log('📡 New connection from:', session.remoteAddress);
      callback();
    },
    onData(stream, session, callback) {
      console.log('📩 Receiving new email...');

      let chunks = [];

      stream.on('data', (chunk) => {
        console.log('📥 Data chunk received, length:', chunk.length);
        chunks.push(chunk);
      });

      stream.on('end', async () => {
        console.log('📤 End of data stream, parsing email...');

        try {
          const rawEmail = Buffer.concat(chunks);
          const parsed = await simpleParser(rawEmail);

          console.log('📧 Parsed email:', {
            from: parsed.from?.text,
            to: parsed.to?.text,
            subject: parsed.subject,
          });

          const recipient = parsed.to?.value[0]?.address;
          const sender = parsed.from?.text;

          console.log('📌 Recipient:', recipient);
          console.log('📌 Sender:', sender);

          const user = await authModel.findOne({ mailhook: recipient });
          console.log('👤 User lookup result:', user ? user.email : null);

          if (!user) {
            console.warn('⚠️ No user found for mailhook:', recipient);
            return callback();
          }

          const emailData = {
            subject: parsed.subject || '',
            body: parsed.text || parsed.html || '',
            sender: sender || '',
            recipient: recipient || '',
          };
          console.log('📄 Email data for template matching:', emailData);

          // Find active templates
          const templates = await TemplateModel.find({
            userId: user._id,
            active: true,
          });
          console.log(`📋 Found ${templates.length} active templates for user`);

          let matchedTemplate = null;
          for (const tpl of templates) {
            if (matchesTemplate(tpl, emailData)) {
              matchedTemplate = tpl;
              console.log('✅ Matched template:', tpl._id);
              break; // stop at first match
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
            `💾 Email saved to DB with ID: ${emailDoc._id} ${
              matchedTemplate
                ? `(linked to template: ${matchedTemplate._id})`
                : '(no template matched)'
            }`
          );

          callback();
        } catch (err) {
          console.error('❌ Error parsing or saving email:', err);
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
    console.error('❌ Error fetching emails:', err);
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
    console.log('📩 [mailHookWebhook] Incoming request body:', req.body);

    const rawEmail = req.body.email || null;
    let parsed = {};

    if (rawEmail) {
      console.log('📨 Raw email string detected, parsing with simpleParser...');
      parsed = await simpleParser(rawEmail);
    } else {
      console.log('📨 No raw email, falling back to manual parsing...');
      parsed = {
        from: { value: [{ address: req.body.from, name: req.body.from }] },
        to: { value: [{ address: req.body.to, name: req.body.to }] },
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
      };
    }
    console.log('✅ Parsed email object:', parsed);

    const senderAddress = parsed.from?.value?.[0]?.address || '';
    const senderName = parsed.from?.value?.[0]?.name || '';
    console.log('👤 Sender:', senderName, `<${senderAddress}>`);

    const { firstName: senderFirstName, lastName: senderLastName } =
      splitName(senderName);

    const headerRecipient = parsed.to?.value?.[0]?.address || '';
    let mailhookAddress =
      req.body.envelope?.to ||
      (Array.isArray(req.body.to) ? req.body.to[0] : req.body.to) ||
      headerRecipient;

    console.log('📨 Initial mailhook address:', mailhookAddress);

    if (Array.isArray(req.body.to)) {
      const brandferAddress = req.body.to.find((a) =>
        a.includes('@mail.brandfer.com')
      );
      if (brandferAddress) {
        console.log('📌 Found brandfer address:', brandferAddress);
        mailhookAddress = brandferAddress;
      }
    }

    if (mailhookAddress.includes('<')) {
      mailhookAddress = mailhookAddress.split('<')[1].replace('>', '').trim();
    }
    mailhookAddress = mailhookAddress.trim().toLowerCase();
    console.log('📬 Final mailhookAddress:', mailhookAddress);

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

    console.log('📋 Email meta extracted:', {
      subject,
      cc,
      bcc,
      attachmentsCount: attachments.length,
      date,
    });

    let verificationCode = null;
    let verificationUrl = null;
    if (subject.includes('Gmail Forwarding Confirmation')) {
      console.log('🔐 Gmail forwarding confirmation detected');
      const codeMatch = textBody.match(/Confirmation code:\s*(\d+)/i);
      if (codeMatch) verificationCode = codeMatch[1];
      const urlMatch = textBody.match(
        /https:\/\/mail-settings\.google\.com\/mail\/vf-[\S]+/i
      );
      if (urlMatch) verificationUrl = urlMatch[0];
    }

    const extraFields = parseKeyValuePairs(textBody);
    console.log('🗂 Extra fields extracted:', extraFields);

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
    console.log(`📑 Found ${templates.length} active templates for user`);

    let matchedTemplate = null;
    for (const tpl of templates) {
      if (
        subject.includes(tpl.keyword) ||
        textBody.includes(tpl.keyword) ||
        htmlBody.includes(tpl.keyword)
      ) {
        matchedTemplate = tpl;
        console.log('✅ Matched template:', tpl._id.toString(), tpl.name);
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
    console.log('💾 Email saved to DB:', emailDoc._id.toString());

    console.log('🚀 Executing scenarios for this email...');
    await executeScenarios({
      userId: user._id,
      from: senderAddress,
      subject,
      body: textBody || htmlBody || '',
      emailId: emailDoc._id.toString(),
      parsedEmailObj: parsed,
    });
    console.log('✅ Scenarios executed for email:', emailDoc._id.toString());

    res.status(200).send('Email processed and saved');
  } catch (err) {
    console.error('❌ mailHookWebhook ERROR:', err.message, err.stack);
    res.status(500).send('Error processing email');
  }
};

// export const executeScenarios = async (emailData) => {
//   try {
//     const { userId, from, subject, body, emailId } = emailData;

//     const scenarios = await scenarioModel.find({ userId });

//     for (const scenario of scenarios) {
//       if (!scenario.routerBranches || scenario.routerBranches.length === 0) {
//         continue;
//       }

//       for (const branch of scenario.routerBranches) {
//         if (!branch.filter || !Array.isArray(branch.filter.conditions)) {
//           continue;
//         }

//         const matches = branch.filter.conditions.every((cond, idx) => {
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

//         if (!matches) {
//           continue;
//         }

//         if (!branch.modules || branch.modules.length === 0) {
//           continue;
//         }

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

//                     if (tpl) {
//                       templateContent = tpl.content;
//                     } else {
//                     }
//                   }
//                   plain.template = templateContent;
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
//                 const lower = (module.template || '').toLowerCase();
//                 if (lower.includes('first')) stepType = 'first';
//                 else if (lower.includes('second')) stepType = 'second';
//                 console.log(`🔹 Detected step type: ${stepType}`);

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
//                 console.log(`🛍️ Matched service from email: ${matchedService}`);

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

//                 if (tpl) {
//                   templateContent = tpl.content;
//                 }
//               }

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
//             $set: {
//               status: 'completed',
//               lastExecutedAt: new Date(),
//             },
//           });
//         }
//       }
//     }
//   } catch (err) {
//     console.error('❌ [executeScenarios] ERROR:', err);
//   }
// };

function fillTemplate(template, fields) {
  return template.replace(/{{(.*?)}}/g, (_, key) => {
    const cleanKey = key.trim();
    return fields[cleanKey] || '';
  });
}

function extractFieldsFromEmail(emailObj = {}) {
  const fields = {};

  // ✅ Full Name & Email
  if (emailObj.from?.value?.[0]) {
    fields.FullName = emailObj.from.value[0].name || '';
    fields.BusinessEmail = emailObj.from.value[0].address || '';
  } else if (typeof emailObj.from === 'string') {
    const match = emailObj.from.match(/^(.*?)\s*<(.+)>$/);
    fields.FullName = match ? match[1].trim() : '';
    fields.BusinessEmail = match ? match[2].trim() : emailObj.from;
  }

  // ✅ Budget, Country
  const kv = parseKeyValuePairs(emailObj.text || '');
  if (kv.budget) fields.Budget = kv.budget;
  if (kv.country) fields.Country = kv.country;

  // ✅ Store name
  const storeMatch = (emailObj.text || '').match(/store\s+"([^"]+)"/i);
  if (storeMatch) fields.StoreName = storeMatch[1];

  // ✅ Store URL
  const urlMatch = (emailObj.text || '').match(/https?:\/\/[^\s]+/i);
  if (urlMatch) fields.StoreURL = urlMatch[0];

  // ✅ ProblemGoal
  const lines = (emailObj.text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  fields.ProblemGoal = lines.slice(1, 3).join(' ') || '';

  // ✅ Service
  fields.Service = emailObj.subject || '';

  return fields;
}

export const executeScenarios = async (emailData) => {
  try {
    const { userId, from, subject, body, emailId, parsedEmailObj } = emailData;
    console.log('🚀 [executeScenarios] START EXECUTION');
    console.log('📥 Incoming email data:', emailData);
    const extractedFields = extractFieldsFromEmail(
      parsedEmailObj || { text: body, subject, from }
    );
    console.log('📡 Fetching scenarios for user:', userId);

    const scenarios = await scenarioModel.find({ userId });

    for (const scenario of scenarios) {
      if (!scenario.routerBranches || scenario.routerBranches.length === 0)
        continue;

      for (const branch of scenario.routerBranches) {
        if (!branch.filter || !Array.isArray(branch.filter.conditions))
          continue;

        // ✅ Condition check
        const matches = branch.filter.conditions.every((cond) => {
          const fieldValue =
            cond.field === 'Body'
              ? (body || '').toLowerCase()
              : cond.field === 'Subject'
                ? (subject || '').toLowerCase()
                : '';
          const condValue = (cond.value || '').toLowerCase();

          if (cond.operator === 'Contains')
            return fieldValue.includes(condValue);
          if (cond.operator === 'Equal to') return fieldValue === condValue;
          return false;
        });

        if (!matches) continue;
        if (!branch.modules || branch.modules.length === 0) continue;

        // ✅ Status doc
        let statusDoc = await AutomationStatusModel.create({
          userId,
          emailId,
          scenarioId: scenario._id,
          branchId: branch.id || branch._id,
          status: 'pending',
          completedModules: [],
          pendingModules: branch.modules.map((m) => m.id || m._id),
        });

        for (let i = 0; i < branch.modules.length; i++) {
          const module = branch.modules[i];

          try {
            // ---------------- Delay ----------------
            if (
              module.type === 'Delay' ||
              (!module.type && module.app?.name === 'Delay')
            ) {
              const delayMs = convertToMs(module.delayValue, module.delayUnit);
              const remainingModules = [];

              for (const nextModule of branch.modules.slice(i + 1)) {
                const plain = nextModule.toObject
                  ? nextModule.toObject()
                  : { ...nextModule };

                if (
                  plain.type === 'Send an Email' ||
                  plain.type === 'Custom Email'
                ) {
                  let templateContent =
                    plain.template || 'Thanks for your email!';

                  if (scenario.type?.toLowerCase() === 'shopify') {
                    let stepType = 'initial';
                    const lower = (plain.template || '').toLowerCase();
                    if (lower.includes('first')) stepType = 'first';
                    else if (lower.includes('second')) stepType = 'second';

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

                    let matchedService = 'General';
                    const textToSearch = (subject + ' ' + body).toLowerCase();
                    const found = defaultServices.find((s) =>
                      textToSearch.includes(s.toLowerCase())
                    );
                    if (found) matchedService = found;

                    const tpl = await TemplateModel.findOne({
                      userId,
                      platform: 'shopify',
                      service: new RegExp(`^${matchedService}$`, 'i'),
                      name: new RegExp(
                        stepType === 'initial'
                          ? 'Initial Email'
                          : stepType === 'first'
                            ? 'First Email'
                            : 'Second Email',
                        'i'
                      ),
                      active: true,
                    });

                    if (tpl) templateContent = tpl.content;
                    else {
                      const generalTpl = await TemplateModel.findOne({
                        userId,
                        platform: 'shopify',
                        service: /^General$/i,
                        name: new RegExp(
                          stepType === 'initial'
                            ? 'Initial Email'
                            : stepType === 'first'
                              ? 'First Email'
                              : 'Second Email',
                          'i'
                        ),
                        active: true,
                      });
                      if (generalTpl) templateContent = generalTpl.content;
                    }
                  }

                  // 🟪 Fill placeholders
                  plain.template = fillTemplate(
                    templateContent,
                    extractedFields
                  );
                }

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

            // ---------------- Send Email ----------------
            if (
              module.type === 'Send an Email' ||
              module.type === 'Custom Email'
            ) {
              let templateContent = module.template || 'Thanks for your email!';

              if (scenario.type && scenario.type.toLowerCase() === 'shopify') {
                let stepType = 'initial';
                const lower = (module.template || '').toLowerCase();
                if (lower.includes('first')) stepType = 'first';
                else if (lower.includes('second')) stepType = 'second';

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

                let matchedService = 'General';
                const textToSearch = (subject + ' ' + body).toLowerCase();
                const found = defaultServices.find((s) =>
                  textToSearch.includes(s.toLowerCase())
                );
                if (found) matchedService = found;

                const tpl = await TemplateModel.findOne({
                  userId,
                  platform: 'shopify',
                  service: new RegExp(`^${matchedService}$`, 'i'),
                  name: new RegExp(
                    stepType === 'initial'
                      ? 'Initial Email'
                      : stepType === 'first'
                        ? 'First Email'
                        : 'Second Email',
                    'i'
                  ),
                  active: true,
                });

                if (tpl) templateContent = tpl.content;
                else {
                  const generalTpl = await TemplateModel.findOne({
                    userId,
                    platform: 'shopify',
                    service: /^General$/i,
                    name: new RegExp(
                      stepType === 'initial'
                        ? 'Initial Email'
                        : stepType === 'first'
                          ? 'First Email'
                          : 'Second Email',
                      'i'
                    ),
                    active: true,
                  });
                  if (generalTpl) templateContent = generalTpl.content;
                }
              }

              // 🟪 Fill placeholders
              templateContent = fillTemplate(templateContent, extractedFields);

              const plainModule = module.toObject ? module.toObject() : module;
              await sendEmailModule(
                { ...plainModule, template: templateContent },
                from,
                subject,
                emailId
              );

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
                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $set: { status: 'partial' },
                });
              } else {
                await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                  $set: { status: 'completed' },
                });
              }
            } else {
              console.log('⚠️ Unsupported module type:', module.type);
            }
          } catch (err) {
            console.error('❌ Error in module execution:', err);
            await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
              $set: { status: 'failed', lastExecutedAt: new Date() },
            });
          }
        }

        // ✅ Final check
        const finalDoc = await AutomationStatusModel.findById(statusDoc._id);
        if (
          finalDoc.pendingModules.length === 0 &&
          finalDoc.status !== 'failed'
        ) {
          await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
            $set: { status: 'completed', lastExecutedAt: new Date() },
          });
        }
      }
    }
  } catch (err) {
    console.error('❌ [executeScenarios] ERROR:', err);
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
  console.log('[sendEmailModule] Function called with:', {
    moduleId: module?._id || null,
    to,
    originalSubject,
    parentEmailId,
  });

  const connection = await ConnectionModel.findById(module.connectionId);
  if (!connection) {
    console.error(
      ' [sendEmailModule] No connection found for module:',
      module.connectionId
    );
    return;
  }
  console.log(
    ' [sendEmailModule] Connection found:',
    connection.provider,
    connection.email
  );

  const norm = (v) =>
    Array.isArray(v)
      ? v.filter(Boolean).join(', ')
      : (v || '').toString().trim();

  const cc = norm(module.cc);
  const bcc = norm(module.bcc);

  console.log('📨 [sendEmailModule] Preparing email with:', {
    from: connection.email,
    to,
    cc,
    bcc,
  });

  const finalSubject =
    module.subject && module.subject.trim() !== ''
      ? module.subject
      : `Re: ${originalSubject || 'No Subject'}`;

  const emailBody = module.template || 'Thanks for your email!';
  console.log('📝 [sendEmailModule] Final subject & body ready:', finalSubject);

  let sentOk = false;

  // === GMAIL SEND ===
  if (connection.provider === 'gmail') {
    try {
      console.log('🚀 [GMAIL] Preparing OAuth2 client...');
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
        ...(cc ? [`Cc: ${cc}`] : []),
        ...(bcc ? [`Bcc: ${bcc}`] : []),
        `Subject: ${finalSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        '',
        emailBody,
      ];
      const rawMessage = lines.join('\n').trim();

      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      console.log('📤 [GMAIL] Sending email...');
      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });
      console.log('✅ [GMAIL] Email sent:', result.data.id);
      sentOk = true;
    } catch (err) {
      console.error('❌ [GMAIL] send error:', err);
    }
  }
  // === OUTLOOK/SMTP SEND ===
  else if (
    connection.provider === 'outlook' ||
    connection.provider === 'smtp'
  ) {
    try {
      const isOutlook = connection.provider === 'outlook';
      console.log(
        `🚀 [${connection.provider.toUpperCase()}] Preparing transporter...`
      );

      const transporter = nodemailer.createTransport({
        host:
          connection.smtpHost ||
          connection.smtp?.host ||
          (isOutlook ? 'smtp.office365.com' : undefined),
        port: connection.smtpPort || connection.smtp?.port || 587,
        secure: (connection.smtpPort || connection.smtp?.port) === 465,
        auth: {
          user:
            connection.smtpUser ||
            connection.smtp?.username ||
            connection.email,
          pass: connection.smtpPass || connection.smtp?.password,
        },
      });

      console.log(`📤 [${connection.provider.toUpperCase()}] Sending email...`);
      const info = await transporter.sendMail({
        from: connection.email,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject: finalSubject,
        html: emailBody,
      });
      console.log(
        `✅ [${connection.provider.toUpperCase()}] Email sent:`,
        info.messageId
      );
      sentOk = true;
    } catch (err) {
      console.error(
        `❌ [${connection.provider.toUpperCase()}] send error:`,
        err
      );
    }
  } else {
    console.warn(
      '⚠️ [sendEmailModule] Unsupported provider:',
      connection.provider
    );
  }

  // === SAVE SENT EMAIL in DB ===
  if (sentOk) {
    try {
      console.log('💾 [sendEmailModule] Saving sent/forwarded email in DB...');

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
      console.log(
        '✅ [sendEmailModule] Forward/Response saved:',
        sentDoc._id.toString()
      );
    } catch (err) {
      console.error('❌ [sendEmailModule] Error saving sent email:', err);
    }
  } else {
    console.warn('⚠️ [sendEmailModule] Email not sent, skipping DB save.');
  }

  console.log('🏁 [sendEmailModule] END\n');
};

// export const RunTestMode = async (req, res) => {
//   try {
//     const { userId } = req.body;

//     if (!userId) {
//       return res.status(400).json({
//         success: false,
//         message: "Missing userId in request body",
//       });
//     }

//     const user = await authModel.findById(userId);
//     if (!user || !user.mailhook) {
//       return res.status(404).json({
//         success: false,
//         message: "Mailhook not found for this user.",
//       });
//     }

//     const mailhook = user.mailhook;
//     const FullName = user.fullName || "User";

//     const transporter = nodemailer.createTransport({
//       service: "gmail",
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//       },
//     });

//     const subject = "Test Email For - Need help customizing my Shopify theme";
//     const textBody = `
// Hello ${FullName},

// I want to set up a Troubleshooting for my Shopify store "Motion Pine".
// The store link is https://allspicestore.myshopify.com

// Budget: 100 USD
// Country: Pakistan

// Thanks,
// Zenith Inbox
// `;

//     const emailId = `test-${Date.now()}`;
//     const fromAddress = `Zenith Inbox <${process.env.EMAIL_USER}>`;

//     await transporter.sendMail({
//       from: fromAddress,
//       to: mailhook,
//       subject,
//       text: textBody,
//     });

//     console.log(`✅ Test email sent → ${mailhook}`);

//     const savedEmail = await EmailModel.create({
//       userId,
//       senderAddress: fromAddress,
//       recipientAddress: mailhook,
//       subject,
//       textBody,
//       htmlBody: textBody.replace(/\n/g, "<br>"),
//       isForwarded: false,
//       parentEmailId: emailId,
//       date: new Date(),
//     });

//     console.log("💾 [RunTestMode] Saved test email in DB:", savedEmail._id);

//     await executeScenarios({
//       userId,
//       from: fromAddress,
//       subject,
//       body: textBody,
//       emailId,
//       parsedEmailObj: {
//         from: {
//           value: [{ name: "Zenith Inbox", address: process.env.EMAIL_USER }],
//         },
//         subject,
//         text: textBody,
//       },
//     });

//     console.log("🚀 Scenario executed successfully for test email.");

//     res.json({
//       success: true,
//       message: `✅ Test email sent, saved, and scenario executed for ${mailhook}`,
//       testEmail: savedEmail,
//     });
//   } catch (err) {
//     console.error("❌ Run Test Error:", err);
//     res.status(500).json({
//       success: false,
//       message: "Failed to send test email or execute scenario.",
//       error: err.message,
//     });
//   }
// };

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

    // ✅ Validate required fields
    if (!userId || !fullName || !businessEmail || !service) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields.",
      });
    }

    // ✅ Find user and verify mailhook
    const user = await authModel.findById(userId);
    if (!user || !user.mailhook) {
      return res.status(404).json({
        success: false,
        message: "Mailhook not found for this user.",
      });
    }

    const mailhook = user.mailhook;
    const partnerName = user.fullName || "The Fold Tech";
    const dummyCustomer = "Dummy Customer";

    // ✅ Setup Nodemailer
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // ✅ Subject line
    const subject = `FW: Shopify Partner Directory: New Service Inquiry from ${dummyCustomer} to ${partnerName}`;

    // ✅ Email text (for fallback)
    const textBody = `
Hello ${partnerName} and ${dummyCustomer},

${dummyCustomer} has expressed interest in your services through the Shopify Partner Directory. ${partnerName}, to initiate the conversation, please follow up with ${dummyCustomer} directly by selecting “Reply all” when you reach out.

All further communications will be between you both directly.

Details about ${dummyCustomer}'s request are provided below:

Full name:

${dummyCustomer}

Business email:

${businessEmail}

Store: 

${storeName || "N/A"}

Country:

${country}

Service:

${service}

Budget:

${budget || "Not specified"}

Description:

${helpDescription || "No additional information provided."}

Thank you for being a part of the Shopify Partner Directory.

Sincerely,
The Shopify Team
`;

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
      ${storeName || "N/A"}<br>
      <a href="https://${storeName ? storeName.toLowerCase().replace(/\s+/g, "") : "example"}.myshopify.com" 
         style="color:#006eff; text-decoration:none;">
         https://${storeName ? storeName.toLowerCase().replace(/\s+/g, "") : "example"}.myshopify.com
      </a>
    </p>

    <p style="margin:8px 0;"><strong>Country</strong><br>${country}</p>

    <p style="margin:8px 0;"><strong>Select a service offered by ${partnerName}</strong><br>${service}</p>

    <p style="margin:8px 0;"><strong>Budget (USD)</strong><br>${budget || "Not specified"}</p>

  
  </div>

  <p style="margin-top:20px;">
    Thank you for being a part of the <strong>Shopify Partner Directory</strong>.
  </p>

  <p style="font-weight:bold; margin-top:8px;">Sincerely,<br>The Shopify Team</p>
</div>
`;

    const emailId = `test-${Date.now()}`;
    const fromAddress = `Zenith Inbox <${process.env.EMAIL_USER}>`;

    // ✅ Send test email
    await transporter.sendMail({
      from: fromAddress,
      to: mailhook,
      subject,
      text: textBody,
      html: htmlBody,
    });

    console.log(`✅ Test email sent → ${mailhook}`);

    // ✅ Save to DB
    const savedEmail = await EmailModel.create({
      userId,
      senderFirstName: dummyCustomer.split(" ")[0],
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

    console.log("💾 Saved test email:", savedEmail._id);

    // ✅ Trigger automation
    await executeScenarios({
      userId,
      from: fromAddress,
      subject,
      body: textBody,
      emailId,
      parsedEmailObj: {
        from: {
          value: [{ name: "Zenith Inbox", address: process.env.EMAIL_USER }],
        },
        subject,
        text: textBody,
        html: htmlBody,
      },
    });

    res.json({
      success: true,
      message: `✅ Test email sent and scenario executed for ${mailhook}`,
      testEmail: savedEmail,
    });
  } catch (err) {
    console.error("❌ Run Test Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send test email or execute scenario.",
      error: err.message,
    });
  }
};


export const getTestEmail = async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Validate
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId in request params',
      });
    }

    // ✅ Find the latest test email where isTestEmail = true
    const latestEmail = await EmailModel.findOne({
      userId,
      isTestEmail: true, // ✅ only fetch test emails
    })
      .sort({ createdAt: -1 }) // latest first
      .lean();

    // ✅ Handle not found
    if (!latestEmail) {
      return res.status(404).json({
        success: false,
        message: 'No test email found for this user.',
      });
    }

    // ✅ Success response
    res.json({
      success: true,
      message: '✅ Latest test email fetched successfully!',
      email: latestEmail,
    });
  } catch (error) {
    console.error('❌ [getTestEmail] Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching test email.',
      error: error.message,
    });
  }
};

// export const getEmailsForUsers = async (req, res) => {
//   try {
//     const { userId } = req.params;

//     const emails = await EmailModel.find({
//       userId,
//       isForwarded: false,
//       parentEmailId: null,
//     })
//       .sort({ date: -1 })
//       .lean();

//     if (!emails || emails.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "No parent emails found for this user",
//       });
//     }

//     const emailIds = emails.map((e) => e._id.toString());

//     const statuses = await AutomationStatusModel.find({
//       userId,
//       emailId: { $in: emailIds },
//     })
//       .populate("scenarioId", "name type")
//       .lean();

//     const statusMap = {};
//     statuses.forEach((s) => {
//       if (!statusMap[s.emailId]) statusMap[s.emailId] = [];
//       statusMap[s.emailId].push(s);
//     });

//     const result = emails.map((email) => ({
//       ...email,
//       statuses: statusMap[email._id.toString()] || [],
//     }));

//     return res.json({
//       success: true,
//       totalEmails: emails.length,
//       data: result,
//     });
//   } catch (err) {
//     console.error("❌ getEmailsForUsers error:", err);
//     res.status(500).json({
//       success: false,
//       message: "Server error while fetching parent emails",
//     });
//   }
// };

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
//     const { emailId } = req.params;

//     if (!emailId) {
//       return res.status(400).json({
//         success: false,
//         message: 'Email ID is required',
//       });
//     }

//     if (!mongoose.Types.ObjectId.isValid(emailId)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid email ID format',
//       });
//     }

//     // 1️⃣ Get the email
//     const email = await EmailModel.findById(emailId)
//       .populate('userId', 'name email')
//       .populate('templateId');

//     if (!email) {
//       return res.status(404).json({
//         success: false,
//         message: 'Email not found',
//       });
//     }

//     // 2️⃣ Find root (walk up till no parent)
//     let rootEmail = email;
//     while (rootEmail.parentEmailId) {
//       rootEmail = await EmailModel.findById(rootEmail.parentEmailId)
//         .populate('userId', 'name email')
//         .populate('templateId');
//     }

//     // 3️⃣ Recursive fetch children (root → all replies/forwards)
//     const fetchChildren = async (parentId) => {
//       const children = await EmailModel.find({ parentEmailId: parentId })
//         .populate('userId', 'name email')
//         .populate('templateId')
//         .lean();

//       for (let child of children) {
//         child.children = await fetchChildren(child._id);
//       }
//       return children;
//     };

//     const childrenChain = await fetchChildren(rootEmail._id);

//     // 4️⃣ Get automation statuses for current email
//     const statuses = await AutomationStatusModel.find({ emailId })
//       .populate('scenarioId', 'name description')
//       .lean();

//     // 5️⃣ Final response
//     res.status(200).json({
//       success: true,
//       data: {
//         rootEmail, // 👈 mailhook wali main parent
//         children: childrenChain, // 👈 saari responses
//         currentEmail: email, // 👈 jis id se query aayi thi
//         statuses,
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching email data:', error);
//     res.status(500).json({
//       success: false,
//       message: 'Server error while fetching email data',
//       error: error.message,
//     });
//   }
// };

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
