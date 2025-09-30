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
  console.log('🔎 Checking condition:', condition, 'against email:', email);

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
  console.log('🔎 Checking template:', template._id);
  const result = template.conditions.every((cond) =>
    checkCondition(cond, email)
  );
  console.log(`📌 Template ${template._id} match result = ${result}`);
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
  const lines = text.split(/\r?\n/); // handle both \n and \r\n

  console.log('🔎 Raw lines:', lines);

  lines.forEach((line) => {
    console.log('➡️ Checking line:', line);

    // More flexible regex: allow spaces before colon, ignore trailing spaces
    const match = line.match(/^([\w\s]+)\s*:\s*(.+)$/);
    if (match) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
      const value = match[2].trim();
      fields[key] = value;

      console.log(`✅ Parsed field -> ${key}: ${value}`);
    }
  });

  console.log('📦 Final parsed fields:', fields);
  return fields;
}

// ---------------- Webhook ----------------

export const mailHookWebhook = async (req, res) => {
  try {
    console.log('========== 📩 Incoming Webhook ==========');
    console.log('🔎 Raw body:', JSON.stringify(req.body, null, 2));

    const rawEmail = req.body.email || null;
    let parsed = {};

    if (rawEmail) {
      console.log('📨 Parsing raw email via simpleParser...');
      parsed = await simpleParser(rawEmail);
    } else {
      console.log('📨 Using structured body...');
      parsed = {
        from: { value: [{ address: req.body.from, name: req.body.from }] },
        to: { value: [{ address: req.body.to, name: req.body.to }] },
        subject: req.body.subject,
        text: req.body.text,
        html: req.body.html,
      };
    }

    // ---------------- Sender ----------------
    const senderAddress = parsed.from?.value?.[0]?.address || '';
    const senderName = parsed.from?.value?.[0]?.name || '';
    const { firstName: senderFirstName, lastName: senderLastName } =
      splitName(senderName);

    // ---------------- Recipient / Mailhook ----------------
    const headerRecipient = parsed.to?.value?.[0]?.address || '';
    let mailhookAddress =
      req.body.envelope?.to ||
      (Array.isArray(req.body.to) ? req.body.to[0] : req.body.to) ||
      headerRecipient;

    console.log('📬 Raw Recipients:', req.body.to);
    console.log('📬 Envelope To:', req.body.envelope?.to);
    console.log('📬 Header Recipient:', headerRecipient);
    console.log('📬 Initial mailhookAddress:', mailhookAddress);

    // Agar array hai → brandfer domain wala prefer karo
    if (Array.isArray(req.body.to)) {
      const brandferAddress = req.body.to.find((a) =>
        a.includes('@mail.brandfer.com')
      );
      if (brandferAddress) {
        console.log('✅ Picked brandfer address:', brandferAddress);
        mailhookAddress = brandferAddress;
      }
    }

    // Clean up <...>
    if (mailhookAddress.includes('<')) {
      mailhookAddress = mailhookAddress.split('<')[1].replace('>', '').trim();
    }

    mailhookAddress = mailhookAddress.trim().toLowerCase();
    console.log('🎯 Final mailhookAddress:', mailhookAddress);

    const { firstName: recipientFirstName, lastName: recipientLastName } =
      splitName(mailhookAddress);

    // ---------------- Other Fields ----------------
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

    // ---------------- Gmail Forwarding Verification ----------------
    let verificationCode = null;
    let verificationUrl = null;
    if (subject.includes('Gmail Forwarding Confirmation')) {
      const codeMatch = textBody.match(/Confirmation code:\s*(\d+)/i);
      if (codeMatch) verificationCode = codeMatch[1];
      const urlMatch = textBody.match(
        /https:\/\/mail-settings\.google\.com\/mail\/vf-[\S]+/i
      );
      if (urlMatch) verificationUrl = urlMatch[0];
    }

    // ---------------- Extra Fields from Text ----------------
    const extraFields = parseKeyValuePairs(textBody);

    console.log('📦 Final Parsed Email Object:', {
      senderFirstName,
      senderLastName,
      senderAddress,
      recipientFirstName,
      recipientLastName,
      mailhookAddress,
      subject,
      cc,
      bcc,
      verificationCode,
      verificationUrl,
      extraFields,
      textBody,
      htmlBody,
    });

    // ---------------- Find User by Mailhook ----------------
    const user = await authModel.findOne({ mailhook: mailhookAddress });
    if (!user) {
      console.warn('⚠️ No user found for mailhook:', mailhookAddress);
      return res.status(200).send('No matching user found');
    }
    console.log('👤 User found:', user._id.toString(), user.email);

    // ---------------- Template Matching ----------------
    const templates = await TemplateModel.find({
      userId: user._id,
      active: true,
    });
    let matchedTemplate = null;
    for (const tpl of templates) {
      if (
        subject.includes(tpl.keyword) ||
        textBody.includes(tpl.keyword) ||
        htmlBody.includes(tpl.keyword)
      ) {
        matchedTemplate = tpl;
        break;
      }
    }
    console.log('📝 Matched Template:', matchedTemplate?._id || 'None');

    // ---------------- Save to DB ----------------
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
    console.log(`💾 Email saved with ID: ${emailDoc._id}`);

    // ---------------- Run Scenarios ----------------
    console.log('🚀 Executing scenarios...');
    await executeScenarios({
      userId: user._id,
      from: senderAddress, // customer email
      subject,
      body: textBody || htmlBody || '',
      emailId: emailDoc._id.toString(),
    });
    console.log('✅ Scenarios executed for:', senderAddress);

    res.status(200).send('Email processed and saved');
  } catch (err) {
    console.error('❌ Error in mailHookWebhook:', err);
    res.status(500).send('Error processing email');
  }
};

export const executeScenarios = async (emailData) => {
  try {
    console.log('========== 🚀 [executeScenarios] START ==========');
    console.log('📨 Incoming emailData:', JSON.stringify(emailData, null, 2));

    const { userId, from, subject, body, emailId } = emailData;

    console.log('🔍 Fetching scenarios for user:', userId);
    const scenarios = await scenarioModel.find({ userId });
    console.log(`✅ Found ${scenarios.length} scenarios for user ${userId}`);

    for (const scenario of scenarios) {
      console.log('-------------------------------------------------');
      console.log(
        `👉 Checking scenario: ${scenario._id} | Name: ${scenario.name} | Type: ${scenario.type}`
      );

      if (!scenario.routerBranches || scenario.routerBranches.length === 0) {
        console.log('⚠️ No router branches found in this scenario.');
        continue;
      }

      for (const branch of scenario.routerBranches) {
        console.log('-------------------------------------------------');
        console.log(`🔀 Checking branch: ${branch.id || branch._id}`);

        if (!branch.filter || !Array.isArray(branch.filter.conditions)) {
          console.log('⚠️ No filter conditions found, skipping this branch.');
          continue;
        }

        // --- Match branch conditions ---
        console.log(
          `🧪 Evaluating ${branch.filter.conditions.length} condition(s) for this branch...`
        );
        const matches = branch.filter.conditions.every((cond, idx) => {
          const fieldValue =
            cond.field === 'Body'
              ? (body || '').toLowerCase()
              : cond.field === 'Subject'
                ? (subject || '').toLowerCase()
                : '';
          const condValue = (cond.value || '').toLowerCase();
          console.log(
            `   ➡️ Condition[${idx}]: field=${cond.field}, operator=${cond.operator}, value="${cond.value}"`
          );
          console.log(
            `      ↳ FieldValue="${fieldValue}" | CondValue="${condValue}"`
          );

          if (cond.operator === 'Contains')
            return fieldValue.includes(condValue);
          if (cond.operator === 'Equal to') return fieldValue === condValue;
          return false;
        });

        if (!matches) {
          console.log('❌ Condition(s) NOT matched for branch:', branch.id);
          continue;
        }

        console.log('✅ Condition(s) MATCHED for branch:', branch.id);

        // --- Execute modules in order ---
        if (!branch.modules || branch.modules.length === 0) {
          console.log('⚠️ No modules found in this branch.');
          continue;
        }

        // 🟢 Create initial status
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
          console.log('-------------------------------------------------');
          console.log(
            `⚙️ Executing module [${i + 1}/${branch.modules.length}]:`
          );
          console.log(
            `   → ID: ${module.id} | Type: ${module.type} | Template: "${module.template}" | ConnID: ${module.connectionId}`
          );

          try {
            // ----- Delay -----
            if (
              module.type === 'Delay' ||
              (!module.type && module.app?.name === 'Delay')
            ) {
              console.log('⏳ Delay module detected...');
              const delayMs = convertToMs(module.delayValue, module.delayUnit);
              console.log(
                `⏱ Scheduling delay of ${module.delayValue} ${module.delayUnit} (${delayMs} ms)`
              );

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
                    console.log(
                      `🛒 [DelayScheduler] Shopify template resolution for delayed module: ${plain.id}`
                    );

                    let stepType = 'initial';
                    const lower = (plain.template || '').toLowerCase();
                    if (lower.includes('first')) stepType = 'first';
                    else if (lower.includes('second')) stepType = 'second';

                    // 2️⃣ Service detect karo
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

                    console.log(
                      `🔹 [DelayScheduler] Matched service: ${matchedService} | Step: ${stepType}`
                    );

                    // 3️⃣ DB se template lao
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

                    if (tpl) {
                      console.log(
                        `✅ [DelayScheduler] Shopify template loaded: ${tpl.name}`
                      );
                      templateContent = tpl.content;
                    } else {
                      console.log(
                        `⚠️ [DelayScheduler] No Shopify template found for ${matchedService} - ${stepType}`
                      );
                    }
                  }
                  plain.template = templateContent;
                }

                remainingModules.push(plain);
              }

              await DelayJobModel.create({
                userId,
                emailData,
                modulesLeft: remainingModules,
                scheduledAt: new Date(Date.now() + delayMs),
              });

              // 🟢 Update status for delay
              await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                $push: { completedModules: module.id || module._id },
                $set: {
                  pendingModules: remainingModules.map((m) => m.id || m._id),
                  status: 'partial',
                  lastExecutedAt: new Date(),
                },
              });

              console.log(
                `✅ Delay scheduled. ${remainingModules.length} module(s) saved for later`
              );
              break;
            }

            // ----- Send Email / Custom Email -----
            if (
              module.type === 'Send an Email' ||
              module.type === 'Custom Email'
            ) {
              console.log(
                '📧 Email module detected... Preparing email content'
              );

              let templateContent = module.template || 'Thanks for your email!';

              if (scenario.type && scenario.type.toLowerCase() === 'shopify') {
                console.log(
                  '🛒 Scenario type is Shopify → trying to pick correct template'
                );

                // 1️⃣ Determine step type from module template
                let stepType = 'initial';
                const lower = (module.template || '').toLowerCase();
                if (lower.includes('first')) stepType = 'first';
                else if (lower.includes('second')) stepType = 'second';
                console.log(`🔹 Detected step type: ${stepType}`);

                // 2️⃣ Detect service from email (case-insensitive)
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
                console.log(`🛍️ Matched service from email: ${matchedService}`);

                // 3️⃣ Fetch template (service + step) from DB
                console.log('🔎 Looking for Shopify template in DB...');
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

                if (tpl) {
                  console.log(`✅ Shopify template found: ${tpl.name}`);
                  templateContent = tpl.content;
                } else {
                  console.log(
                    `⚠️ No Shopify template found for ${matchedService} - ${stepType}`
                  );
                }
              }

              console.log('📨 Final email body to be sent:');
              console.log('--------------------------------');
              console.log(templateContent);
              console.log('--------------------------------');

              const plainModule = module.toObject ? module.toObject() : module;
              await sendEmailModule(
                { ...plainModule, template: templateContent },
                from,
                subject
              );

              // 🟢 Update status after sending email
              await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
                $push: { completedModules: module.id || module._id },
                $pull: { pendingModules: module.id || module._id },
                $set: { lastExecutedAt: new Date() },
              });
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

        // 🟢 Mark completed at the end
        await AutomationStatusModel.findByIdAndUpdate(statusDoc._id, {
          $set: {
            status: 'completed',
            pendingModules: [],
            lastExecutedAt: new Date(),
          },
        });
      }
    }

    console.log('✅✅ [executeScenarios] COMPLETED successfully.');
    console.log('========== 🚀 [executeScenarios] END ==========');
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

// export const sendEmailModule = async (module, to, originalSubject) => {
//   const connection = await ConnectionModel.findById(module.connectionId);
//   if (!connection) {
//     return;
//   }

//   const finalSubject =
//     module.subject && module.subject.trim() !== ''
//       ? module.subject
//       : `Re: ${originalSubject || 'No Subject'}`;

//   if (connection.provider === 'gmail') {
//     try {
//       const oauth2Client = new google.auth.OAuth2(
//         process.env.GOOGLE_CLIENT_ID,
//         process.env.GOOGLE_CLIENT_SECRET,
//         process.env.GOOGLE_REDIRECT_URI
//       );
//       oauth2Client.setCredentials(connection.tokens);

//       const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

//       const rawMessage = [
//         `From: ${connection.email}`,
//         `To: ${to}`,
//         `Subject: ${finalSubject}`,
//         'Content-Type: text/html; charset=UTF-8',
//         '',
//         module.template || 'Thanks for your email!',
//       ]
//         .join('\n')
//         .trim();

//       const encodedMessage = Buffer.from(rawMessage)
//         .toString('base64')
//         .replace(/\+/g, '-')
//         .replace(/\//g, '_')
//         .replace(/=+$/, '');

//       await gmail.users.messages.send({
//         userId: 'me',
//         requestBody: { raw: encodedMessage },
//       });

//       console.log(
//         `📤 Gmail: Email sent to ${to} via ${connection.email} | subject: "${finalSubject}"`
//       );
//     } catch (err) {
//       console.error('❌ Gmail send error:', err);
//     }
//   } else if (connection.provider === 'outlook') {
//     try {
//       const transporter = nodemailer.createTransport({
//         host: connection.smtp?.host || 'smtp.office365.com',
//         port: connection.smtp?.port || 587,
//         secure: connection.smtp?.port === 465,
//         auth: {
//           user: connection.smtp?.username || connection.email,
//           pass: connection.smtp?.password,
//         },
//       });

//       await transporter.sendMail({
//         from: connection.email,
//         to,
//         subject: finalSubject,
//         html: module.template || 'Thanks for your email!',
//       });

//       console.log(
//         `Outlook/SMTP: Email sent to ${to} via ${connection.email} | subject: "${finalSubject}"`
//       );
//     } catch (err) {
//       console.error(' Outlook/SMTP send error:', err);
//     }
//   } else if (connection.provider === 'smtp') {
//     try {
//       const transporter = nodemailer.createTransport({
//         host: connection.smtpHost || connection.smtp?.host,
//         port: connection.smtpPort || connection.smtp?.port || 587,
//         secure: (connection.smtpPort || connection.smtp?.port) === 465,
//         auth: {
//           user:
//             connection.smtpUser ||
//             connection.smtp?.username ||
//             connection.email,
//           pass: connection.smtpPass || connection.smtp?.password,
//         },
//       });

//       await transporter.sendMail({
//         from: connection.email,
//         to,
//         subject: finalSubject,
//         html: module.template || 'Thanks for your email!',
//       });

//       console.log(
//         `📤 SMTP: Email sent to ${to} via ${connection.email} | subject: "${finalSubject}"`
//       );
//     } catch (err) {
//       console.error('❌ SMTP send error:', err);
//     }
//   } else {
//     console.warn(' Unsupported provider:', connection.provider);
//   }
// };

export const sendEmailModule = async (module, to, originalSubject) => {
  console.log('📨 [sendEmailModule] START', {
    moduleId: module?.id,
    connectionId: module?.connectionId,
    to,
    originalSubject,
  });

  const connection = await ConnectionModel.findById(module.connectionId);
  if (!connection) {
    console.warn(
      '⚠️ [sendEmailModule] No connection found for module:',
      module?.id
    );
    return;
  }

  const norm = (v) =>
    Array.isArray(v)
      ? v.filter(Boolean).join(', ')
      : (v || '').toString().trim();

  const cc = norm(module.cc);
  const bcc = norm(module.bcc);

  const finalSubject =
    module.subject && module.subject.trim() !== ''
      ? module.subject
      : `Re: ${originalSubject || 'No Subject'}`;

  const emailBody = module.template || 'Thanks for your email!';

  console.log('✉️ [Email Details]', {
    from: connection.email,
    to,
    cc,
    bcc,
    subject: finalSubject,
    preview: emailBody.slice(0, 100) + (emailBody.length > 100 ? '...' : ''),
  });

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

      console.log('📦 [GMAIL] Encoded message length:', encodedMessage.length);

      const result = await gmail.users.messages.send({
        userId: 'me',
        requestBody: { raw: encodedMessage },
      });

      console.log(
        ` [GMAIL] Email sent | to: ${to} | cc: ${cc || '-'} | bcc: ${bcc || '-'} | subject: "${finalSubject}" | Gmail-Id: ${result?.data?.id}`
      );
    } catch (err) {
      console.error('❌ [GMAIL] send error:', err?.response?.data || err);
    }
  } else if (
    connection.provider === 'outlook' ||
    connection.provider === 'smtp'
  ) {
    try {
      const isOutlook = connection.provider === 'outlook';
      console.log(
        `🚀 [${isOutlook ? 'OUTLOOK' : 'SMTP'}] Creating transporter...`
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

      const info = await transporter.sendMail({
        from: connection.email,
        to,
        cc: cc || undefined,
        bcc: bcc || undefined,
        subject: finalSubject,
        html: emailBody,
      });

      console.log(
        `✅ [${isOutlook ? 'OUTLOOK' : 'SMTP'}] Email sent | to: ${to} | cc: ${cc || '-'} | bcc: ${bcc || '-'} | subject: "${finalSubject}" | MessageId: ${info.messageId}`
      );
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

  console.log('🏁 [sendEmailModule] END\n');
};



export const getEmailsForUsers=async(req,res)=>{
   try {
    const { userId } = req.params;

    console.log(`📩 Fetching all emails + status for user=${userId}`);

    // 1) Get all emails of this user
    const emails = await EmailModel.find({ userId })
      .sort({ date: -1 }) // latest first
      .lean();

    if (!emails || emails.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No emails found for this user",
      });
    }

    // 2) Get all automation statuses linked to those emails
    const emailIds = emails.map((e) => e._id.toString());
    const statuses = await AutomationStatusModel.find({
      userId,
      emailId: { $in: emailIds },
    })
      .populate("scenarioId", "name type")
      .lean();

    // 3) Merge statuses into emails
    const statusMap = {};
    statuses.forEach((s) => {
      if (!statusMap[s.emailId]) statusMap[s.emailId] = [];
      statusMap[s.emailId].push(s);
    });

    const result = emails.map((email) => ({
      ...email,
      statuses: statusMap[email._id.toString()] || [],
    }));

    return res.json({
      success: true,
      totalEmails: emails.length,
      data: result,
    });
  } catch (err) {
    console.error("❌ Error fetching user emails + status:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching emails",
    });
  }
}