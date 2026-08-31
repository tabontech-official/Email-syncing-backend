import { scenarioModel } from "../Models/Scenario.js";
import { ScenarioRunLogModel } from "../Models/ScenarioRunLog.js";
import { ConnectionModel } from "../Models/Connection.js";
import { mailhookModel } from "../Models/MailhookSchema.js";
import {
  loadPlatformRules,
  triggerForType,
} from "../utils/platformScenarioConfig.js";
import { authModel } from "../Models/auth.js";
import mongoose from "mongoose";
import { isOwnerOrAdmin, getAuthUserId } from "../middleware/authmiddleware.js";

export const addScenario = async (req, res) => {
  try {
    const authUserId = getAuthUserId(req);
    const userId = req.body.userId || authUserId;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ error: "Forbidden: You cannot create scenarios for another user" });
    }

    let requestedActive = req.body.hasOwnProperty("scenarioActive")
      ? Boolean(req.body.scenarioActive)
      : true;

    if (userId) {
      const user = await authModel.findById(userId);
      const plan = (user?.subscription?.plan || "Explore").toLowerCase();
      let maxActive = user?.subscription?.scenariosLimit || (plan === "elevate" ? 5 : plan === "unite" ? 15 : plan === "enterprise" ? 999 : 1);
      if (user?.subscription?.extraScenariosLimit) {
        maxActive += user.subscription.extraScenariosLimit;
      }

      const activeCount = await scenarioModel.countDocuments({
        userId,
        scenarioActive: true,
      });

      if (activeCount >= maxActive) {
        requestedActive = false;
      }
    }

    const scenario = new scenarioModel({
      ...req.body,
      userId,
      scenarioActive: requestedActive,
    });
    await scenario.save();

    res.status(201).json(scenario);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};


export const getUserScenarios = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ error: "Forbidden: You cannot access another user's scenarios" });
    }

    const scenarios = await scenarioModel.find({ userId });
    res.json(scenarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getSingleScenario = async (req, res) => {
  try {
    const scenario = await scenarioModel.findById(req.params.id);
    if (!scenario) return res.status(404).json({ message: "Not found" });

    if (!isOwnerOrAdmin(req, scenario.userId)) {
      return res.status(403).json({ error: "Forbidden: You cannot access another user's scenario" });
    }

    res.json(scenario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



export const updateScenario = async (req, res) => {
  try {
    const routerBranches = Array.isArray(req.body.routerBranches)
      ? req.body.routerBranches
      : [];

    const incomingLead = req.body.incomingLead || {};

    /*
     * Normalize incoming lead connection ID.
     * connectionId frontend se string, ObjectId ya array ki form mein aa sakti hai.
     */
    const rawIncomingConnectionId = Array.isArray(incomingLead.connectionId)
      ? incomingLead.connectionId[0]
      : incomingLead.connectionId;

    const incomingConnectionId =
      typeof rawIncomingConnectionId === "string"
        ? rawIncomingConnectionId.trim()
        : rawIncomingConnectionId?.toString?.().trim() || "";

    const incomingSubjectFilter =
      typeof incomingLead.subjectFilter === "string"
        ? incomingLead.subjectFilter.trim()
        : "";

    /*
     * Mailhook trigger: leads arrive by forwarding to the user's mailhook
     * address, so there is no Connection to validate. The chosen mailhook
     * card is checked against the mailhook collection instead, further
     * down, once the scenario owner is known.
     */
    const isMailhookTrigger =
      (incomingLead.app?.name || "").toLowerCase() === "mailhook";

    const rawIncomingMailhookId = Array.isArray(incomingLead.mailhookId)
      ? incomingLead.mailhookId[0]
      : incomingLead.mailhookId;

    const incomingMailhookId =
      typeof rawIncomingMailhookId === "string"
        ? rawIncomingMailhookId.trim()
        : rawIncomingMailhookId?.toString?.().trim() || "";

    /*
     * Saari email connections collect karenge.
     */
    const connectionIds = [];
    let missingConnectionFound = false;

    /*
     * Incoming Leads trigger validation.
     *
     * Agar trigger enabled hai, subject filter diya hua hai,
     * ya incomingLead object frontend se configure hokar aaya hai,
     * to connection required hogi.
     */
    const incomingLeadConfigured = Boolean(
      incomingLead.enabled ||
        incomingConnectionId ||
        incomingMailhookId ||
        incomingSubjectFilter
    );

    if (incomingLeadConfigured && !isMailhookTrigger) {
      if (!incomingConnectionId) {
        missingConnectionFound = true;
      } else {
        connectionIds.push(incomingConnectionId);
      }
    }

    /*
     * Router modules ki connections validate karein.
     */
    routerBranches.forEach((branch) => {
      const modules = Array.isArray(branch.modules)
        ? branch.modules
        : [];

      modules.forEach((module) => {
        const appName =
          typeof module.app?.name === "string"
            ? module.app.name.toLowerCase()
            : "";

        const moduleType =
          typeof module.type === "string"
            ? module.type.toLowerCase()
            : "";

        const isDelayModule =
          appName.includes("delay") ||
          moduleType.includes("delay");

        const isEmailModule =
          !isDelayModule &&
          (
            appName.includes("email") ||
            appName.includes("gmail") ||
            appName.includes("follow") ||
            appName.includes("initial") ||
            moduleType.includes("email") ||
            moduleType.includes("gmail")
          );

        if (!isEmailModule) {
          return;
        }

        const rawConnectionId = Array.isArray(module.connectionId)
          ? module.connectionId[0]
          : module.connectionId;

        const connectionId =
          typeof rawConnectionId === "string"
            ? rawConnectionId.trim()
            : rawConnectionId?.toString?.().trim() || "";

        if (!connectionId) {
          missingConnectionFound = true;
        } else {
          connectionIds.push(connectionId);
        }
      });
    });

    /*
     * Duplicate IDs hata dein.
     */
    const uniqueConnectionIds = [...new Set(connectionIds)];

    /*
     * MongoDB ObjectId format validate karein.
     */
    const invalidFormatIds = uniqueConnectionIds.filter(
      (connectionId) => !mongoose.Types.ObjectId.isValid(connectionId)
    );

    if (invalidFormatIds.length > 0) {
      console.warn(
        "[updateScenario] Invalid connection ID format:",
        invalidFormatIds
      );

      missingConnectionFound = true;
    }

    const validFormatConnectionIds = uniqueConnectionIds.filter(
      (connectionId) => mongoose.Types.ObjectId.isValid(connectionId)
    );

    /*
     * Check karein ke connections database mein mojood aur active hain.
     */
    if (validFormatConnectionIds.length > 0) {
      const validConnections = await ConnectionModel.find({
        _id: {
          $in: validFormatConnectionIds,
        },
        status: "active",
      }).select("_id");

      const validConnectionIds = new Set(
        validConnections.map((connection) =>
          connection._id.toString()
        )
      );

      const inactiveOrMissingIds =
        validFormatConnectionIds.filter(
          (connectionId) =>
            !validConnectionIds.has(connectionId)
        );

      if (inactiveOrMissingIds.length > 0) {
        console.warn(
          "[updateScenario] Inactive or missing connections:",
          inactiveOrMissingIds
        );

        missingConnectionFound = true;
      }
    }

    const existingScenario = await scenarioModel.findById(req.params.id);
    if (!existingScenario) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found.",
      });
    }

    if (!isOwnerOrAdmin(req, existingScenario.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot update another user's scenario",
      });
    }

    /*
     * Validate the mailhook trigger the same way connections are validated:
     * it must belong to this user and be verified. An unverified mailhook
     * is one nothing has actually been forwarded to, so a scenario built on
     * it would sit active and never fire.
     */
    let validMailhookId = null;

    if (isMailhookTrigger && incomingLeadConfigured) {
      if (
        !incomingMailhookId ||
        !mongoose.Types.ObjectId.isValid(incomingMailhookId)
      ) {
        console.warn(
          "[updateScenario] Mailhook trigger without a valid mailhook ID:",
          incomingMailhookId
        );

        missingConnectionFound = true;
      } else {
        const mailhookCard = await mailhookModel
          .findOne({
            _id: incomingMailhookId,
            userId: existingScenario.userId,
          })
          .select("_id connectionVerified");

        if (!mailhookCard || !mailhookCard.connectionVerified) {
          console.warn(
            "[updateScenario] Missing or unverified mailhook:",
            incomingMailhookId
          );

          missingConnectionFound = true;
        } else {
          validMailhookId = mailhookCard._id.toString();
        }
      }
    }

    /*
     * Check requested active status and enforce user subscription plan limit!
     */
    let requestedActive = req.body.hasOwnProperty("scenarioActive")
      ? Boolean(req.body.scenarioActive)
      : (existingScenario?.scenarioActive ?? true);

    const userId = req.body.userId || existingScenario?.userId;

    if (requestedActive && userId) {
      const user = await authModel.findById(userId);
      const plan = (user?.subscription?.plan || "Explore").toLowerCase();
      let maxActive = user?.subscription?.scenariosLimit || (plan === "elevate" ? 5 : plan === "unite" ? 15 : plan === "enterprise" ? 999 : 1);
      if (user?.subscription?.extraScenariosLimit) {
        maxActive += user.subscription.extraScenariosLimit;
      }

      const otherActiveCount = await scenarioModel.countDocuments({
        userId,
        _id: { $ne: req.params.id },
        scenarioActive: true,
      });

      if (otherActiveCount >= maxActive) {
        requestedActive = false;
      }
    }

    const scenarioActive = !missingConnectionFound && requestedActive;

    /*
     * Incoming lead enabled tab hoga jab connection aur
     * subject filter dono available hon.
     *
     * Agar aap subject filter optional rakhna chahte hain to
     * yahan se incomingSubjectFilter condition remove kar dein.
     */
    /*
     * A built-in scenario carries no subject filter of its own — it follows
     * the platform trigger the owner configures in the master admin panel.
     * Requiring a stored filter here would leave those scenarios permanently
     * disabled, so the platform default counts as configured.
     */
    const platformRules = await loadPlatformRules();

    const effectiveSubjectFilter =
      incomingSubjectFilter ||
      triggerForType(platformRules, req.body.type || existingScenario.type)
        ?.subjectFilter ||
      "";

    const incomingLeadEnabled = isMailhookTrigger
      ? Boolean(validMailhookId && effectiveSubjectFilter)
      : Boolean(
          incomingConnectionId &&
            effectiveSubjectFilter &&
            !invalidFormatIds.includes(incomingConnectionId)
        );

    const updateData = {
      name:
        typeof req.body.name === "string"
          ? req.body.name.trim()
          : "",

      description:
        typeof req.body.description === "string"
          ? req.body.description
          : "",

      type: req.body.type || "other",

      incomingLead: {
        app: {
          name: incomingLead.app?.name || "Gmail",
          color: incomingLead.app?.color || "",
          icon: incomingLead.app?.icon || "",
        },

        connectionId: isMailhookTrigger
          ? null
          : incomingConnectionId || null,

        mailhookId: isMailhookTrigger ? validMailhookId : null,

        subjectFilter: incomingSubjectFilter,

        pollInterval:
          Number(incomingLead.pollInterval) > 0
            ? Number(incomingLead.pollInterval)
            : 60,

        enabled: incomingLeadEnabled,
      },

      routerBranches: routerBranches.map((branch) => ({
        id: branch.id,

        hasModule: Boolean(branch.hasModule),

        condition:
          typeof branch.condition === "string"
            ? branch.condition
            : null,

        filter: {
          label: branch.filter?.label || "",

          conditions: Array.isArray(
            branch.filter?.conditions
          )
            ? branch.filter.conditions.map((condition) => ({
                field: condition.field || "",
                operator: condition.operator || "",
                value: condition.value || "",
                join: ["AND", "OR"].includes(condition.join)
                  ? condition.join
                  : null,
              }))
            : [],

          template: branch.filter?.template || "",
        },

        modules: Array.isArray(branch.modules)
          ? branch.modules.map((module) => {
              const rawModuleConnectionId = Array.isArray(
                module.connectionId
              )
                ? module.connectionId[0]
                : module.connectionId;

              const moduleConnectionId =
                typeof rawModuleConnectionId === "string"
                  ? rawModuleConnectionId.trim()
                  : rawModuleConnectionId
                      ?.toString?.()
                      .trim() || "";

              return {
                id: module.id,

                type: module.type || "",

                description: module.description || "",

                subject: module.subject || "",

                to: module.to || "",

                cc: Array.isArray(module.cc)
                  ? module.cc.filter(Boolean)
                  : [],

                bcc: Array.isArray(module.bcc)
                  ? module.bcc.filter(Boolean)
                  : [],

                connectionId: moduleConnectionId,

                /*
                 * This mapping is a whitelist — anything not listed is
                 * dropped on save, so the builder's Manual/AI choice and
                 * the profile it writes from have to be named here.
                 */
                replyMode: module.replyMode === "ai" ? "ai" : "manual",

                companyProfileId:
                  module.replyMode === "ai" && module.companyProfileId
                    ? module.companyProfileId
                    : null,

                template: module.template || "",

                delayValue:
                  module.delayValue !== undefined &&
                  module.delayValue !== null &&
                  module.delayValue !== ""
                    ? Number(module.delayValue)
                    : null,

                delayUnit: module.delayUnit || null,

                app: {
                  name: module.app?.name || "",
                  color: module.app?.color || "",
                  icon: module.app?.icon || "",
                },

                position: {
                  x:
                    Number.isFinite(
                      Number(module.position?.x)
                    )
                      ? Number(module.position.x)
                      : 200,

                  y:
                    Number.isFinite(
                      Number(module.position?.y)
                    )
                      ? Number(module.position.y)
                      : 200,
                },

                filter: {
                  label: module.filter?.label || "",

                  conditions: Array.isArray(
                    module.filter?.conditions
                  )
                    ? module.filter.conditions.map(
                        (condition) => ({
                          field: condition.field || "",
                          operator:
                            condition.operator || "",
                          value: condition.value || "",
                          join: ["AND", "OR"].includes(
                            condition.join
                          )
                            ? condition.join
                            : null,
                        })
                      )
                    : [],

                  template:
                    module.filter?.template || "",
                },

                emailType: module.emailType || "",
              };
            })
          : [],
      })),

      rfNodes: Array.isArray(req.body.rfNodes) ? req.body.rfNodes : [],
      rfEdges: Array.isArray(req.body.rfEdges) ? req.body.rfEdges : [],
      scenarioActive,
    };

    const updatedScenario =
      await scenarioModel.findByIdAndUpdate(
        req.params.id,
        {
          $set: updateData,
        },
        {
          new: true,
          runValidators: true,
        }
      );

    if (!updatedScenario) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found.",
      });
    }

    return res.status(200).json({
      success: true,

      message: scenarioActive
        ? "Scenario updated and activated successfully."
        : "Scenario updated but deactivated because one or more connections are missing, invalid, or inactive.",

      scenarioActive,

      updated: updatedScenario,
    });
  } catch (error) {
    console.error("[updateScenario] Error:", error);

    return res.status(400).json({
      success: false,
      message:
        error?.message ||
        "Unable to update scenario.",
    });
  }
};


export const deleteScenario = async (req, res) => {
  try {
    const scenarioId = req.params.id;
    const scenario = await scenarioModel.findById(scenarioId);

    if (!scenario) {
      return res.status(404).json({ message: "Scenario not found" });
    }

    if (!isOwnerOrAdmin(req, scenario.userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot delete another user's scenario",
      });
    }

    if (scenario.type === "shopify") {
      return res.status(403).json({
        success: false,
        message: "Shopify prebuilt system scenarios cannot be deleted.",
      });
    }

    await scenarioModel.findByIdAndDelete(scenarioId);
    await ScenarioRunLogModel.deleteMany({ scenarioId });
    res.json({ message: "Scenario and its run history deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


export const getShopifyScenarioByUserId = async (req, res) => {
  try {
    const { userId } = req.body; 

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const scenario = await scenarioModel.findOne({
      userId: userId,
      type: "shopify",
    });

    if (!scenario) {
      return res.status(404).json({ message: "Shopify scenario not found" });
    }

    res.json(scenario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};



export const getScenarioStatsForAdmin = async (req, res) => {
  try {
    const [users, scenarios] = await Promise.all([
      authModel.find({}, "fullName email").lean(),
      scenarioModel.find({}).lean(),
    ]);

    const summary = users.map((user) => {
      const userId = String(user._id);
      const userScenarios = scenarios.filter(
        (s) => String(s.userId) === userId
      );

      const totalScenarios = userScenarios.length;
      const activeScenarios = userScenarios.filter(
        (s) => s.scenarioActive
      ).length;
      const inactiveScenarios = totalScenarios - activeScenarios;

      let totalModules = 0;
      let totalDelays = 0;
      let totalFilters = 0;

      userScenarios.forEach((scenario) => {
        scenario.routerBranches.forEach((branch) => {
          totalFilters += branch.filter?.conditions?.length || 0;
          branch.modules.forEach((mod) => {
            totalModules += 1;
            if (mod.type === "Delay") totalDelays += 1;
          });
        });
      });

      return {
        user,
        totalScenarios,
        activeScenarios,
        inactiveScenarios,
        totalModules,
        totalDelays,
        totalFilters,
        scenarios: userScenarios.map((s) => ({
          name: s.name,
          type: s.type,
          active: s.scenarioActive,
          totalBranches: s.routerBranches.length,
          totalModules: s.routerBranches.reduce(
            (acc, b) => acc + b.modules.length,
            0
          ),
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      };
    });

    const filtered = summary.filter((s) => s.totalScenarios > 0);
    res.json({ success: true, data: filtered });
  } catch (error) {
    console.error("Error in scenario stats:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/*
 * GET /scenario/trigger-defaults
 *
 * The platform trigger defaults, readable by any signed-in user. The
 * scenario builder shows the Shopify subject filter as a read-only field;
 * without this it would keep displaying a hardcoded string while the
 * platform matched on whatever the owner configured. No secrets here —
 * just the subjects that classify a lead.
 */
export const getScenarioTriggerDefaults = async (req, res) => {
  try {
    const rules = await loadPlatformRules();

    return res.status(200).json({
      success: true,
      triggers: Object.values(rules.triggers),
      /* The router's service condition, shown on the scenario card. */
      services: rules.services,
    });
  } catch (error) {
    console.error("[getScenarioTriggerDefaults] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load scenario trigger defaults",
      error: error.message,
    });
  }
};
