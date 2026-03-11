import mongoose from "mongoose";
const salesLeadSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    companyName: {
      type: String,
    },
    companySize: {
      type: String,
    },
    projectGoals: {
      type: String,
    },
  },
  { timestamps: true }
);

export const SalesLead= mongoose.model("SalesLead", salesLeadSchema);