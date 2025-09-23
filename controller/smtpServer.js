// smtpServer.js
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { authModel } from '../Models/auth.js';
import { EmailModel } from '../Models/Email.js';
import { TemplateModel } from '../Models/Template.js';
import multer from 'multer';

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
    const rawEmail = req.body.email || null;
    let parsed = {};

    if (rawEmail) {
      parsed = await simpleParser(rawEmail);
    } else {
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
      req.body.envelope?.to || req.body.to || headerRecipient;

    if (mailhookAddress.includes('<')) {
      mailhookAddress = mailhookAddress.split('<')[1].replace('>', '').trim();
    }

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

    console.log('📩 Full Parsed Email:', {
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
      htmlBody, // now should show parsed values
    });

    // ---------------- Find User by Mailhook ----------------
    const user = await authModel.findOne({ mailhook: mailhookAddress });
    if (!user) {
      console.warn('⚠️ No user found for mailhook:', mailhookAddress);
      return res.status(200).send('No matching user found');
    }

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
      extraFields, // ✅ store parsed fields
    });

    await emailDoc.save();
    console.log(`💾 Email saved with ID: ${emailDoc._id}`);

    res.status(200).send('Email processed and saved');
  } catch (err) {
    console.error('❌ Error in mailHookWebhook:', err);
    res.status(500).send('Error processing email');
  }
};
