import mongoose from "mongoose";
import { ScenarioRunLogModel } from "../Models/ScenarioRunLog.js";
import { EmailModel } from "../Models/Email.js";

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

    const logsWithEmails = await Promise.all(
      logs.map(async (log) => {
        const [parentEmail, replyEmail] = await Promise.all([
          log.parentEmailId
            ? EmailModel.findById(log.parentEmailId)
              .select("senderAddress recipientAddress subject textBody htmlBody date service stepType templateId parentEmailId")
              .lean()
            : null,

          log.replyEmailId
            ? EmailModel.findById(log.replyEmailId)
              .select("senderAddress recipientAddress subject textBody htmlBody date service stepType templateId parentEmailId")
              .lean()
            : null,
        ]);

        return {
          ...log,
          parentEmail,
          replyEmail,
        };
      })
    );

    return res.status(200).json({
      success: true,
      logs: logsWithEmails,
    });
  } catch (err) {
    console.error("Fetch Shopify scenario logs error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch scenario history",
    });
  }
};