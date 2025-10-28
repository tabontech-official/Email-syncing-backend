import mongoose from 'mongoose';

const connectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    provider: {
      type: String,
      enum: ['gmail', 'outlook', 'smtp'],
      required: true,
    },
    email: { type: String, required: true },
    name: { type: String },

    tokens: { type: Object },
    verified: {
      type: Boolean,
      default:false
    },
    smtp: {
      host: { type: String },
      port: { type: Number },
      username: { type: String },
      password: { type: String },
    },

    status: {
      type: String,
      enum: ['active', 'disconnected'],
      default: 'active',
    },
  },
  { timestamps: true }
);

connectionSchema.index({ userId: 1, email: 1 }, { unique: true });

export const ConnectionModel = mongoose.model('Connection', connectionSchema);
