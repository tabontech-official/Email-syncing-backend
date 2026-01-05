// import mongoose from "mongoose";

// const OrganizationSchema = new mongoose.Schema(
//   {
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "User",
//       required: true,
//     },
//     organizationName: { type: String, required: true },
//     Region: { type: String, default: "Unknown" },
//     country: { type: String, default: "Unknown" },
//     TimeZone: { type: String, default: "UTC" },
//     PartnerLink: { type: String, default: "" },
//   },
//   { timestamps: true }
// );

// export const OrganizationModel = mongoose.model(
//   "Organization",
//   OrganizationSchema
// );
import mongoose from "mongoose";

const OrganizationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ---------------- BASIC INFO ----------------
    organizationName: { type: String, required: true },
    website: { type: String, default: "" },          // ✅ ADD
    address: { type: String, default: "" },          // ✅ ADD

    // ---------------- LOCATION ----------------
    Region: { type: String, default: "Unknown" },
    country: { type: String, default: "Unknown" },
    TimeZone: { type: String, default: "UTC" },

    // ---------------- CONTACT ----------------
    phone: { type: String, default: "" },             // ✅ ADD
    whatsapp: { type: String, default: "" },          // ✅ ADD
    PartnerLink: { type: String, default: "" },

    // ---------------- PROFESSIONAL ----------------
    hourlyRate: { type: Number, default: 0 },
    experienceYears: { type: Number, default: 0 },
    services: { type: String, default: "" },
  },
  { timestamps: true }
);

export const OrganizationModel = mongoose.model(
  "Organization",
  OrganizationSchema
);
