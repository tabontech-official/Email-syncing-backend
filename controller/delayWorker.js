import cron from 'node-cron';
import { sendEmailModule } from './smtpServer.js';
import { DelayJobModel } from '../Models/DelayJob.js';
import { AutomationStatusModel } from '../Models/AutomationStatus.js';

export const startDelayWorker = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const jobs = await DelayJobModel.find({ scheduledAt: { $lte: now } });

      for (const job of jobs) {
        for (const module of job.modulesLeft) {
          if (
            module.type === 'Send an Email' ||
            module.type === 'Custom Email'
          ) {
            try {
              await sendEmailModule(
                module,
                job.emailData.from,
                job.emailData.subject,
                  job.emailId              

              );

              const statusDoc = await AutomationStatusModel.findOne({
                emailId: job.emailId,
                scenarioId: job.scenarioId,
              });

              if (!statusDoc) {
              } else {
                statusDoc.completedModules.push(module.id);
                statusDoc.pendingModules = statusDoc.pendingModules.filter(
                  (m) => m !== module.id
                );

                if (
                  statusDoc.pendingModules.length > 0 &&
                  statusDoc.completedModules.length > 0
                ) {
                  statusDoc.status = 'partial';
                } else if (
                  statusDoc.pendingModules.length === 0 &&
                  statusDoc.completedModules.length > 0
                ) {
                  statusDoc.status = 'completed';
                }

                statusDoc.lastExecutedAt = new Date();
                await statusDoc.save();
              }
            } catch (err) {
              await AutomationStatusModel.findOneAndUpdate(
                { emailId: job.emailId, scenarioId: job.scenarioId },
                { $set: { status: 'failed', lastExecutedAt: new Date() } }
              );
            }
          }
        }

        await DelayJobModel.deleteOne({ _id: job._id });
      }
    } catch (err) {}
  });
};
