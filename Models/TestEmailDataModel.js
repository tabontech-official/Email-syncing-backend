import mongoose from 'mongoose';

const TestEmailDataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    fullName: { type: String, default: 'Dummy Customer' },
    businessEmail: { type: String, required: true },
    storeName: { type: String, default: '' },
    country: { type: String, default: '' },
    service: { type: String, required: true },
    budget: { type: String, default: '' },
    helpDescription: { type: String, default: '' },
    Emailtype: {
      type: String,
    },
    // Keep history tracking
    lastUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const TestEmailDataModel = mongoose.model(
  'TestEmailData',
  TestEmailDataSchema
);
