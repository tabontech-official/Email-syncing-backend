import mongoose from "mongoose";

const templateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  platform: { type: String, enum: ["shopify", "other"], required: true },
  service: { type: String, required: true },
  keywords: [
    {
      key: String,
      operator: {
        type: String,
        enum: ["equals", "contains", "not_equals", "starts_with"],
        default: "contains"
      }
    }
  ],
  content: { type: String, required: true },
  active: { type: Boolean, default: true }

}, { timestamps: true });

export const TemplateModel = mongoose.model("Template", templateSchema);
