import mongoose from "mongoose";

const ModuleSchema = new mongoose.Schema({
  id: { type: String, required: true },
  app: {
    name: String,
    color: String,
    icon: String, 
  },
  type: String,
  description: String,
  connectionId: String,
  template: String,

  delayValue: { type: Number, default: null },
  delayUnit: { type: String, enum: ["seconds", "minutes", "hours"], default: null },

  filter: {
    label: String,
    conditions: [String],
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
    conditions: [String],
    template: String,
  },
});

const ScenarioSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true },
    description: String,
    type: {
      type: String,
      enum: ["other", "shopify"], // 👈 only two values allowed
      default: "other",
    },
    routerBranches: [BranchSchema],
  },
  { timestamps: true }
);

export const scenarioModel = mongoose.model("Scenario", ScenarioSchema);
