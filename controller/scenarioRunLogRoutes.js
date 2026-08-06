// import mongoose from "mongoose";
// import { ScenarioRunLogModel } from "../Models/ScenarioRunLog.js";
// import { EmailModel } from "../Models/Email.js";

// export const getHistory = async (req, res) => {
//   try {
//     const { scenarioId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(scenarioId)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid scenarioId",
//       });
//     }

//     const logs = await ScenarioRunLogModel.find({
//       $or: [
//         { scenarioId: new mongoose.Types.ObjectId(scenarioId) },
//         { scenarioId: null },
//       ],
//       scenarioType: "shopify",
//     })
//       .sort({ createdAt: -1 })
//       .limit(20)
//       .select(
//         [
//           "userId",
//           "scenarioId",
//           "scenarioName",
//           "scenarioType",
//           "status",
//           "message",
//           "runType",
//           "service",
//           "businessEmail",
//           "customerName",
//           "parentEmailId",
//           "replyEmailId",
//           "templateId",
//           "templateName",
//           "errorSummary",
//           "errorDetails",
//           "usedGeneralTemplate",
//           "requestPayload",
//           "responsePayload",
//           "startedAt",
//           "completedAt",
//           "createdAt",
//           "steps",
//         ].join(" ")
//       )
//       .lean();

//     const logsWithEmails = await Promise.all(
//       logs.map(async (log) => {
//         const [parentEmail, replyEmail] = await Promise.all([
//           log.parentEmailId
//             ? EmailModel.findById(log.parentEmailId)
//               .select("senderAddress recipientAddress subject textBody htmlBody date service stepType templateId parentEmailId")
//               .lean()
//             : null,

//           log.replyEmailId
//             ? EmailModel.findById(log.replyEmailId)
//               .select("senderAddress recipientAddress subject textBody htmlBody date service stepType templateId parentEmailId")
//               .lean()
//             : null,
//         ]);

//         return {
//           ...log,
//           parentEmail,
//           replyEmail,
//         };
//       })
//     );

//     return res.status(200).json({
//       success: true,
//       logs: logsWithEmails,
//     });
//   } catch (err) {
//     console.error("Fetch Shopify scenario logs error:", err);

//     return res.status(500).json({
//       success: false,
//       message: "Failed to fetch scenario history",
//     });
//   }
// };

import mongoose from "mongoose";
import { ScenarioRunLogModel } from "../Models/ScenarioRunLog.js";
import { EmailModel } from "../Models/Email.js";

const getEmailByRef = async (emailRef) => {
  if (!emailRef) return null;

  const ref = String(emailRef).trim();

  if (mongoose.Types.ObjectId.isValid(ref)) {
    return EmailModel.findById(ref)
      .select(
        "senderAddress recipientAddress subject textBody htmlBody date service stepType templateId parentEmailId messageId"
      )
      .lean();
  }

  return EmailModel.findOne({ messageId: ref })
    .select(
      "senderAddress recipientAddress subject textBody htmlBody date service stepType templateId parentEmailId messageId"
    )
    .lean();
};

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
          getEmailByRef(log.parentEmailId),
          getEmailByRef(log.replyEmailId),
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

export const getUserAiRepliesLogs = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ success: false, message: "Invalid userId" });
    }

    const logs = await ScenarioRunLogModel.find({ userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const logsWithEmails = await Promise.all(
      logs.map(async (log) => {
        const [parentEmail, replyEmail] = await Promise.all([
          getEmailByRef(log.parentEmailId),
          getEmailByRef(log.replyEmailId),
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
    console.error("Fetch user AI reply logs error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

