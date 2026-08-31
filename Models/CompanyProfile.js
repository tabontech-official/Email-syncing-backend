import mongoose from "mongoose";

const CompanyProfileSchema = new mongoose.Schema(
  {
    /*
     * No longer unique: a user keeps several profiles — one per brand,
     * client or product line — and picks which one an AI reply writes
     * from. The unique index that used to be here is what limited every
     * account to a single profile.
     */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* How the profile is named in pickers. Falls back to the company name. */
    profileName: {
      type: String,
      default: "",
      trim: true,
    },

    /*
     * Used when a scenario asks for AI replies without naming a profile,
     * and for accounts that predate multi-profile support.
     */
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },

    /*
     * An inactive profile is kept but not offered to scenarios — a brand
     * you have paused, or a client you no longer write for. Distinct from
     * deleting it, which would break scenarios still pointing at it.
     */
    isActive: {
      type: Boolean,
      default: true,
    },

    // 1. Company Information
    company: {
      companyName: { type: String, default: "" },
      businessDescription: { type: String, default: "" },
      industry: { type: String, default: "" },
      website: { type: String, default: "" },
      email: { type: String, default: "" },
      phone: { type: String, default: "" },
      address: { type: String, default: "" },
      socialLinks: {
        linkedin: { type: String, default: "" },
        twitter: { type: String, default: "" },
        facebook: { type: String, default: "" },
        instagram: { type: String, default: "" },
        youtube: { type: String, default: "" },
      },
    },

    // 2. Dynamic Services
    services: [
      {
        id: { type: String },
        name: { type: String, default: "" },
        description: { type: String, default: "" },
      },
    ],

    // 3. Dynamic Products
    products: [
      {
        id: { type: String },
        name: { type: String, default: "" },
        description: { type: String, default: "" },
        features: { type: String, default: "" },
      },
    ],

    // 4. Portfolio Projects
    portfolio: [
      {
        id: { type: String },
        projectName: { type: String, default: "" },
        description: { type: String, default: "" },
        links: { type: String, default: "" },
      },
    ],

    // 5. FAQs
    faqs: [
      {
        id: { type: String },
        question: { type: String, default: "" },
        answer: { type: String, default: "" },
      },
    ],

    // 6. Policies
    policies: {
      returnPolicy: { type: String, default: "" },
      refundPolicy: { type: String, default: "" },
      shippingPolicy: { type: String, default: "" },
      privacyPolicy: { type: String, default: "" },
      termsAndConditions: { type: String, default: "" },
      customPolicies: [
        {
          id: { type: String },
          name: { type: String, default: "" },
          details: { type: String, default: "" },
        },
      ],
    },

    // 7. Timelines
    timelines: {
      deliveryTime: { type: String, default: "" },
      projectTimeline: { type: String, default: "" },
      supportHours: { type: String, default: "" },
      businessWorkingHours: { type: String, default: "" },
    },

    // 8. Writing Style & Tone
    writingStyle: {
      toneOfVoice: { type: String, default: "" },
      brandPersonality: { type: String, default: "" },
      communicationStyle: { type: String, default: "" },
      preferredLanguage: { type: String, default: "English" },
      wordsToAvoid: { type: String, default: "" },
      exampleResponses: { type: String, default: "" },
    },

    // Company Knowledge Base (Primary RAG Source)
    companyKnowledge: { type: String, default: "" },

    // Prepared for Step 2 RAG Chunking & Vectors
    ragMetadata: {
      chunksCount: { type: Number, default: 0 },
      lastEmbeddedAt: { type: Date, default: null },
      status: {
        type: String,
        enum: ["pending", "chunked", "indexed", "failed"],
        default: "pending",
      },
      vectorIndexName: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

export const CompanyProfileModel = mongoose.model(
  "CompanyProfile",
  CompanyProfileSchema
);
