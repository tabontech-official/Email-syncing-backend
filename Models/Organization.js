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

    /*
     * Whether TimeZone is still managed automatically.
     *
     * True (the default) means nobody has chosen a zone, so the client
     * may adopt the browser's. It goes false the moment someone picks a
     * zone in settings, and detection leaves it alone from then on — a
     * deliberate choice must not be undone by travelling.
     */
    TimeZoneAuto: { type: Boolean, default: true },

    // ---------------- CONTACT ----------------
    phone: { type: String, default: "" },             // ✅ ADD
    whatsapp: { type: String, default: "" },          // ✅ ADD
    PartnerLink: { type: String, default: "" },

    // ---------------- PROFESSIONAL ----------------
    hourlyRate: { type: Number, default: 0 },
    experienceYears: { type: Number, default: 0 },
    services: { type: String, default: "" },

    // ---------------- UTILITIES CONFIG ----------------
    scenarioProperties: {
      maxRetries: { type: Number, default: 3 },
      delayTimeoutMinutes: { type: Number, default: 5 },
      autoAiFallback: { type: Boolean, default: true },
      logLevel: { type: String, default: "Detailed" },
      deduplicateIncomingEmails: { type: Boolean, default: true },
    },
    notificationOptions: {
      emailOnNewLead: { type: Boolean, default: true },
      emailOnCustomerReply: { type: Boolean, default: true },
      desktopPushAlerts: { type: Boolean, default: true },
      soundAlerts: { type: Boolean, default: false },
      dailySummaryEmail: { type: Boolean, default: true },
    },
    paymentMethod: {
      cardholderName: { type: String, default: "" },
      last4: { type: String, default: "4242" },
      brand: { type: String, default: "Visa" },
      expMonth: { type: String, default: "12" },
      expYear: { type: String, default: "28" },
      billingAddress: { type: String, default: "" },
      country: { type: String, default: "United States" },
      isSaved: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

export const OrganizationModel = mongoose.model(
  "Organization",
  OrganizationSchema
);
