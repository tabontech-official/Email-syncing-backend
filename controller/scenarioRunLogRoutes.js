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
        { scenarioId },
        { scenarioId: null },
      ],
      scenarioType: "shopify",
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .select(
        "status message runType service businessEmail customerName errorSummary usedGeneralTemplate startedAt completedAt createdAt steps"
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