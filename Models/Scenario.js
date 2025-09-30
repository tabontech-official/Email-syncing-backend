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
    routerBranches: [BranchSchema],
  },
  { timestamps: true }
);

export const scenarioModel = mongoose.model("Scenario", ScenarioSchema);