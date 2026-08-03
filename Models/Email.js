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
    scenarioExecuted: { type: Boolean, default: false },
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
