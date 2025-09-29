import mongoose from 'mongoose';

const templateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    platform: { type: String, enum: ['shopify', 'other'], required: true },
    name: { type: String, required: true },

    service: { type: String }, // not required anymore
    conditions: [
      {
        field: {
          type: String,
          enum: ['subject', 'body', 'sender', 'recipient'],
          required: true,
        },
        operator: {
          type: String,
          enum: ['equals', 'contains', 'not_equals', 'starts_with'],
          default: 'contains',
        },
        value: { type: String, required: true },
      },
    ],
    content: { type: String, required: true },
    active: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const TemplateModel = mongoose.model('Template', templateSchema);
