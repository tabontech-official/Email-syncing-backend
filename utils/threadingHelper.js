import mongoose from 'mongoose';
import { EmailModel } from '../Models/Email.js';

export const cleanMessageId = (str = '') => {
  if (!str) return '';
  return String(str).replace(/^<|>$/g, '').trim();
};

export const formatMessageId = (id) => {
  if (!id) return undefined;
  const clean = cleanMessageId(id);
  if (!clean || clean.startsWith('disc-') || clean.startsWith('reply-') || clean.startsWith('custom-test-')) {
    return undefined;
  }
  return `<${clean}>`;
};

export const normalizeSubject = (subject = '') => {
  if (!subject) return 'Re: Lead Inquiry';
  const clean = String(subject).replace(/^((re|fwd):\s*)+/i, '').trim();
  return clean ? `Re: ${clean}` : 'Re: Lead Inquiry';
};

export const formatReferencesHeader = (parentMsgId, parentEmailDoc = null) => {
  const refs = [];
  if (parentEmailDoc?.references && Array.isArray(parentEmailDoc.references)) {
    parentEmailDoc.references.forEach((r) => {
      const formatted = formatMessageId(r);
      if (formatted && !refs.includes(formatted)) refs.push(formatted);
    });
  }
  const formattedParent = formatMessageId(parentMsgId || parentEmailDoc?.messageId);
  if (formattedParent && !refs.includes(formattedParent)) {
    refs.push(formattedParent);
  }
  return refs.length > 0 ? refs : undefined;
};

const extractEmailAddress = (value = '') => {
  if (!value) return '';
  const match = String(value).match(/<(.+?)>/);
  return (match ? match[1] : String(value)).trim().toLowerCase();
};

export const resolveAndAttachIncomingReply = async (emailData) => {
  console.log('\n=======================================');
  console.log('🔍 [resolveAndAttachIncomingReply] Resolving email thread...');
  console.log('📩 From:', emailData.from);
  console.log('📩 To:', emailData.to);
  console.log('📩 Subject:', emailData.subject);
  console.log('📩 messageId:', emailData.emailId || emailData.messageId || 'none');
  console.log('📩 inReplyTo:', emailData.inReplyTo || 'none');

  const { userId } = emailData;
  const incomingMsgId = cleanMessageId(emailData.emailId || emailData.messageId);

  // 1. DEDUPLICATION CHECK: Check if email with this messageId already exists
  if (incomingMsgId) {
    const existing = await EmailModel.findOne({
      $or: [
        { messageId: emailData.emailId },
        { messageId: incomingMsgId },
        { messageId: `<${incomingMsgId}>` },
      ],
    });

    if (existing) {
      console.log(`⚠️ Duplicate incoming email skipped [Message-ID: ${incomingMsgId}]`);
      
      // Update lastActivityAt on ultimate root if exists
      let root = existing;
      while (root.parentEmailId) {
        const p = await EmailModel.findById(root.parentEmailId);
        if (!p) break;
        root = p;
      }
      const now = new Date();
      await EmailModel.findByIdAndUpdate(root._id, { lastActivityAt: now });
      console.log('=======================================\n');
      return { matched: true, isDuplicate: true, email: existing };
    }
  }

  const userObjId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const rawRefs = Array.isArray(emailData.references)
    ? emailData.references
    : typeof emailData.references === 'string'
    ? [emailData.references]
    : [];

  const refsClean = rawRefs.map(r => cleanMessageId(r)).filter(Boolean);

  let parentEmail = null;

  // 2. Primary Match: In-Reply-To
  const inReplyToClean = cleanMessageId(emailData.inReplyTo);
  if (inReplyToClean) {
    parentEmail = await EmailModel.findOne({
      $or: [
        { messageId: emailData.inReplyTo },
        { messageId: inReplyToClean },
        { messageId: `<${inReplyToClean}>` },
      ],
      ...(userId ? { $or: [{ userId: userId }, { userId: userObjId }] } : {}),
    }).sort({ createdAt: -1 });
  }

  // 3. Secondary Match: References
  if (!parentEmail && refsClean.length > 0) {
    const refVariants = refsClean.flatMap(c => [c, `<${c}>`]);
    parentEmail = await EmailModel.findOne({
      messageId: { $in: refVariants },
      ...(userId ? { $or: [{ userId: userId }, { userId: userObjId }] } : {}),
    }).sort({ createdAt: -1 });
  }

  // 4. Tertiary Match: threadId
  if (!parentEmail && emailData.threadId) {
    parentEmail = await EmailModel.findOne({
      threadId: emailData.threadId,
      ...(userId ? { $or: [{ userId: userId }, { userId: userObjId }] } : {}),
    }).sort({ createdAt: -1 });
  }

  // 5. Fallback Match: Subject + Sender email
  const isReSubject = /^re:\s*|^fwd:\s*/i.test((emailData.subject || '').trim());
  const cleanSubj = (emailData.subject || '').replace(/^re:\s*|^fwd:\s*/i, '').trim().toLowerCase();
  const fromEmail = extractEmailAddress(emailData.from)?.toLowerCase();

  if (!parentEmail && fromEmail) {
    if (cleanSubj) {
      const escapedSubj = cleanSubj.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      console.log(`🔍 Fallback subject search for: "${cleanSubj}" email: "${fromEmail}"`);
      parentEmail = await EmailModel.findOne({
        $or: [
          { senderAddress: new RegExp(fromEmail, 'i') },
          { recipientAddress: new RegExp(fromEmail, 'i') },
        ],
        subject: new RegExp(escapedSubj, 'i'),
        ...(userId ? { $or: [{ userId: userId }, { userId: userObjId }] } : {}),
      }).sort({ createdAt: -1 });
    }

    // 6. Last Resort Match: Customer Email Address (ONLY if customer has exactly ONE active thread)
    if (!parentEmail) {
      console.log(`🔍 Fallback customer email thread search for: "${fromEmail}"`);
      const customerThreads = await EmailModel.find({
        $or: [
          { senderAddress: new RegExp(fromEmail, 'i') },
          { recipientAddress: new RegExp(fromEmail, 'i') },
        ],
        $or: [{ parentEmailId: null }, { parentEmailId: { $exists: false } }],
        ...(userId ? { $or: [{ userId: userId }, { userId: userObjId }] } : {}),
      }).sort({ createdAt: -1 });

      if (customerThreads.length === 1) {
        parentEmail = customerThreads[0];
      } else {
        console.log(`ℹ️ Customer has ${customerThreads.length} root threads. Skipping ambiguous email-only fallback to prevent cross-thread bleeding.`);
      }
    }
  }

  if (!parentEmail) {
    console.log('ℹ️ No parent thread matched. Treating as NEW LEAD.');
    console.log('=======================================\n');
    return { matched: false };
  }

  console.log(`📍 Matched Parent Email [ID: ${parentEmail._id}] Subject: "${parentEmail.subject}"`);

  // Trace back to ultimate root email
  let ultimateRoot = parentEmail;
  while (ultimateRoot.parentEmailId) {
    const p = await EmailModel.findById(ultimateRoot.parentEmailId);
    if (!p) break;
    ultimateRoot = p;
  }

  console.log(`🌱 Ultimate Root Lead Email [ID: ${ultimateRoot._id}]`);

  const effectiveThreadId = ultimateRoot.threadId || ultimateRoot._id.toString();

  // Ensure ultimate root has threadId set
  if (!ultimateRoot.threadId) {
    await EmailModel.findByIdAndUpdate(ultimateRoot._id, { threadId: effectiveThreadId });
    ultimateRoot.threadId = effectiveThreadId;
  }

  const now = new Date();
  const parentRefChain = Array.isArray(parentEmail.references) ? parentEmail.references : [];
  const parentMsgId = parentEmail.messageId ? [parentEmail.messageId] : [];
  const newReferences = Array.from(new Set([...parentRefChain, ...parentMsgId].filter(Boolean)));

  const newReply = await EmailModel.create({
    userId: parentEmail.userId || userId,
    connectionId: emailData.connectionId || parentEmail.connectionId || null,
    senderAddress: emailData.from,
    recipientAddress: emailData.to,
    subject: emailData.subject,
    textBody: emailData.body,
    htmlBody: emailData.html || '',
    date: emailData.date || now,
    direction: 'incoming',
    threadId: effectiveThreadId,
    parentEmailId: parentEmail._id, // Set directly related parent
    messageId: emailData.emailId || emailData.messageId || '',
    inReplyTo: parentEmail.messageId || emailData.inReplyTo || '',
    references: newReferences,
    attachments: emailData.attachments || [],
    notes: emailData.notes || 'Customer reply attached to root lead thread',
    lastActivityAt: now,
  });

  // Update root email's lastActivityAt
  await EmailModel.findByIdAndUpdate(ultimateRoot._id, { lastActivityAt: now });

  console.log('🎉 SUCCESS: Customer reply saved in DB and thread updated!');
  console.log(`  💾 New Reply ID: ${newReply._id}`);
  console.log(`  🔗 Linked to Parent ID: ${parentEmail._id} | Root Thread ID: ${ultimateRoot._id}`);
  console.log('=======================================\n');

  return { matched: true, isDuplicate: false, email: newReply, rootEmail: ultimateRoot };
};
