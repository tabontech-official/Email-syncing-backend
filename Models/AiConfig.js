import mongoose from "mongoose";

const AiConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global_master_config", unique: true },

    // Master System Prompt (Super Admin)
    masterPrompt: {
      type: String,
      default:
        "You are an expert AI customer support & sales agent. Always assist customers clearly, politely, and accurately using the company knowledge base. Ensure responses remain professional, on-brand, and follow all company guidelines.",
    },

    // OpenRouter Provider Configuration
    provider: { type: String, default: "openrouter" },
    modelName: {
      type: String,
      default: "google/gemini-2.0-flash-exp:free",
    },
    apiKey: { type: String, default: "" }, // Optional OpenRouter key override
    temperature: { type: Number, default: 0.7 },
    maxTokens: { type: Number, default: 1024 },

    // Future RAG Pipeline Config Flags
    ragEnabled: { type: Boolean, default: true },
    topK: { type: Number, default: 4 },
  },
  { timestamps: true }
);

export const AiConfigModel = mongoose.model("AiConfig", AiConfigSchema);
