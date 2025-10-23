import mongoose from "mongoose";

const ValidationEmailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "auth",
      required: true,
    },
    toEmail: {
      type: String,
      required: true,
    },
    subject: {
      type: String,
      default: "Zenith Forwarding Validation Test",
    },
    body: {
      type: String,
      required: true,
    },
    sentAt: {
      type: Date,
      default: Date.now,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "sent", "verified", "failed"],
      default: "pending",
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);

export const validationModel= mongoose.model("ValidationEmail", ValidationEmailSchema);
