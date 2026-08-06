import mongoose from 'mongoose';

const PaymentHistorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    invoiceId: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    status: {
      type: String,
      default: 'Paid',
    },
    paymentMethod: {
      type: String,
      default: 'Stripe (Visa •••• 4242)',
    },
    receiptUrl: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

export const PaymentHistoryModel = mongoose.model(
  'PaymentHistory',
  PaymentHistorySchema
);
