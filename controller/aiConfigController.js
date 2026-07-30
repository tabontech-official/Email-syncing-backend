import { AiConfigModel } from "../models/AiConfig.js";

// GET /api/ai-config
export const getAiConfig = async (req, res) => {
  try {
    let config = await AiConfigModel.findOne({ key: "global_master_config" }).lean();

    if (!config) {
      config = await AiConfigModel.create({
        key: "global_master_config",
        masterPrompt:
          "You are an expert AI customer support & sales agent. Always assist customers clearly, politely, and accurately using the company knowledge base. Ensure responses remain professional, on-brand, and follow all company guidelines.",
        provider: "openrouter",
        modelName: "google/gemini-2.0-flash-exp:free",
        apiKey: "",
        temperature: 0.7,
        maxTokens: 1024,
      });
    }

    return res.status(200).json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error("❌ Error fetching AI Master Config:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching AI config",
      error: error.message,
    });
  }
};

// PUT /api/ai-config
export const updateAiConfig = async (req, res) => {
  try {
    const { masterPrompt, provider, modelName, apiKey, temperature, maxTokens, ragEnabled, topK } = req.body;

    const updatedConfig = await AiConfigModel.findOneAndUpdate(
      { key: "global_master_config" },
      {
        $set: {
          masterPrompt,
          provider: provider || "openrouter",
          modelName: modelName || "google/gemini-2.0-flash-exp:free",
          apiKey: apiKey !== undefined ? apiKey : "",
          temperature: temperature ?? 0.7,
          maxTokens: maxTokens ?? 1024,
          ragEnabled: ragEnabled ?? true,
          topK: topK ?? 4,
        },
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: "Master AI Configuration updated successfully",
      data: updatedConfig,
    });
  } catch (error) {
    console.error("❌ Error updating AI Master Config:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating AI config",
      error: error.message,
    });
  }
};
