import mongoose from 'mongoose';

const mailhookSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mailhook: { type: String, required: true },

    forwardingEmail: {
      type: String,
    },

    connectionVerified: {
      type: Boolean,
      default: false,
    },
    validationId: { type: mongoose.Schema.Types.ObjectId },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const mailhookModel = mongoose.model('Mailhook', mailhookSchema);
