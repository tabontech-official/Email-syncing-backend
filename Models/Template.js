import mongoose from "mongoose";

const templateSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    platform: { type: String, enum: ["shopify", "other"], required: true },
    templates: [
      {
        name: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

export const TemplateModel = mongoose.model("Template", templateSchema);
