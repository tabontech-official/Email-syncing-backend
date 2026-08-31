import mongoose from "mongoose";

const ConditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    operator: { type: String, required: true },
    value: { type: String, required: true },
    join: { type: String, enum: ["AND", "OR", null], default: null },
  },
  { _id: false } 
);

const ModuleSchema = new mongoose.Schema({
  id: { type: String, required: true },
  app: {
    name: String,
    color: String,
    icon: String,
  },
   position: {
    x: { type: Number, default: 200 },
    y: { type: Number, default: 200 },
  },
  subject: { type: String, default: "" },  
  to: { type: String, required: false }, 
  cc: { type: [String], default: [] },     
  bcc: { type: [String], default: [] },    
  type: String,
  description: String,
  connectionId: String,
  template: String,

  delayValue: { type: Number, default: null },
  delayUnit: { type: String, enum: ["seconds", "minutes", "hours"], default: null },

  emailType: { type: String, default: "" },

  /*
   * How this module produces its reply.
   *
   * "manual" sends the template as written. "ai" has the model write from
   * a company profile — which one is companyProfileId, falling back to the
   * user's default profile when unset.
   */
  replyMode: {
    type: String,
    enum: ["manual", "ai"],
    default: "manual",
  },

  companyProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CompanyProfile",
    default: null,
  },

  filter: {
    label: String,
    conditions: [ConditionSchema],
    template: String,
  },
});


const BranchSchema = new mongoose.Schema({
  id: { type: Number, required: true },
  hasModule: { type: Boolean, default: false },
  condition: { type: String, default: null },
  modules: [ModuleSchema],
  filter: {
    label: String,
    conditions: [ConditionSchema], 
    template: String,
  },
});


const IncomingLeadSchema = new mongoose.Schema(
  {
    app: {
      name: { type: String, default: "Gmail" },
      color: { type: String, default: "" },
      icon: { type: String, default: "" },
    },

    connectionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Connection",
      default: null,
    },

    /*
     * A mailhook trigger has no Connection document behind it: mail is
     * delivered straight to the user's mailhook address and the webhook
     * runs the scenario. Kept in its own field so connectionId stays a
     * real Connection ref — it doubles as the reply-sender fallback
     * during execution, and a mailhook id there would break sending.
     */
    mailhookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Mailhook",
      default: null,
    },

    subjectFilter: {
      type: String,
      default: "",
    },

    pollInterval: {
      type: Number,
      default: 60,
    },

    enabled: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const ScenarioSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String },
    description: String,
    type: {
      type: String,
      enum: ["other", "shopify"],
      default: "other",
    },
       incomingLead: {
      type: IncomingLeadSchema,
      default: () => ({
        app: {
          name: "Gmail",
          color: "",
          icon: "",
        },
        connectionId: null,
        subjectFilter: "",
        pollInterval: 60,
        enabled: false,
      }),
    },

    routerBranches: [BranchSchema],
    rfNodes: { type: mongoose.Schema.Types.Mixed, default: [] },
    rfEdges: { type: mongoose.Schema.Types.Mixed, default: [] },
    scenarioActive:{
      type:Boolean,
      default:false
    }
  },
  { timestamps: true }
);

export const scenarioModel = mongoose.model("Scenario", ScenarioSchema);