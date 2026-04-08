import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { type } from 'os';

const authSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: [/\S+@\S+\.\S+/, 'Please use a valid email address'],
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters long'],
    },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
    },
    selectedPlatform: { type: String, enum: ['shopify', 'other'] },
    mailhook: { type: String },
    isVerified: { type: Boolean, default: false },
    locked: {
      type: Boolean,
      default: false,
    },
    setup: {
      stepCompleted: { type: Number, default: 0 },
      completed: { type: Boolean, default: false },
      skipped: { type: Boolean, default: false },
      steps: [
        {
          step: { type: Number },
          title: { type: String },
          status: {
            type: String,
            default: 'pending',
          },
          updatedAt: { type: Date, default: Date.now },
        },
      ],
    },
    organizationName: {
      type: String,
      default: 'My Organization',
    },
    Region: {
      type: String,
    },
    country: {
      type: String,
    },
    PartnerLink: {
      type: String,
    },
    guideStatus: {
      sidebar: {
        completed: Boolean,
        step: Number,
      },
      navbar: {
        completed: Boolean,
        step: Number,
      },
    },
    stripeCustomerId: {
      type: String,
    },
    profileImage: {
      type: String,
      default: '',
    },

    subscription: {
      id: { type: String },
      status: { type: String },
      plan: {
        type: String,

        default: 'free',
      },
      currentPeriodEnd: { type: Date },
      currentPeriodStart: { type: Date },
    },

    TimeZone: {
      type: String,
      default: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    lastLogin: { type: Date, default: null },
    lastLogout: { type: Date, default: null },
    Ai: {
      type: Boolean,
      default: false,
    },
  },

  { timestamps: true }
);

authSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

authSchema.methods.comparePassword = async function (candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw new Error('Error comparing passwords');
  }
};

export const authModel = mongoose.model('User', authSchema);
