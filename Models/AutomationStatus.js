// models/AutomationStatus.js
import mongoose from "mongoose";

const automationStatusSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  emailId: { type: String, required: true }, 
  scenarioId: { type: mongoose.Schema.Types.ObjectId, ref: "Scenario" },
  branchId: { type: String },
  status: {
    type: String,
    enum: ["pending", "partial", "completed", "failed"],
    default: "pending",
  },
  completedModules: [{ type: String }],   
  pendingModules: [{ type: String }],  
  lastExecutedAt: { type: Date, default: Date.now },
});

export const AutomationStatusModel =  mongoose.model("AutomationStatus", automationStatusSchema);
 