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
  },
  { timestamps: true }
);

export const EmailModel = mongoose.model('Email', emailSchema);
