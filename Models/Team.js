import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    name: {
      type: String,
      default: 'My Team',
      required: true,
    },
    creditsUsed: {
      type: Number,
      default: 0,
    },
    membersCount: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

export const TeamModel = mongoose.model('Team', teamSchema);
