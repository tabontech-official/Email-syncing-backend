import mongoose from 'mongoose';

const stripeConfigSchema = new mongoose.Schema(
  {
    publishableKey: {
      type: String,
      default: '',
    },
    secretKeyEncrypted: {
      type: String,
      default: '',
    },
    webhookSecretEncrypted: {
      type: String,
      default: '',
    },
    mode: {
      type: String,
      enum: ['test', 'live'],
      default: 'test',
    },
    isConfigured: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

export const StripeConfigModel = mongoose.model('StripeConfig', stripeConfigSchema);
