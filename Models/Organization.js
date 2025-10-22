import mongoose from "mongoose";

const OrganizationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organizationName: { type: String, required: true },
    Region: { type: String, default: "Unknown" },
    country: { type: String, default: "Unknown" },
    TimeZone: { type: String, default: "UTC" },
    PartnerLink: { type: String, default: "" },
  },
  { timestamps: true }
);

export const OrganizationModel = mongoose.model(
  "Organization",
  OrganizationSchema
);
