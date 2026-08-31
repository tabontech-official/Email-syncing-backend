import mongoose from 'mongoose';
import { type } from 'os';

const emailSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Template',
      default: null,
    },
    senderFirstName: String,
    senderLastName: String,
    senderAddress: String,
    recipientFirstName: String,
    recipientLastName: String,
    recipientAddress: String,
    subject: String,
    textBody: String,
    htmlBody: String,
    cc: [String],
    /*
     * Which mail provider delivered this message. Copied from
     * connection.provider, so the enum mirrors that field exactly — a
     * narrower list here would throw a ValidationError on save and lose
     * the email.
     *
     * Distinct from  below, which is a BUSINESS category
     * (Troubleshooting, General, SEO...). Provider values must never be
     * written into service.
     */
    provider: {
      type: String,
      enum: ['gmail', 'microsoft', 'microsoft-oauth', 'smtp', 'outlook'],
    },

    /* Business service category — NOT a mail provider. */
    service: {
      type: String,
    },
    stepType: {
      type: String,
    },
    bcc: [String],
    date: Date,
    messageId: String,
    inReplyTo: String,
    references: [String],
    attachments: [
      {
        filename: String,
        contentType: String,
        size: Number,
      },
    ],
    //     parentEmailId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: "Email",
    //   default: null
    // },
    isValidateTestEmail: {
      type: Boolean,
    },
    parentEmailId: {
      type: mongoose.Schema.Types.Mixed, // allows ObjectId OR string
      default: null,
    },
    isForwarded: { type: Boolean, default: false },
    forwardedMeta: {
      from: { type: String, default: null },
      to: { type: String, default: null },
      subject: { type: String, default: null },
      date: { type: String, default: null },
      body: { type: String, default: null }, // full forwarded block
    },
    isTestEmail: Boolean,
    /*
     * Which scenario's criteria this message met when it arrived. Stamped
     * by executeScenarios(); the Lead Inbox uses it so a message that
     * qualified once stays visible even if the scenario is later edited
     * or removed. Null means "did not qualify at receive time", NOT
     * "never a lead" — mail that predates a scenario is re-evaluated
     * against the current rules when the inbox is built.
     */
    matchedScenarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scenario',
      default: null,
      index: true,
    },
    scenarioExecuted: { type: Boolean, default: false },
    /*
     * Held back because the scenario that claimed this lead was switched
     * Off when it arrived.
     *
     * Switching a scenario Off stops replies going out, but the leads
     * themselves keep arriving and keep landing in the Lead Inbox. Without
     * this field there was no record of which of them the automation would
     * have answered, so turning the scenario back on silently answered
     * nothing: the backlog just sat there looking handled.
     *
     * The scenario id is stored rather than a bare flag because a message
     * can meet one scenario's criteria while another, unrelated scenario
     * is the one that was paused. Releasing a queue must replay only the
     * scenario it was queued for.
     *
     * Cleared both ways out: released (the reply is sent) and discarded
     * (the user decided the backlog is stale). Either way the email itself
     * stays — it is still a lead, and still belongs in the inbox.
     */
    queuedForScenarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Scenario',
      default: null,
      index: true,
    },
    queuedAt: { type: Date, default: null },
    verificationCode: { type: String, default: null },
    verificationUrl: { type: String, default: null },
    extraFields: { type: Object, default: {} },
    threadId: {
      type: String,
      default: null,
      index: true,
    },

    direction: {
      type: String,
      enum: ['incoming', 'outgoing'],
      default: 'incoming',
      index: true,
    },
    leadStatus: {
  type: String,
  enum: ['new_lead', 'secured', 'closed'],
  default: 'new_lead',
  index: true,
},
connectionId: {
  type: mongoose.Schema.Types.ObjectId,
  default: null,
  index: true,
},
discussion: [
  {
    message: { type: String, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
],

isDeleted: {
  type: Boolean,
  default: false,
  index: true,
},

/*
 * Filed away, not deleted and not a lead status.
 *
 * Archiving used to be written as leadStatus: 'archived', which the
 * status endpoint rejects as invalid and the schema enum does not
 * contain — the bulk "Archived" button optimistically greyed the row
 * out and the server threw it away. It is its own flag now, so a lead
 * can be archived AND still be secured or closed, which is how every
 * mail client behaves.
 */
isArchived: {
  type: Boolean,
  default: false,
  index: true,
},

    scenarioRunLogId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ScenarioRunLog',
      default: null,
    },
    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    // Conversation Data Fields
    conversationId: { type: String, default: null, index: true },
    providerThreadId: { type: String, default: null, index: true },
    rfcMessageId: { type: String, default: null, index: true },
    rootEmailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email', default: null, index: true },
    leadId: { type: mongoose.Schema.Types.Mixed, default: null, index: true },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, default: '' },
    unreadCount: { type: Number, default: 0 },
    messageCount: { type: Number, default: 1 },
    status: {
      type: String,
      enum: ['new_lead', 'customer_replied', 'awaiting_customer_reply', 'secured', 'closed'],
      default: 'new_lead',
      index: true,
    },
    awaitingReply: { type: Boolean, default: false },
  },
  { timestamps: true }
);

/*
 * The inbox query is "everything for this user, newest first".
 *
 * There was no index on userId at all, so it ran as a collection scan and
 * sorted in memory — fine at a few hundred documents, and progressively
 * worse with every mail that syncs. The compound index serves both the
 * match and the sort from one structure.
 */
emailSchema.index({ userId: 1, createdAt: -1 });

/*
 * Thread assembly looks messages up by their parent. rootEmailId already
 * has its own index; parentEmailId did not, and it is queried alongside
 * it on every inbox load.
 */
emailSchema.index({ parentEmailId: 1 });

emailSchema.pre('save', function (next) {
  if (this.messageId && !this.rfcMessageId) this.rfcMessageId = this.messageId;
  if (this.rfcMessageId && !this.messageId) this.messageId = this.rfcMessageId;
  if (this.threadId && !this.providerThreadId) this.providerThreadId = this.threadId;
  if (this.providerThreadId && !this.threadId) this.threadId = this.providerThreadId;

  const now = this.date || this.createdAt || new Date();
  if (!this.lastMessageAt) this.lastMessageAt = this.lastActivityAt || now;
  if (!this.lastActivityAt) this.lastActivityAt = this.lastMessageAt || now;
  next();
});

export const EmailModel = mongoose.model('Email', emailSchema);
