import mongoose from 'mongoose';

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
    verificationCode: { type: String, default: null },
    verificationUrl: { type: String, default: null },
      extraFields: { type: Object, default: {} },
  },
  { timestamps: true }
);

export const EmailModel = mongoose.model('Email', emailSchema);
