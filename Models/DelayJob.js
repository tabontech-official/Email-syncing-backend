import mongoose from "mongoose";

const delayJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  emailData: Object,
  modulesLeft: Array,
  scheduledAt: Date,
});

export const DelayJobModel = mongoose.model("DelayJob", delayJobSchema);
