import mongoose from "mongoose";

const CompanyProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
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
