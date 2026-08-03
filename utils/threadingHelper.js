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
  const now = new Date(emailData.date || Date.now());

  // 0. IDEMPOTENCY DEDUPLICATION CHECK: Check if message with this ID or identical content exists
  if (incomingMsgId) {
    const existing = await EmailModel.findOne({
      $or: [
        { rfcMessageId: emailData.emailId },
        { rfcMessageId: incomingMsgId },
        { rfcMessageId: `<${incomingMsgId}>` },
        { messageId: emailData.emailId },
        { messageId: incomingMsgId },
        { messageId: `<${incomingMsgId}>` },
      ],
    });

    if (existing) {
      console.log(`⚠️ Duplicate incoming email skipped [Message-ID: ${incomingMsgId}]`);
      let root = existing;
      while (root.parentEmailId) {
        const p = await EmailModel.findById(root.parentEmailId);
        if (!p) break;
        root = p;
      }
      await EmailModel.findByIdAndUpdate(root._id, { lastMessageAt: now, lastActivityAt: now });
      console.log('=======================================\n');
      return { matched: false, isDuplicate: true, email: existing };
    }
  }

  // Body content deduplication within 10-second window
  const fromEmail = extractEmailAddress(emailData.from)?.toLowerCase();
  const rawBodyText = (emailData.body || emailData.html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 150);

  if (fromEmail && rawBodyText) {
    const tenSecondsAgo = new Date(now.getTime() - 10000);
    const existingContent = await EmailModel.findOne({
      senderAddress: new RegExp(fromEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i'),
      direction: 'incoming',
      createdAt: { $gte: tenSecondsAgo },
    });

    if (existingContent) {
      const existingSnippet = (existingContent.textBody || existingContent.htmlBody || '')
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, 150);

      if (existingSnippet === rawBodyText) {
        console.log(`⚠️ Duplicate inbound content event skipped for: ${fromEmail}`);
        return { matched: false, isDuplicate: true, email: existingContent };
      }
    }
  }

  const userObjId = mongoose.Types.ObjectId.isValid(userId)
    ? new mongoose.Types.ObjectId(userId)
    : userId;

  const userCriteria = userId
    ? [{ userId: userId }, { userId: userObjId }]
    : null;

  const buildQuery = (matchCondition) => {
    if (!userCriteria) return matchCondition;
    return {
      $and: [matchCondition, { $or: userCriteria }],
    };
  };

  const rawRefs = Array.isArray(emailData.references)
    ? emailData.references
    : typeof emailData.references === 'string'
    ? [emailData.references]
    : [];

  const refsClean = rawRefs.map((r) => cleanMessageId(r)).filter(Boolean);
  const inReplyToClean = cleanMessageId(emailData.inReplyTo);
  const incomingProviderThreadId = emailData.providerThreadId || emailData.threadId || null;

  let parentEmail = null;

  // -------------------------------------------------------------------------
  // STAGE 1: providerThreadId Priority
  // -------------------------------------------------------------------------
  if (!parentEmail && incomingProviderThreadId) {
    const threadCond = {
      $or: [{ providerThreadId: incomingProviderThreadId }, { threadId: incomingProviderThreadId }],
    };

    parentEmail = await EmailModel.findOne(buildQuery(threadCond)).sort({ createdAt: -1 });

    if (!parentEmail && userId) {
      parentEmail = await EmailModel.findOne(threadCond).sort({ createdAt: -1 });
    }
    if (parentEmail) console.log('  🎯 Matched via Stage 1 (providerThreadId)');
  }

  // -------------------------------------------------------------------------
  // STAGE 2: In-Reply-To matching stored rfcMessageId Priority
  // -------------------------------------------------------------------------
  if (!parentEmail && inReplyToClean) {
    const inReplyToVariants = [
      emailData.inReplyTo,
      inReplyToClean,
      `<${inReplyToClean}>`,
    ].filter(Boolean);

    const inReplyToCond = {
      $or: [
        { rfcMessageId: { $in: inReplyToVariants } },
        { messageId: { $in: inReplyToVariants } },
        { rfcMessageId: new RegExp(inReplyToClean.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i') },
        { messageId: new RegExp(inReplyToClean.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i') },
      ],
    };

    parentEmail = await EmailModel.findOne(buildQuery(inReplyToCond)).sort({ createdAt: -1 });

    if (!parentEmail && userId) {
      parentEmail = await EmailModel.findOne(inReplyToCond).sort({ createdAt: -1 });
    }
    if (parentEmail) console.log('  🎯 Matched via Stage 2 (In-Reply-To)');
  }

  // -------------------------------------------------------------------------
  // STAGE 3: any References value matching stored rfcMessageId Priority
  // -------------------------------------------------------------------------
  if (!parentEmail && refsClean.length > 0) {
    const refVariants = refsClean.flatMap((c) => [c, `<${c}>`]);
    const refCond = {
      $or: [{ rfcMessageId: { $in: refVariants } }, { messageId: { $in: refVariants } }],
    };

    parentEmail = await EmailModel.findOne(buildQuery(refCond)).sort({ createdAt: -1 });

    if (!parentEmail && userId) {
      parentEmail = await EmailModel.findOne(refCond).sort({ createdAt: -1 });
    }
    if (parentEmail) console.log('  🎯 Matched via Stage 3 (References)');
  }

  // -------------------------------------------------------------------------
  // STAGE 4: provider message ID Priority
  // -------------------------------------------------------------------------
  if (!parentEmail && incomingMsgId) {
    const msgIdVariants = [emailData.emailId, emailData.messageId, incomingMsgId, `<${incomingMsgId}>`].filter(Boolean);
    const msgIdCond = {
      $or: [{ rfcMessageId: { $in: msgIdVariants } }, { messageId: { $in: msgIdVariants } }],
    };

    parentEmail = await EmailModel.findOne(buildQuery(msgIdCond)).sort({ createdAt: -1 });

    if (!parentEmail && userId) {
      parentEmail = await EmailModel.findOne(msgIdCond).sort({ createdAt: -1 });
    }
    if (parentEmail) console.log('  🎯 Matched via Stage 4 (provider message ID)');
  }

  // -------------------------------------------------------------------------
  // STAGE 5: Controlled Subject + Mailbox + Participant Fallback Priority
  // -------------------------------------------------------------------------
  const cleanSubj = (emailData.subject || '')
    .replace(/^((re|fwd|fw|\[external\]):\s*)+/i, '')
    .trim()
    .toLowerCase();

  const isExplicitReplyHeader = /^((re|fwd|fw):\s*)/i.test((emailData.subject || '').trim());

  if (!parentEmail && fromEmail && cleanSubj && (isExplicitReplyHeader || emailData.inReplyTo)) {
    const escapedSubj = cleanSubj.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    console.log(`🔍 Stage 5 Controlled Subject search for reply: "${cleanSubj}" email: "${fromEmail}"`);

    const subjCond = {
      $or: [
        { senderAddress: new RegExp(fromEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i') },
        { recipientAddress: new RegExp(fromEmail.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&'), 'i') },
      ],
      subject: new RegExp(escapedSubj, 'i'),
    };

    parentEmail = await EmailModel.findOne(buildQuery(subjCond)).sort({ createdAt: -1 });
    if (parentEmail) console.log('  🎯 Matched via Stage 5 (Controlled Subject)');
  }

  if (!parentEmail) {
    console.log('ℹ️ No parent thread matched. Treating as NEW CONVERSATION.');
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

  console.log(`🌱 Ultimate Root Conversation Email [ID: ${ultimateRoot._id}]`);

  // Reuse leadId, conversationId, rootEmailId, providerThreadId
  const effectiveConversationId =
    parentEmail.conversationId ||
    ultimateRoot.conversationId ||
    ultimateRoot.providerThreadId ||
    ultimateRoot.threadId ||
    ultimateRoot._id.toString();

  const effectiveProviderThreadId =
    incomingProviderThreadId ||
    parentEmail.providerThreadId ||
    ultimateRoot.providerThreadId ||
    ultimateRoot.threadId ||
    ultimateRoot._id.toString();

  const effectiveLeadId =
    parentEmail.leadId ||
    ultimateRoot.leadId ||
    ultimateRoot._id;

  const effectiveRootEmailId = ultimateRoot._id;

  // Ensure ultimate root has conversationId & providerThreadId set
  await EmailModel.findByIdAndUpdate(ultimateRoot._id, {
    conversationId: effectiveConversationId,
    providerThreadId: effectiveProviderThreadId,
    threadId: effectiveProviderThreadId,
    leadId: effectiveLeadId,
  });

  const parentRefChain = Array.isArray(parentEmail.references) ? parentEmail.references : [];
  const parentMsgId = parentEmail.rfcMessageId || parentEmail.messageId ? [parentEmail.rfcMessageId || parentEmail.messageId] : [];
  const newReferences = Array.from(new Set([...parentRefChain, ...parentMsgId].filter(Boolean)));

  const textBodyPreview = (emailData.body || emailData.html || '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 150);

  const targetUserId =
    parentEmail.userId?._id ||
    parentEmail.userId ||
    ultimateRoot.userId?._id ||
    ultimateRoot.userId ||
    userId;

  const targetConnectionId =
    emailData.connectionId ||
    parentEmail.connectionId ||
    ultimateRoot.connectionId ||
    null;

  const formattedMsgId = formatMessageId(emailData.emailId || emailData.messageId || `msg-${Date.now()}`);

  const newReply = await EmailModel.create({
    userId: targetUserId,
    connectionId: targetConnectionId,
    senderAddress: emailData.from,
    recipientAddress: emailData.to,
    subject: emailData.subject,
    textBody: emailData.body,
    htmlBody: emailData.html || '',
    date: now,
    direction: 'incoming',

    // Explicit Conversation Identifiers
    conversationId: effectiveConversationId,
    providerThreadId: effectiveProviderThreadId,
    threadId: effectiveProviderThreadId,
    rootEmailId: effectiveRootEmailId,
    leadId: effectiveLeadId,
    parentEmailId: parentEmail._id,

    rfcMessageId: formattedMsgId,
    messageId: formattedMsgId,
    inReplyTo: parentEmail.rfcMessageId || parentEmail.messageId || emailData.inReplyTo || '',
    references: newReferences,
    attachments: emailData.attachments || [],
    notes: emailData.notes || 'Customer reply attached to root conversation',
    lastMessageAt: now,
    lastActivityAt: now,
    lastMessagePreview: textBodyPreview,
    status: 'customer_replied',
    awaitingReply: false,
  });

  // Update existing conversation metadata on root email document
  const updatedMessageCount = (ultimateRoot.messageCount || 1) + 1;
  const updatedUnreadCount = (ultimateRoot.unreadCount || 0) + 1;

  await EmailModel.findByIdAndUpdate(ultimateRoot._id, {
    lastMessageAt: now,
    lastActivityAt: now,
    lastMessagePreview: textBodyPreview,
    messageCount: updatedMessageCount,
    unreadCount: updatedUnreadCount,
    status: 'customer_replied',
    awaitingReply: false,
  });

  console.log('🎉 SUCCESS: Customer reply saved in DB and conversation updated!');
  console.log(`  💾 New Reply ID: ${newReply._id}`);
  console.log(`  🔗 Linked to Conversation ID: ${effectiveConversationId} | Root ID: ${ultimateRoot._id}`);
  console.log('=======================================\n');

  return { matched: true, isDuplicate: false, email: newReply, rootEmail: ultimateRoot };
};
