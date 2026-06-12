

// import cron from "node-cron";
// import { sendEmailModule } from "./smtpServer.js";
// import { DelayJobModel } from "../Models/DelayJob.js";
// import { AutomationStatusModel } from "../Models/AutomationStatus.js";

// // ✅ Utility to replace placeholders
// export function fillTemplate(template, fields) {
//   return template.replace(/{{(.*?)}}/g, (_, key) => {
//     const cleanKey = key.trim();
//     return fields[cleanKey] || "";
//   });
// }

// // ✅ Utility to extract fields from email text
// export function extractFieldsFromEmail(emailObj = {}) {
//   const fields = {};

//   fields.FullName = emailObj.from?.value?.[0]?.name || "";
//   fields.BusinessEmail = emailObj.from?.value?.[0]?.address || "";

//   const kv = (emailObj.text || "").split(/\r?\n/).reduce((acc, line) => {
//     const match = line.match(/^([\w\s]+)\s*:\s*(.+)$/);
//     if (match) acc[match[1].trim().toLowerCase()] = match[2].trim();
//     return acc;
//   }, {});

//   if (kv["budget"]) fields.Budget = kv["budget"];
//   if (kv["country"]) fields.Country = kv["country"];

//   const storeMatch = (emailObj.text || "").match(/store\s+"([^"]+)"/i);
//   if (storeMatch) fields.StoreName = storeMatch[1];

//   const urlMatch = (emailObj.text || "").match(/https?:\/\/[^\s]+/i);
//   if (urlMatch) fields.StoreURL = urlMatch[0];

//   const lines = (emailObj.text || "")
//     .split(/\r?\n/)
//     .map((l) => l.trim())
//     .filter(Boolean);
//   fields.ProblemGoal = lines.slice(1, 3).join(" ") || "";

//   fields.Service = emailObj.subject || "";

//   return fields;
// }

// // ✅ Delay Worker (fixed)
// export const startDelayWorker = () => {
//   cron.schedule("* * * * *", async () => {
//     try {
//       const now = new Date();

//       // 🟪 Find due jobs that are not already processing
//       const jobs = await DelayJobModel.find({
//         scheduledAt: { $lte: now },
//         $or: [{ status: { $exists: false } }, { status: { $ne: "processing" } }],
//       });

//       for (const job of jobs) {
//         console.log(`⏰ [DelayWorker] Processing delayed job for user ${job.userId}`);

//         // 🟪 Mark job as processing (prevent duplicate)
//         await DelayJobModel.updateOne(
//           { _id: job._id },
//           { $set: { status: "processing", startedAt: new Date() } }
//         );

//         // 🟪 Extract email fields for placeholders
//         const extractedFields = extractFieldsFromEmail(
//           job.emailData?.parsedEmailObj || {
//             text: job.emailData?.body,
//             subject: job.emailData?.subject,
//             from: job.emailData?.from,
//           }
//         );

//         // 🟪 Filter out only supported (email-type) modules
//         const emailModules = (job.modulesLeft || []).filter((m) => {
//           const t = (m.type || m.app?.name || "").toLowerCase();
//           return (
//             t.includes("email") ||
//             t.includes("gmail") ||
//             t.includes("follow") ||
//             t.includes("initial")
//           );
//         });

//         if (emailModules.length === 0) {
//           console.log(
//             `⚠️ [DelayWorker] No valid email modules found for job ${job._id}`
//           );
//           await DelayJobModel.deleteOne({ _id: job._id });
//           continue;
//         }

//         // 🟪 Process each valid delayed email module
//         for (const module of emailModules) {
//           try {
//             console.log(`📤 [DelayWorker] Sending delayed email for module: ${module.type}`);

//             let finalTemplate = module.template || "Thanks for your email!";
//             finalTemplate = fillTemplate(finalTemplate, extractedFields);

//             // Send email
//             await sendEmailModule(
//               { ...module, template: finalTemplate },
//               job.emailData.from,
//               job.emailData.subject,
//               job.emailId
//             );

//             // Update Automation Status
//             const moduleId = module.id || module._id?.toString();
//             await AutomationStatusModel.findOneAndUpdate(
//               { emailId: job.emailId, scenarioId: job.scenarioId },
//               {
//                 $addToSet: { completedModules: moduleId },
//                 $pull: { pendingModules: moduleId },
//                 $set: {
//                   lastExecutedAt: new Date(),
//                   status: "partial",
//                 },
//               }
//             );

//             // Check if all modules done
//             const statusDoc = await AutomationStatusModel.findOne({
//               emailId: job.emailId,
//               scenarioId: job.scenarioId,
//             });
//             if (statusDoc && statusDoc.pendingModules.length === 0) {
//               statusDoc.status = "completed";
//               await statusDoc.save();
//             }
//           } catch (err) {
//             console.error("❌ [DelayWorker] Error while sending delayed email:", err);
//             await AutomationStatusModel.findOneAndUpdate(
//               { emailId: job.emailId, scenarioId: job.scenarioId },
//               { $set: { status: "failed", lastExecutedAt: new Date() } }
//             );
//           }
//         }

//         // 🟪 Clean up after successful execution
//         await DelayJobModel.deleteOne({ _id: job._id });
//         console.log(`✅ [DelayWorker] Finished delayed job ${job._id}`);
//       }
//     } catch (err) {
//       console.error("❌ [DelayWorker] Cron execution failed:", err);
//     }
//   });
// };




import cron from "node-cron";
import { sendEmailModule } from "./smtpServer.js";
import { DelayJobModel } from "../Models/DelayJob.js";
import { AutomationStatusModel } from "../Models/AutomationStatus.js";

// ✅ Utility to replace placeholders
export function fillTemplate(template, fields) {
  return template.replace(/{{(.*?)}}/g, (_, key) => {
    const cleanKey = key.trim();
    return fields[cleanKey] || "";
  });
}

// ✅ Utility to extract fields from email text
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

// ✅ Delay Worker (fixed)
export const startDelayWorker = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      // 🟪 Find due jobs that are not already processing
      const jobs = await DelayJobModel.find({
        scheduledAt: { $lte: now },
        $or: [{ status: { $exists: false } }, { status: { $ne: "processing" } }],
      });

      for (const job of jobs) {
        console.log(`⏰ [DelayWorker] Processing delayed job for user ${job.userId}`);

        // 🟪 Mark job as processing (prevent duplicate)
        await DelayJobModel.updateOne(
          { _id: job._id },
          { $set: { status: "processing", startedAt: new Date() } }
        );

        // 🟪 Extract email fields for placeholders
        const extractedFields = extractFieldsFromEmail(
          job.emailData?.parsedEmailObj || {
            text: job.emailData?.body,
            subject: job.emailData?.subject,
            from: job.emailData?.from,
          }
        );

        // 🟪 Filter out only supported (email-type) modules
        const emailModules = (job.modulesLeft || []).filter((m) => {
          const t = (m.type || m.app?.name || "").toLowerCase();
          return (
            t.includes("email") ||
            t.includes("gmail") ||
            t.includes("follow") ||
            t.includes("initial")
          );
        });

        if (emailModules.length === 0) {
          console.log(
            `⚠️ [DelayWorker] No valid email modules found for job ${job._id}`
          );
          await DelayJobModel.deleteOne({ _id: job._id });
          continue;
        }

        // 🟪 Process each valid delayed email module
        for (const module of emailModules) {
          try {
            console.log(`📤 [DelayWorker] Sending delayed email for module: ${module.type}`);

            let finalTemplate = module.template || "Thanks for your email!";
            finalTemplate = fillTemplate(finalTemplate, extractedFields);

            // Send email
            await sendEmailModule(
              { ...module, template: finalTemplate },
              job.emailData.from,
              job.emailData.subject,
              job.emailId
            );

            // Update Automation Status
            const moduleId = module.id || module._id?.toString();
            await AutomationStatusModel.findOneAndUpdate(
              { emailId: job.emailId, scenarioId: job.scenarioId },
              {
                $addToSet: { completedModules: moduleId },
                $pull: { pendingModules: moduleId },
                $set: {
                  lastExecutedAt: new Date(),
                  status: "partial",
                },
              }
            );

            // Check if all modules done
            const statusDoc = await AutomationStatusModel.findOne({
              emailId: job.emailId,
              scenarioId: job.scenarioId,
            });
            if (statusDoc && statusDoc.pendingModules.length === 0) {
              statusDoc.status = "completed";
              await statusDoc.save();
            }
          } catch (err) {
            console.error("❌ [DelayWorker] Error while sending delayed email:", err);
            await AutomationStatusModel.findOneAndUpdate(
              { emailId: job.emailId, scenarioId: job.scenarioId },
              { $set: { status: "failed", lastExecutedAt: new Date() } }
            );
          }
        }

        // 🟪 Clean up after successful execution
        await DelayJobModel.deleteOne({ _id: job._id });
        console.log(`✅ [DelayWorker] Finished delayed job ${job._id}`);
      }
    } catch (err) {
      console.error("❌ [DelayWorker] Cron execution failed:", err);
    }
  });
};
