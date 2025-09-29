// import cron from "node-cron";
// import { sendEmailModule } from "./smtpServer.js";
// import { DelayJobModel } from "../Models/DelayJob.js";

// export const startDelayWorker = () => {
//   cron.schedule("* * * * *", async () => {
//     try {
//       const now = new Date();
//       const jobs = await DelayJobModel.find({ scheduledAt: { $lte: now } });

//       console.log(` DelayWorker tick → ${jobs.length} job(s) found`);

//       for (const job of jobs) {
//         console.log(" Running delayed job:", job._id);

//         for (const module of job.modulesLeft) {
//           console.log(
//             `    Processing module → ID: ${module.id}, Type: ${module.type}`
//           );

//           if (
//             module.type === "Send an Email" ||
//             module.type === "Custom Email"
//           ) {
//             try {
//               console.log("    Preparing email...");
//               console.log("      From:", module.connectionId); 
//               console.log("      To:", job.emailData.from);
//               console.log("      Subject:", module.subject || job.emailData.subject);
//               console.log(
//                 "      Body Preview:",
//                 (module.template || "Thanks for your email!").substring(0, 80) +
//                   (module.template?.length > 80 ? "..." : "")
//               );

//               await sendEmailModule(
//                 module,
//                 job.emailData.from,
//                 job.emailData.subject
//               );

//               console.log(
//                 ` Delayed email sent successfully for job ${job._id} via ${module.connectionId} (${module.type})`
//               );
//             } catch (err) {
//               console.error(" Error executing delayed module:", err);
//             }
//           } else if (module.type === "Delay") {
//             console.log("⏸ Nested delay found, skipping (already scheduled)");
//           } else {
//             console.log("Unsupported delayed module type:", module.type);
//           }
//         }

//         await DelayJobModel.deleteOne({ _id: job._id });
//         console.log(`Completed and removed job ${job._id}`);
//       }
//     } catch (err) {
//       console.error(" Worker error:", err);
//     }
//   });

//   console.log("⏳ Delay worker started (runs every minute)");
// };
import cron from "node-cron";
import mongoose from "mongoose";
import { sendEmailModule } from "./smtpServer.js";
import { DelayJobModel } from "../Models/DelayJob.js";
import { TemplateModel } from "../Models/TemplateModel.js";
import { scenarioModel } from "../Models/scenarioModel.js";

export const startDelayWorker = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const jobs = await DelayJobModel.find({ scheduledAt: { $lte: now } });

      console.log(`⏳ DelayWorker tick → ${jobs.length} job(s) found`);

      for (const job of jobs) {
        console.log("▶️ Running delayed job:", job._id);

        // Scenario uthao taake pata chale shopify hai ya other
        const scenario = await scenarioModel.findOne({ userId: job.userId });
        const isShopify = scenario?.type === "shopify";

        for (const module of job.modulesLeft) {
          console.log(
            `    Processing module → ID: ${module.id}, Type: ${module.type}`
          );

          if (module.type === "Send an Email" || module.type === "Custom Email") {
            try {
              let finalTemplate = module.template;

              // 🔹 Shopify case → template resolve karo
              if (isShopify && mongoose.isValidObjectId(module.template)) {
                const tpl = await TemplateModel.findById(module.template);

                if (tpl) {
                  console.log(`📑 Loaded Shopify template: ${tpl.name}`);

                  // fallback → agar type missing hai
                  let tplType = tpl.type;
                  if (!tplType) {
                    if (tpl.name.toLowerCase().includes("initial")) tplType = "initial";
                    else if (tpl.name.toLowerCase().includes("first")) tplType = "first";
                    else if (tpl.name.toLowerCase().includes("second")) tplType = "second";
                  }

                  const serviceTemplate = await TemplateModel.findOne({
                    userId: job.userId,
                    platform: "shopify",
                    service: tpl.service,
                    type: tplType,
                    active: true,
                  });

                  if (serviceTemplate) {
                    finalTemplate = serviceTemplate.content;
                    console.log(
                      `✅ Using user’s Shopify template [${tpl.service} - ${tplType}]`
                    );
                  } else {
                    console.warn(
                      `⚠️ No active Shopify template found for ${tpl.service} - ${tplType}`
                    );
                  }
                }
              }

              // 📨 Send email
              await sendEmailModule(
                { ...module, template: finalTemplate },
                job.emailData.from,
                job.emailData.subject
              );

              console.log(
                `✅ Delayed email sent successfully for job ${job._id} via ${module.connectionId} (${module.type})`
              );
            } catch (err) {
              console.error("❌ Error executing delayed module:", err);
            }
          } else if (module.type === "Delay") {
            console.log("⏸ Nested delay found, skipping (already scheduled)");
          } else {
            console.log("⚠️ Unsupported delayed module type:", module.type);
          }
        }

        await DelayJobModel.deleteOne({ _id: job._id });
        console.log(`🗑 Completed and removed job ${job._id}`);
      }
    } catch (err) {
      console.error("❌ Worker error:", err);
    }
  });

  console.log("🚀 Delay worker started (runs every minute)");
};
