// import cron from 'node-cron';
// import { sendEmailModule } from './smtpServer.js';
// import { DelayJobModel } from '../Models/DelayJob.js';
// import { AutomationStatusModel } from '../Models/AutomationStatus.js';

// export const startDelayWorker = () => {
//   cron.schedule('* * * * *', async () => {
//     try {
//       const now = new Date();
//       const jobs = await DelayJobModel.find({ scheduledAt: { $lte: now } });

//       for (const job of jobs) {
//         for (const module of job.modulesLeft) {
//           if (
//             module.type === 'Send an Email' ||
//             module.type === 'Custom Email'
//           ) {
//             try {
//               await sendEmailModule(
//                 module,
//                 job.emailData.from,
//                 job.emailData.subject,
//                   job.emailId              

//               );

//               const statusDoc = await AutomationStatusModel.findOne({
//                 emailId: job.emailId,
//                 scenarioId: job.scenarioId,
//               });

//               if (!statusDoc) {
//               } else {
//                 statusDoc.completedModules.push(module.id);
//                 statusDoc.pendingModules = statusDoc.pendingModules.filter(
//                   (m) => m !== module.id
//                 );

//                 if (
//                   statusDoc.pendingModules.length > 0 &&
//                   statusDoc.completedModules.length > 0
//                 ) {
//                   statusDoc.status = 'partial';
//                 } else if (
//                   statusDoc.pendingModules.length === 0 &&
//                   statusDoc.completedModules.length > 0
//                 ) {
//                   statusDoc.status = 'completed';
//                 }

//                 statusDoc.lastExecutedAt = new Date();
//                 await statusDoc.save();
//               }
//             } catch (err) {
//               await AutomationStatusModel.findOneAndUpdate(
//                 { emailId: job.emailId, scenarioId: job.scenarioId },
//                 { $set: { status: 'failed', lastExecutedAt: new Date() } }
//               );
//             }
//           }
//         }

//         await DelayJobModel.deleteOne({ _id: job._id });
//       }
//     } catch (err) {}
//   });
// };
import cron from "node-cron";
import { sendEmailModule } from "./smtpServer.js";
import { DelayJobModel } from "../Models/DelayJob.js";
import { AutomationStatusModel } from "../Models/AutomationStatus.js";
export function fillTemplate(template, fields) {
  return template.replace(/{{(.*?)}}/g, (_, key) => {
    const cleanKey = key.trim();
    return fields[cleanKey] || "";
  });
}

export function extractFieldsFromEmail(emailObj = {}) {
  const fields = {};

  fields.FullName = emailObj.from?.value?.[0]?.name || "";
  fields.BusinessEmail = emailObj.from?.value?.[0]?.address || "";

  const kv = (emailObj.text || "").split(/\r?\n/).reduce((acc, line) => {
    const match = line.match(/^([\w\s]+)\s*:\s*(.+)$/);
    if (match) acc[match[1].trim().toLowerCase()] = match[2].trim();
    return acc;
  }, {});

  if (kv["budget"]) fields.Budget = kv["budget"];
  if (kv["country"]) fields.Country = kv["country"];

  const storeMatch = (emailObj.text || "").match(/store\s+"([^"]+)"/i);
  if (storeMatch) fields.StoreName = storeMatch[1];

  const urlMatch = (emailObj.text || "").match(/https?:\/\/[^\s]+/i);
  if (urlMatch) fields.StoreURL = urlMatch[0];

  const lines = (emailObj.text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  fields.ProblemGoal = lines.slice(1, 3).join(" ") || "";

  fields.Service = emailObj.subject || "";

  return fields;
}

export const startDelayWorker = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const jobs = await DelayJobModel.find({ scheduledAt: { $lte: now } });

      for (const job of jobs) {
        // 🟪 Extract fields once from the saved email data
        const extractedFields = extractFieldsFromEmail(
          job.emailData?.parsedEmailObj || {
            text: job.emailData?.body,
            subject: job.emailData?.subject,
            from: job.emailData?.from,
          }
        );

        for (const module of job.modulesLeft) {
          if (module.type === "Send an Email" || module.type === "Custom Email") {
            try {
              // 🟪 Replace placeholders with real values
              let finalTemplate = module.template || "Thanks for your email!";
              finalTemplate = fillTemplate(finalTemplate, extractedFields);

              await sendEmailModule(
                { ...module, template: finalTemplate },
                job.emailData.from,
                job.emailData.subject,
                job.emailId
              );

              // 🟪 Update automation status
              const statusDoc = await AutomationStatusModel.findOne({
                emailId: job.emailId,
                scenarioId: job.scenarioId,
              });

              if (statusDoc) {
                const moduleId = module.id || module._id?.toString();
                statusDoc.completedModules.push(moduleId);
                statusDoc.pendingModules = statusDoc.pendingModules.filter(
                  (m) => m.toString() !== moduleId
                );

                statusDoc.status =
                  statusDoc.pendingModules.length > 0
                    ? "partial"
                    : "completed";

                statusDoc.lastExecutedAt = new Date();
                await statusDoc.save();
              }
            } catch (err) {
              console.error("❌ [DelayWorker] Error:", err);
              await AutomationStatusModel.findOneAndUpdate(
                { emailId: job.emailId, scenarioId: job.scenarioId },
                { $set: { status: "failed", lastExecutedAt: new Date() } }
              );
            }
          }
        }

        // 🟪 Remove the job after execution
        await DelayJobModel.deleteOne({ _id: job._id });
      }
    } catch (err) {
      console.error("❌ [DelayWorker] Cron execution failed:", err);
    }
  });
};
