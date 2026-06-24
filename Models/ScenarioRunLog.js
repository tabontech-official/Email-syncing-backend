import mongoose from "mongoose";

const scenarioRunLogStepSchema = new mongoose.Schema(
  {
    stepKey: {
      type: String,
      required: true,
      // examples: webhook, template-check, parent-email, reply-email, scenario-execution
    },

    stepName: {
      type: String,
      required: true,
      // examples: Webhook Email, Template Check, Initial Email Reply
    },

    status: {
      type: String,
      enum: ["success", "failed", "skipped", "pending"],
      default: "pending",
    },

    message: {
      type: String,
      default: "",
    },

    issue: {
      type: String,
      default: "",
    },

    location: {
      type: String,
      default: "",
      // examples: Branch 1 Module 2, Conversion rate optimization templates
    },

    suggestion: {
      type: String,
      default: "",
    },

    meta: {
      type: Object,
      default: {},
    },

    startedAt: {
      type: Date,
      default: null,
    },

    completedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const scenarioRunLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    scenarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Scenario",
      default: null,
      index: true,
    },

    scenarioName: {
      type: String,
      default: "",
    },

    scenarioType: {
      type: String,
      default: "shopify",
      index: true,
    },

    runType: {
      type: String,
      enum: ["test", "live"],
      default: "test",
      index: true,
    },

    status: {
      type: String,
      enum: ["success", "failed", "partial"],
      required: true,
      index: true,
    },

    message: {
      type: String,
      default: "",
    },

    service: {
      type: String,
      default: "",
      index: true,
    },

    usedGeneralTemplate: {
      type: Boolean,
      default: false,
    },

    businessEmail: {
      type: String,
      default: "",
      index: true,
    },

    customerName: {
      type: String,
      default: "",
    },

    parentEmailId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    replyEmailId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Template",
      default: null,
    },

    templateName: {
      type: String,
      default: "",
    },

    steps: {
      type: [scenarioRunLogStepSchema],
      default: [],
    },

    errorSummary: {
      type: String,
      default: "",
    },

    errorDetails: {
      type: Object,
      default: {},
    },

    requestPayload: {
      type: Object,
      default: {},
    },

    responsePayload: {
      type: Object,
      default: {},
    },

    startedAt: {
      type: Date,
      default: Date.now,
    },

    completedAt: {
      type: Date,
      default: null,
    },
    
  },
  { timestamps: true }
);

scenarioRunLogSchema.index({ userId: 1, createdAt: -1 });
scenarioRunLogSchema.index({ scenarioId: 1, createdAt: -1 });
scenarioRunLogSchema.index({ userId: 1, status: 1, createdAt: -1 });

export const ScenarioRunLogModel = mongoose.model(
  "ScenarioRunLog",
  scenarioRunLogSchema
);