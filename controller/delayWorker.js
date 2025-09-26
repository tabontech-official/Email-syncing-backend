import cron from "node-cron";
import { sendEmailModule } from "./smtpServer.js";
import { DelayJobModel } from "../Models/DelayJob.js";

// Worker start function
export const startDelayWorker = () => {
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const jobs = await DelayJobModel.find({ scheduledAt: { $lte: now } });

      console.log(`⏰ DelayWorker tick → ${jobs.length} job(s) found`);

      for (const job of jobs) {
        console.log("🚀 Running delayed job:", job._id);

        for (const module of job.modulesLeft) {
          if (
            module.type === "Send an Email" ||
            module.type === "Custom Email"
          ) {
            try {
              await sendEmailModule(
                module,
                job.emailData.from,
                job.emailData.subject
              );
              console.log(
                `📤 Delayed email sent for job ${job._id} via ${module.connectionId} (${module.type})`
              );
            } catch (err) {
              console.error("❌ Error executing delayed module:", err);
            }
          } else if (module.type === "Delay") {
            console.log("⏸️ Nested delay found, skipping (already scheduled)");
          } else {
            console.log("⚠️ Unsupported delayed module type:", module.type);
          }
        }

        // ✅ delete after processing
        await DelayJobModel.deleteOne({ _id: job._id });
        console.log(`✅ Completed and removed job ${job._id}`);
      }
    } catch (err) {
      console.error("❌ Worker error:", err);
    }
  });

  console.log("⏳ Delay worker started (runs every minute)");
};
