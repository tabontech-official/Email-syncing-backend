import mongoose from 'mongoose';
import assert from 'assert';
import dotenv from 'dotenv';
import Connect from './connection/connect.js';
import { EmailModel } from './Models/Email.js';
import { resolveAndAttachIncomingReply } from './utils/threadingHelper.js';

dotenv.config();

const runTests = async () => {
  console.log('🧪 Starting Data-Level Inbox Threading Architecture Test Suite...\n');

  try {
    await Connect();

    const testUserId = new mongoose.Types.ObjectId();
    const testCustomerEmail = `test.customer.${Date.now()}@example.com`;
    const testSupportEmail = 'support.team@example.com';
    const testSubject = 'Shopify Partner Inquiry - Custom Integration';

    // Helper to query conversation cards for test user
    const getConversations = async () => {
      const userEmails = await EmailModel.find({
        $or: [{ userId: testUserId }, { senderAddress: testCustomerEmail }, { recipientAddress: testCustomerEmail }],
      })
        .sort({ date: 1, createdAt: 1 })
        .lean();

      let rawRoots = userEmails.filter((email) => !email.parentEmailId);
      if (!rawRoots.length) rawRoots = userEmails;

      const uniqueRootMap = new Map();
      for (const email of rawRoots) {
        const rootKey = email.conversationId || (email.threadId ? `thread-${email.threadId}` : `id-${email._id}`);
        if (!uniqueRootMap.has(rootKey)) {
          uniqueRootMap.set(rootKey, email);
        }
      }

      const deduplicatedRoots = Array.from(uniqueRootMap.values());

      return deduplicatedRoots.map((root) => {
        const rootIdStr = root._id.toString();
        const convIdStr = root.conversationId || root.threadId;

        const messages = userEmails.filter((e) => {
          if (e._id.toString() === rootIdStr) return true;
          if (convIdStr && (e.conversationId === convIdStr || e.threadId === convIdStr)) return true;

          let curr = e;
          const visited = new Set();
          while (curr && curr.parentEmailId && !visited.has(curr._id.toString())) {
            visited.add(curr._id.toString());
            const pStr = curr.parentEmailId.toString();
            if (pStr === rootIdStr) return true;
            curr = userEmails.find((item) => item._id.toString() === pStr);
          }
          return false;
        });

        return {
          ...root,
          messages,
        };
      });
    };

    // Clean up previous test documents for this customer email if any
    await EmailModel.deleteMany({
      $or: [{ senderAddress: testCustomerEmail }, { recipientAddress: testCustomerEmail }],
    });

    // =========================================================================
    // STEP 1: Initial Outgoing / Root Email Created
    // =========================================================================
    console.log('📌 Test Case 1: Initial email sent & customer reply attaches to 1 conversation card');

    const rootMessageId = `<root-${Date.now()}@example.com>`;
    const providerThreadId = `thread-prov-${Date.now()}`;

    const rootEmail = await EmailModel.create({
      userId: testUserId,
      senderAddress: testSupportEmail,
      recipientAddress: testCustomerEmail,
      subject: testSubject,
      textBody: 'Hi there, thanks for reaching out. How can we help?',
      htmlBody: '<div>Hi there, thanks for reaching out. How can we help?</div>',
      direction: 'outgoing',
      rfcMessageId: rootMessageId,
      messageId: rootMessageId,
      providerThreadId: providerThreadId,
      threadId: providerThreadId,
      conversationId: providerThreadId,
      date: new Date(Date.now() - 100000),
      status: 'awaiting_customer_reply',
      awaitingReply: true,
    });

    rootEmail.rootEmailId = rootEmail._id;
    rootEmail.leadId = rootEmail._id;
    await rootEmail.save();

    // Customer sends 1st Reply
    const customerReply1MsgId = `<reply1-${Date.now()}@mail.gmail.com>`;
    const reply1Result = await resolveAndAttachIncomingReply({
      userId: testUserId,
      from: testCustomerEmail,
      to: testSupportEmail,
      subject: `Re: ${testSubject}`,
      body: 'Thanks for the quick reply! We need help with Shopify webhook sync.',
      emailId: customerReply1MsgId,
      inReplyTo: rootMessageId,
      references: [rootMessageId],
      providerThreadId: providerThreadId,
      date: new Date(Date.now() - 80000),
    });

    assert.strictEqual(reply1Result.matched, true, 'Customer reply 1 should match existing parent thread');
    assert.strictEqual(reply1Result.isDuplicate, false, 'Customer reply 1 is not duplicate');

    let convs = await getConversations();
    assert.strictEqual(convs.length, 1, 'Sent email followed by customer reply must produce exactly 1 conversation card');
    assert.strictEqual(convs[0].messages.length, 2, 'Conversation card should contain 2 messages (Root + Reply 1)');
    console.log('  ✅ Test Case 1 Passed: 1 conversation card produced with 2 messages.');

    // =========================================================================
    // STEP 2: Second Customer Reply
    // =========================================================================
    console.log('\n📌 Test Case 2: Second customer reply remains in same card');

    const customerReply2MsgId = `<reply2-${Date.now()}@mail.gmail.com>`;
    const reply2Result = await resolveAndAttachIncomingReply({
      userId: testUserId,
      from: testCustomerEmail,
      to: testSupportEmail,
      subject: `Re: ${testSubject}`,
      body: 'Also, can you share the pricing details?',
      emailId: customerReply2MsgId,
      inReplyTo: customerReply1MsgId,
      references: [rootMessageId, customerReply1MsgId],
      providerThreadId: providerThreadId,
      date: new Date(Date.now() - 60000),
    });

    assert.strictEqual(reply2Result.matched, true, 'Customer reply 2 should match existing thread');

    convs = await getConversations();
    assert.strictEqual(convs.length, 1, 'Second customer reply must remain in the same conversation card');
    assert.strictEqual(convs[0].messages.length, 3, 'Conversation card should now contain 3 messages');
    console.log('  ✅ Test Case 2 Passed: Second customer reply remains in same card.');

    // =========================================================================
    // STEP 3: Platform Reply from Support
    // =========================================================================
    console.log('\n📌 Test Case 3: Platform reply remains in same card & sets status = awaiting_customer_reply');

    const platformReplyMsgId = `<platform-reply-${Date.now()}@example.com>`;
    const platformReplyDoc = await EmailModel.create({
      userId: testUserId,
      senderAddress: testSupportEmail,
      recipientAddress: testCustomerEmail,
      subject: `Re: ${testSubject}`,
      textBody: 'Here is our pricing structure for Shopify integration.',
      htmlBody: '<div>Here is our pricing structure for Shopify integration.</div>',
      direction: 'outgoing',

      conversationId: rootEmail.conversationId,
      providerThreadId: providerThreadId,
      threadId: providerThreadId,
      rfcMessageId: platformReplyMsgId,
      messageId: platformReplyMsgId,
      rootEmailId: rootEmail._id,
      leadId: rootEmail._id,
      parentEmailId: reply2Result.email._id,

      inReplyTo: customerReply2MsgId,
      references: [rootMessageId, customerReply1MsgId, customerReply2MsgId],
      date: new Date(Date.now() - 40000),
      lastMessageAt: new Date(Date.now() - 40000),
      status: 'awaiting_customer_reply',
      awaitingReply: true,
    });

    // Update root metadata
    await EmailModel.findByIdAndUpdate(rootEmail._id, {
      lastMessageAt: new Date(Date.now() - 40000),
      lastMessagePreview: 'Here is our pricing structure for Shopify integration.',
      status: 'awaiting_customer_reply',
      awaitingReply: true,
      unreadCount: 0,
    });

    convs = await getConversations();
    assert.strictEqual(convs.length, 1, 'Platform reply must remain in the same conversation card');
    assert.strictEqual(convs[0].messages.length, 4, 'Conversation card should now contain 4 messages');

    const updatedRoot = await EmailModel.findById(rootEmail._id);
    assert.strictEqual(updatedRoot.status, 'awaiting_customer_reply', 'Status must be updated to awaiting_customer_reply');
    assert.strictEqual(updatedRoot.awaitingReply, true, 'awaitingReply must be true after platform reply');
    console.log('  ✅ Test Case 3 Passed: Platform reply remains in same card & updates status to awaiting_customer_reply.');

    // =========================================================================
    // STEP 4: Unrelated Email from Same Customer
    // =========================================================================
    console.log('\n📌 Test Case 4: Unrelated email from same customer creates a separate conversation');

    const unrelatedMsgId = `<unrelated-${Date.now()}@mail.gmail.com>`;
    const unrelatedProviderThreadId = `thread-unrelated-${Date.now()}`;
    const unrelatedResult = await resolveAndAttachIncomingReply({
      userId: testUserId,
      from: testCustomerEmail,
      to: testSupportEmail,
      subject: 'Billing Invoice Request for Last Month', // Unrelated subject, no reply headers
      body: 'Can you please send me the invoice copy for June?',
      emailId: unrelatedMsgId,
      inReplyTo: '',
      references: [],
      providerThreadId: unrelatedProviderThreadId,
      date: new Date(Date.now() - 20000),
    });

    assert.strictEqual(unrelatedResult.matched, false, 'Unrelated email without reply headers should not match existing thread');

    // Create the new root conversation for unrelated email
    const unrelatedRoot = await EmailModel.create({
      userId: testUserId,
      senderAddress: testCustomerEmail,
      recipientAddress: testSupportEmail,
      subject: 'Billing Invoice Request for Last Month',
      textBody: 'Can you please send me the invoice copy for June?',
      direction: 'incoming',
      rfcMessageId: unrelatedMsgId,
      messageId: unrelatedMsgId,
      providerThreadId: `thread-unrelated-${Date.now()}`,
      threadId: `thread-unrelated-${Date.now()}`,
      conversationId: `thread-unrelated-${Date.now()}`,
      date: new Date(Date.now() - 20000),
      status: 'new_lead',
    });
    unrelatedRoot.rootEmailId = unrelatedRoot._id;
    await unrelatedRoot.save();

    convs = await getConversations();
    assert.strictEqual(convs.length, 2, 'Unrelated email from same customer must create a separate conversation card');
    console.log('  ✅ Test Case 4 Passed: Unrelated email from same customer created a separate conversation card.');

    // =========================================================================
    // STEP 5: Idempotency & Duplicate Inbound Event
    // =========================================================================
    console.log('\n📌 Test Case 5: Duplicate inbound event does not create a duplicate message (Idempotency)');

    const dupResult = await resolveAndAttachIncomingReply({
      userId: testUserId,
      from: testCustomerEmail,
      to: testSupportEmail,
      subject: `Re: ${testSubject}`,
      body: 'Also, can you share the pricing details?',
      emailId: customerReply2MsgId, // Duplicate messageId
      inReplyTo: customerReply1MsgId,
      references: [rootMessageId, customerReply1MsgId],
      providerThreadId: providerThreadId,
      date: new Date(Date.now() - 60000),
    });

    assert.strictEqual(dupResult.isDuplicate, true, 'Duplicate inbound event must return isDuplicate: true');

    const allCustomerReply2Msgs = await EmailModel.find({ rfcMessageId: customerReply2MsgId });
    assert.strictEqual(allCustomerReply2Msgs.length, 1, 'Duplicate inbound event must not insert duplicate message into DB');
    console.log('  ✅ Test Case 5 Passed: Idempotent handling prevented duplicate message creation.');

    console.log('\n🎉 ALL 5 TEST CASES PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test Suite Failed with Error:', err);
    process.exit(1);
  }
};

runTests();
