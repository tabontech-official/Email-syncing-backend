import mongoose from "mongoose";
import { ScenarioRunLogModel } from "../Models/ScenarioRunLog.js";

export const getHistory = async (req, res) => {
  try {
    const { scenarioId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(scenarioId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid scenarioId",
      });
    }

    const logs = await ScenarioRunLogModel.find({
      $or: [
        { scenarioId: new mongoose.Types.ObjectId(scenarioId) },
        { scenarioId: null },
      ],
      scenarioType: "shopify",
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select(
        [
          "userId",
          "scenarioId",
          "scenarioName",
          "scenarioType",
          "status",
          "message",
          "runType",
          "service",
          "businessEmail",
          "customerName",
          "parentEmailId",
          "replyEmailId",
          "templateId",
          "templateName",
          "errorSummary",
          "errorDetails",
          "usedGeneralTemplate",
          "requestPayload",
          "responsePayload",
          "startedAt",
          "completedAt",
          "createdAt",
          "steps",
        ].join(" ")
      )
      .lean();

    return res.status(200).json({
      success: true,
      logs,
    });
  } catch (err) {
    console.error("Fetch Shopify scenario logs error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch scenario history",
    });
  }
};