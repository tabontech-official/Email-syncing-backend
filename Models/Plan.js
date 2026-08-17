import mongoose from 'mongoose';

const planSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    monthlyPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    yearlyPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    currency: {
      type: String,
      default: 'USD',
    },
    aiRepliesLimit: {
      type: Number,
      default: 50,
    },
    scenariosLimit: {
      type: Number,
      default: 1,
    },
    connectionsLimit: {
      type: Number,
      default: 1,
    },
    teamMembersLimit: {
      type: Number,
      default: 1,
    },
    trialDays: {
      type: Number,
      default: 0,
    },
    features: [
      {
        type: String,
      },
    ],
    stripeProductId: {
      type: String,
      default: '',
    },
    stripeMonthlyPriceId: {
      type: String,
      default: '',
    },
    stripeYearlyPriceId: {
      type: String,
      default: '',
    },
    active: {
      type: Boolean,
      default: true,
    },
    public: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export const PlanModel = mongoose.model('Plan', planSchema);
