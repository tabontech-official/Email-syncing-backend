import mongoose from "mongoose";
import { CompanyProfileModel } from "../Models/CompanyProfile.js";
import { isOwnerOrAdmin } from "../middleware/authmiddleware.js";

// GET /api/company-profile/:userId
export const getCompanyProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot access another user's company profile",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid User ID format",
      });
    }

    let profile = await CompanyProfileModel.findOne({ userId }).lean()

    if (!profile) {
      // Return empty default structure if profile does not exist yet
      profile = {
        userId,
        company: {
          companyName: "",
          businessDescription: "",
          industry: "",
          website: "",
          email: "",
          phone: "",
          address: "",
          socialLinks: { linkedin: "", twitter: "", facebook: "", instagram: "", youtube: "" },
        },
        services: [],
        products: [],
        portfolio: [],
        faqs: [],
        policies: {
          returnPolicy: "",
          refundPolicy: "",
          shippingPolicy: "",
          privacyPolicy: "",
          termsAndConditions: "",
          customPolicies: [],
        },
        timelines: {
          deliveryTime: "",
          projectTimeline: "",
          supportHours: "",
          businessWorkingHours: "",
        },
        writingStyle: {
          toneOfVoice: "",
          brandPersonality: "",
          communicationStyle: "",
          preferredLanguage: "English",
          wordsToAvoid: "",
          exampleResponses: "",
        },
        companyKnowledge: "",
        ragMetadata: {
          chunksCount: 0,
          status: "pending",
        },
      };
    }

    return res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error("❌ Error fetching Company Profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching company profile",
      error: error.message,
    });
  }
};

// PUT /api/company-profile/:userId (Create or Update)
export const saveCompanyProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot modify another user's company profile",
      });
    }

    const updateData = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid User ID format",
      });
    }

    // Set RAG status to pending so Step 2 can re-chunk on update
    if (updateData.companyKnowledge) {
      updateData.ragMetadata = {
        ...(updateData.ragMetadata || {}),
        status: "pending",
        lastEmbeddedAt: new Date(),
      };
    }

    const updatedProfile = await CompanyProfileModel.findOneAndUpdate(
      { userId },
      { $set: { ...updateData, userId } },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Company Profile saved successfully",
      data: updatedProfile,
    });
  } catch (error) {
    console.error("❌ Error saving Company Profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error saving company profile",
      error: error.message,
    });
  }
};
