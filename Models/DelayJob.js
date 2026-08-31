import mongoose from 'mongoose';

const delayJobSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emailData: Object,
  modulesLeft: Array,
  scheduledAt: Date,
  emailId: { type: String },
  scenarioId: { type: mongoose.Schema.Types.ObjectId },
  runLogId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScenarioRunLog' },

  /*
   * The worker has always written these, but they were not declared, so
   * mongoose silently discarded them — which meant its "skip jobs already
   * being processed" guard never actually held.
   */
  status: {
    type: String,
    enum: ['pending', 'processing', 'failed'],
    default: 'pending',
  },
  startedAt: { type: Date, default: null },
});

export const DelayJobModel = mongoose.model('DelayJob', delayJobSchema);
