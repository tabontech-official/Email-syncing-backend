import mongoose from "mongoose";

const connectionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, default: "gmail" }, 
    email: { type: String, required: true },
    name: { type: String },
    tokens: { type: Object, required: true },
    status: { type: String, enum: ["active", "disconnected"], default: "active" },
  },
  { timestamps: true }
);
connectionSchema.index({ userId: 1, email: 1 }, { unique: true });

export const ConnectionModel = mongoose.model("Connection", connectionSchema);
