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

    /*
     * Now resolves the user's DEFAULT profile. Callers that predate
     * multi-profile support keep working unchanged; the page uses the
     * per-profile routes below.
     */
    let profile = await resolveDefaultProfile(userId);

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

    /*
     * Writes the DEFAULT profile. Targeting { userId } alone would now
     * match whichever profile Mongo returned first, so the id is resolved
     * explicitly and only falls back to creating one when none exists.
     */
    const current = await resolveDefaultProfile(userId);

    const updatedProfile = current
      ? await CompanyProfileModel.findByIdAndUpdate(
          current._id,
          { $set: updateData },
          { new: true, runValidators: true }
        )
      : await CompanyProfileModel.create({
          ...updateData,
          userId,
          isDefault: true,
        });

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

/*
|--------------------------------------------------------------------------
| Multi-profile endpoints
|--------------------------------------------------------------------------
|
| A user keeps several company profiles — one per brand, client or product
| line — and a scenario names which one its AI replies write from.
|
| The two original endpoints (GET/PUT by :userId) still work and now act on
| the user's DEFAULT profile, so existing callers keep functioning while the
| UI moves over.
*/

/* The profile an AI reply falls back to when a scenario names none. */
export const resolveDefaultProfile = async (userId) => {
  const byFlag = await CompanyProfileModel.findOne({
    userId,
    isDefault: true,
    isActive: { $ne: false },
  }).lean();

  if (byFlag) return byFlag;

  /*
   * Falls through when the default has been paused, or on accounts that
   * predate both flags. Prefers an active profile, then anything at all —
   * an AI reply with a paused profile still beats one with no context.
   */
  return (
    (await CompanyProfileModel.findOne({ userId, isActive: { $ne: false } })
      .sort({ createdAt: 1 })
      .lean()) ||
    (await CompanyProfileModel.findOne({ userId }).sort({ createdAt: 1 }).lean())
  );
};

const displayName = (profile, index = 0) =>
  profile.profileName ||
  profile.company?.companyName ||
  `Profile ${index + 1}`;

// GET /api/company-profile/:userId/list
export const listCompanyProfiles = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot access another user's profiles",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid User ID format" });
    }

    const profiles = await CompanyProfileModel.find({ userId })
      .select(
        "profileName isDefault isActive company.companyName company.businessDescription company.industry services faqs companyKnowledge updatedAt"
      )
      .sort({ isDefault: -1, createdAt: 1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: profiles.map((p, i) => ({
        _id: p._id,
        name: displayName(p, i),
        companyName: p.company?.companyName || "",
        industry: p.company?.industry || "",
        /* The oldest profile is the effective default when no flag is set. */
        isDefault:
          p.isDefault === true ||
          (i === 0 && !profiles.some((x) => x.isDefault)),
        /* Profiles created before this flag existed are treated as active. */
        isActive: p.isActive !== false,
        /*
         * The minimum an AI reply needs to say anything useful. Surfaced
         * so a picker can warn before a scenario is pointed at a profile
         * that would produce empty, generic mail.
         */
        isComplete: Boolean(
          p.company?.companyName?.trim() &&
            p.company?.businessDescription?.trim()
        ),
        hasContext: Boolean(
          (p.services || []).length ||
            (p.faqs || []).length ||
            (p.companyKnowledge || "").trim()
        ),
        updatedAt: p.updatedAt,
      })),
    });
  } catch (error) {
    console.error("Error listing company profiles:", error);
    return res.status(500).json({
      success: false,
      message: "Server error listing company profiles",
      error: error.message,
    });
  }
};

// POST /api/company-profile/:userId  (create an additional profile)
export const createCompanyProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot create profiles for another user",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid User ID format" });
    }

    const name = String(req.body?.profileName || "").trim();

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "A profile name is required." });
    }

    const existingCount = await CompanyProfileModel.countDocuments({ userId });

    const created = await CompanyProfileModel.create({
      ...(req.body || {}),
      userId,
      profileName: name,
      /* The first profile an account ever gets is its default. */
      isDefault: existingCount === 0,
    });

    return res.status(201).json({
      success: true,
      message: "Company profile created",
      data: created,
    });
  } catch (error) {
    console.error("Error creating company profile:", error);

    /*
     * A duplicate-key error here means the collection still carries the
     * unique index on userId from before profiles could be plural.
     * Dropping `unique: true` from the schema does NOT drop the index that
     * is already built in MongoDB — it has to be dropped on the
     * collection. Reported specifically because the generic 500 gave no
     * hint at the actual cause.
     */
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message:
          "This database still has a unique index on companyprofiles.userId, which allows only one profile per user. Drop the userId_1 index and recreate it non-unique.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error creating company profile",
      error: error.message,
    });
  }
};

// GET /api/company-profile/detail/:profileId
export const getCompanyProfileById = async (req, res) => {
  try {
    const { profileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profile ID" });
    }

    const profile = await CompanyProfileModel.findById(profileId).lean();

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found" });
    }

    if (!isOwnerOrAdmin(req, profile.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot access another user's profile",
      });
    }

    return res.status(200).json({ success: true, data: profile });
  } catch (error) {
    console.error("Error fetching company profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error fetching company profile",
      error: error.message,
    });
  }
};

// PUT /api/company-profile/detail/:profileId
export const updateCompanyProfileById = async (req, res) => {
  try {
    const { profileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profile ID" });
    }

    const existing = await CompanyProfileModel.findById(profileId).select("userId");

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found" });
    }

    if (!isOwnerOrAdmin(req, existing.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot modify another user's profile",
      });
    }

    const updateData = { ...(req.body || {}) };

    /* userId and isDefault are not editable through this route. */
    delete updateData.userId;
    delete updateData.isDefault;

    if (updateData.companyKnowledge) {
      updateData.ragMetadata = {
        ...(updateData.ragMetadata || {}),
        status: "pending",
        lastEmbeddedAt: new Date(),
      };
    }

    const updated = await CompanyProfileModel.findByIdAndUpdate(
      profileId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      success: true,
      message: "Company Profile saved successfully",
      data: updated,
    });
  } catch (error) {
    console.error("Error updating company profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating company profile",
      error: error.message,
    });
  }
};

// PATCH /api/company-profile/detail/:profileId/default
export const setDefaultCompanyProfile = async (req, res) => {
  try {
    const { profileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profile ID" });
    }

    const profile = await CompanyProfileModel.findById(profileId).select("userId");

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found" });
    }

    if (!isOwnerOrAdmin(req, profile.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot modify another user's profiles",
      });
    }

    /* Exactly one default per user. */
    await CompanyProfileModel.updateMany(
      { userId: profile.userId },
      { $set: { isDefault: false } }
    );

    await CompanyProfileModel.findByIdAndUpdate(profileId, {
      $set: { isDefault: true },
    });

    return res
      .status(200)
      .json({ success: true, message: "Default profile updated" });
  } catch (error) {
    console.error("Error setting default profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error setting default profile",
      error: error.message,
    });
  }
};

// DELETE /api/company-profile/detail/:profileId
export const deleteCompanyProfile = async (req, res) => {
  try {
    const { profileId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profile ID" });
    }

    const profile = await CompanyProfileModel.findById(profileId).select(
      "userId isDefault"
    );

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found" });
    }

    if (!isOwnerOrAdmin(req, profile.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot delete another user's profile",
      });
    }

    const total = await CompanyProfileModel.countDocuments({
      userId: profile.userId,
    });

    /*
     * The last profile stays: AI replies have nothing to write from
     * without one, and scenarios pointing at it would silently stop.
     */
    if (total <= 1) {
      return res.status(400).json({
        success: false,
        message:
          "This is your only company profile. Create another before deleting this one.",
      });
    }

    await CompanyProfileModel.findByIdAndDelete(profileId);

    /* Never leave an account without a default. */
    if (profile.isDefault) {
      const next = await CompanyProfileModel.findOne({ userId: profile.userId })
        .sort({ createdAt: 1 })
        .select("_id");

      if (next) {
        await CompanyProfileModel.findByIdAndUpdate(next._id, {
          $set: { isDefault: true },
        });
      }
    }

    return res.status(200).json({ success: true, message: "Profile deleted" });
  } catch (error) {
    console.error("Error deleting company profile:", error);
    return res.status(500).json({
      success: false,
      message: "Server error deleting company profile",
      error: error.message,
    });
  }
};

// PATCH /api/company-profile/detail/:profileId/active
export const setCompanyProfileActive = async (req, res) => {
  try {
    const { profileId } = req.params;
    const isActive = req.body?.isActive !== false;

    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid profile ID" });
    }

    const profile = await CompanyProfileModel.findById(profileId).select(
      "userId isDefault"
    );

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Profile not found" });
    }

    if (!isOwnerOrAdmin(req, profile.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot modify another user's profile",
      });
    }

    /*
     * Refuse to leave an account with nothing for AI replies to write
     * from. Pausing the last active profile would silently degrade every
     * scenario set to reply with AI.
     */
    if (!isActive) {
      const otherActive = await CompanyProfileModel.countDocuments({
        userId: profile.userId,
        _id: { $ne: profileId },
        isActive: { $ne: false },
      });

      if (otherActive === 0) {
        return res.status(400).json({
          success: false,
          message:
            "This is your only active profile. Activate another before pausing this one.",
        });
      }
    }

    await CompanyProfileModel.findByIdAndUpdate(profileId, {
      $set: { isActive },
    });

    return res.status(200).json({
      success: true,
      message: isActive ? "Profile activated" : "Profile paused",
    });
  } catch (error) {
    console.error("Error updating profile status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error updating profile status",
      error: error.message,
    });
  }
};
