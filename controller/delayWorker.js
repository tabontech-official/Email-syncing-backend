

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
import { ScenarioRunLogModel } from "../Models/ScenarioRunLog.js";
import { scenarioModel } from "../Models/Scenario.js";
import {
  applyLeadIdentity,
  identityFieldsFromName,
} from "../utils/leadIdentity.js";
import {
  parseShopifyInquiry,
  resolveLeadReplyAddress,
} from "../utils/shopifyInquiry.js";
import {
  loadPlatformRules,
  triggerForType,
} from "../utils/platformScenarioConfig.js";

export function fillTemplate(template = "", fields = {}) {
  return template.replace(/{{(.*?)}}/g, (_, key) => {
    const cleanKey = key.trim();
    return fields[cleanKey] || "";
  });
}

/*
 * Scenario-neutral, matching its twin in smtpServer.js: the Shopify
 * reading of a relayed inquiry is applied by the caller and only when
 * the job belongs to a Shopify scenario.
 */
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

const getModuleId = (module) => {
  return module.id || module._id?.toString() || "";
};

const getModuleName = (module) => {
  return module.app?.name || module.type || "Delayed Email";
};

const updateRunLogStep = async ({
  job,
  module,
  status,
  message,
  issue = "",
  suggestion = "",
  sendResult = null,
  error = null,
  startedAt,
}) => {
  if (!job.runLogId) {
    console.log("⚠️ [DelayWorker] runLogId missing. ScenarioRunLog cannot be updated.", {
      delayJobId: job._id,
      scenarioId: job.scenarioId,
      emailId: job.emailId,
    });
    return;
  }

  const moduleName = getModuleName(module);

  const step = {
    stepKey: "delayed-email-send",
    stepName: `${moduleName} Send`,
    status,
    message,
    issue,
    location: job.emailData?.from || "",
    suggestion,
    meta: {
      delayJobId: job._id,
      moduleId: getModuleId(module),
      moduleType: module.type || "",
      moduleName,
      appName: module.app?.name || "",
      replyEmailId: sendResult?.replyEmailId || null,
      templateId: module.templateId || null,
      templateName: module.templateName || module.template || "",
      service: module.service || "",
      stepType: module.stepType || "",
      smtpErrorCode: error?.code || "",
      smtpErrorCommand: error?.command || "",
      smtpErrorResponse: error?.response || "",
      smtpErrorMessage: error?.message || "",
    },
    startedAt: startedAt || new Date(),
    completedAt: new Date(),
  };

  const setPayload =
    status === "success"
      ? {
          status: "success",
          message: "Delayed scenario completed successfully.",
          replyEmailId: sendResult?.replyEmailId || null,
          completedAt: new Date(),
        }
      : {
          status: "failed",
          message: issue || message || "Delayed scenario failed.",
          completedAt: new Date(),
        };

  await ScenarioRunLogModel.findByIdAndUpdate(job.runLogId, {
    $push: { steps: step },
    $set: setPayload,
  });
};

export const startDelayWorker = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();

      const jobs = await DelayJobModel.find({
        scheduledAt: { $lte: now },
        $or: [
          { status: { $exists: false } },
          { status: "pending" },
          { status: { $ne: "processing" } },
        ],
      });

      for (const job of jobs) {
        console.log(`⏰ [DelayWorker] Processing delayed job ${job._id} for user ${job.userId}`);

        /*
         * Respect the scenario's On/Off toggle.
         *
         * A follow-up queued while the scenario was running would still
         * fire minutes or hours later, after the user had switched it Off
         * — so turning a scenario off did not stop mail already in flight.
         * The job is cancelled rather than left pending, so it does not
         * fire the moment the scenario is switched back on.
         */
        /*
         * The relay handling below is Shopify-only, so the job has to
         * know which kind of scenario queued it. Unknown (a job with no
         * scenarioId, from before these were linked) is treated as NOT
         * Shopify — the conservative side, since it means replying to
         * whoever sent the mail rather than to an address guessed out of
         * its body.
         */
        let isShopifyJob = false;

        if (job.scenarioId) {
          const owningScenario = await scenarioModel
            .findById(job.scenarioId)
            .select("scenarioActive name type")
            .lean();

          isShopifyJob = owningScenario?.type === "shopify";

          if (!owningScenario || owningScenario.scenarioActive === false) {
            console.log(
              `⏸️ [DelayWorker] Scenario "${owningScenario?.name || job.scenarioId}" is switched OFF — cancelling job ${job._id}.`
            );

            /*
             * Deleted rather than flagged: the query above re-matches any
             * status that is not "processing", so a cancelled row would be
             * picked up again on every tick and never clear. Completed jobs
             * are deleted the same way.
             */
            await DelayJobModel.deleteOne({ _id: job._id });

            continue;
          }
        }

        await DelayJobModel.updateOne(
          { _id: job._id },
          {
            $set: {
              status: "processing",
              startedAt: new Date(),
            },
          }
        );

        /*
         * The administrator's configured trigger subject, used only by
         * the Shopify identity step below. Cached, so this costs nothing
         * per job.
         */
        const delayRules = isShopifyJob ? await loadPlatformRules() : null;

        /*
         * Where this follow-up actually goes.
         *
         * executeScenarios() stamped replyTo on the job when the lead
         * arrived through a relay, so the follow-up reaches the same
         * person the first reply did. Older jobs queued before that
         * existed carry no replyTo, so the body is re-read; failing
         * both, the sender stands.
         */
        const followUpTo =
          (isShopifyJob
            ? job.emailData?.replyTo ||
              resolveLeadReplyAddress(job.emailData?.body || "", {
                fromAddress: job.emailData?.from || "",
                receivedAt: job.emailData?.to || "",
              })
            : null) || job.emailData?.from;

        if (followUpTo && followUpTo !== job.emailData?.from) {
          console.log(`↪️ [DelayWorker] Follow-up goes to ${followUpTo}, not the sender ${job.emailData?.from}.`);
        }

        const extractedFields = extractFieldsFromEmail(
          job.emailData?.parsedEmailObj || {
            text: job.emailData?.body,
            subject: job.emailData?.subject,
            from: job.emailData?.from,
          }
        );

        /*
         * The contact form again, for the same reason the immediate reply
         * reads it: it holds the store, country, budget and enquiry text
         * the follow-up templates reference. A follow-up that says
         * "your store" where the first reply said "My Store" reads like
         * two different senders.
         */
        const followUpInquiry = isShopifyJob
          ? parseShopifyInquiry(job.emailData?.body || "")
          : {};

        /*
         * A relayed lead is named in the subject, not the From header, so
         * a Shopify follow-up reads the name the same way its initial
         * reply did. A follow-up that greets someone differently from the
         * first reply reads like a different sender.
         */
        if (isShopifyJob) {
          applyLeadIdentity(
            extractedFields,
            job.emailData?.subject || "",
            triggerForType(delayRules, "shopify")?.subjectFilter || ""
          );
        }

        if (followUpInquiry.fullName) {
          Object.assign(
            extractedFields,
            identityFieldsFromName(followUpInquiry.fullName)
          );
        }

        if (followUpInquiry.businessEmail)
          extractedFields.BusinessEmail = followUpInquiry.businessEmail;
        if (followUpInquiry.storeName)
          extractedFields.StoreName = followUpInquiry.storeName;
        if (followUpInquiry.storeUrl)
          extractedFields.StoreURL = followUpInquiry.storeUrl;
        if (followUpInquiry.country)
          extractedFields.Country = followUpInquiry.country;
        if (followUpInquiry.budget)
          extractedFields.Budget = followUpInquiry.budget;
        if (followUpInquiry.problemGoal)
          extractedFields.ProblemGoal = followUpInquiry.problemGoal;
        if (followUpInquiry.service)
          extractedFields.Service = followUpInquiry.service;

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
          const issue = "No valid delayed email modules found after delay.";

          console.log(`⚠️ [DelayWorker] ${issue}`, {
            delayJobId: job._id,
            modulesLeft: job.modulesLeft,
          });

          await ScenarioRunLogModel.findByIdAndUpdate(job.runLogId, {
            $push: {
              steps: {
                stepKey: "delayed-email-module-check",
                stepName: "Delayed Email Module Check",
                status: "failed",
                message: issue,
                issue,
                suggestion: "Check DelayJob modulesLeft. It should contain Custom Email / Send Email modules.",
                location: job.emailData?.from || "",
                meta: {
                  delayJobId: job._id,
                  modulesLeftCount: job.modulesLeft?.length || 0,
                },
                startedAt: new Date(),
                completedAt: new Date(),
              },
            },
            $set: {
              status: "failed",
              message: issue,
              completedAt: new Date(),
            },
          });

          await DelayJobModel.updateOne(
            { _id: job._id },
            {
              $set: {
                status: "failed",
                completedAt: new Date(),
              },
            }
          );

          await DelayJobModel.deleteOne({ _id: job._id });
          continue;
        }

        let hasFailed = false;

        for (const module of emailModules) {
          const startedAt = new Date();

          try {
            const moduleName = getModuleName(module);

            console.log(`📤 [DelayWorker] Sending delayed email for module: ${moduleName}`);

            let finalTemplate = module.template || "Thanks for your email!";
            finalTemplate = fillTemplate(finalTemplate, extractedFields);

            const sendResult = await sendEmailModule(
              {
                ...module,
                template: finalTemplate,
              },
              followUpTo,
              job.emailData.subject,
              job.emailId
            );

            if (!sendResult?.success) {
              const error = new Error(sendResult?.error || "sendEmailModule returned success false.");
              error.code = sendResult?.code || "";
              error.response = sendResult?.response || "";
              error.command = sendResult?.command || "";
              throw error;
            }

            await updateRunLogStep({
              job,
              module,
              status: "success",
              message: `${moduleName} sent successfully.`,
              sendResult,
              startedAt,
            });

            const moduleId = getModuleId(module);

            await AutomationStatusModel.findOneAndUpdate(
              {
                emailId: job.emailId,
                scenarioId: job.scenarioId,
              },
              {
                $addToSet: { completedModules: moduleId },
                $pull: { pendingModules: moduleId },
                $set: {
                  lastExecutedAt: new Date(),
                  status: "partial",
                },
              }
            );

            const statusDoc = await AutomationStatusModel.findOne({
              emailId: job.emailId,
              scenarioId: job.scenarioId,
            });

            if (statusDoc && statusDoc.pendingModules.length === 0) {
              statusDoc.status = "completed";
              await statusDoc.save();

              await ScenarioRunLogModel.findByIdAndUpdate(job.runLogId, {
                $set: {
                  status: "success",
                  message: "All delayed modules completed successfully.",
                  completedAt: new Date(),
                },
              });
            }
          } catch (err) {
            hasFailed = true;

            const moduleName = getModuleName(module);

            console.error("❌ [DelayWorker] Error while sending delayed email:", {
              delayJobId: job._id,
              moduleId: getModuleId(module),
              moduleName,
              errorMessage: err.message,
              errorCode: err.code,
              errorCommand: err.command,
              errorResponse: err.response,
            });

            let issue = err.message || "Delayed email failed.";
            let suggestion = "Check SMTP credentials, SMTP host, port, secure setting, and provider limits.";

            if (issue.includes("ECONNRESET")) {
              issue = "SMTP connection was reset while sending delayed email.";
              suggestion =
                "For GoDaddy SMTP, try host smtpout.secureserver.net with port 587 secure:false, or port 465 secure:true. Also verify mailbox password and SMTP access.";
            }

            await updateRunLogStep({
              job,
              module,
              status: "failed",
              message: `${moduleName} failed.`,
              issue,
              suggestion,
              error: err,
              startedAt,
            });

            await AutomationStatusModel.findOneAndUpdate(
              {
                emailId: job.emailId,
                scenarioId: job.scenarioId,
              },
              {
                $set: {
                  status: "failed",
                  lastExecutedAt: new Date(),
                },
              }
            );
          }
        }

        if (hasFailed) {
          await DelayJobModel.updateOne(
            { _id: job._id },
            {
              $set: {
                status: "failed",
                completedAt: new Date(),
              },
            }
          );
        } else {
          await DelayJobModel.updateOne(
            { _id: job._id },
            {
              $set: {
                status: "completed",
                completedAt: new Date(),
              },
            }
          );

          await DelayJobModel.deleteOne({ _id: job._id });
        }

        console.log(`✅ [DelayWorker] Finished delayed job ${job._id}`);
      }
    } catch (err) {
      console.error("❌ [DelayWorker] Cron execution failed:", err);
    }
  });
};