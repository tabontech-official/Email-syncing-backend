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

      // Free plan (Explore) allows only 1 Shopify scenario
      if ((plan === "explore" || !plan) && req.body.type === "shopify") {
        const existingShopifyCount = await scenarioModel.countDocuments({
          userId,
          type: "shopify",
        });

        if (existingShopifyCount >= 1) {
          return res.status(403).json({
            error: "Free plan includes 1 prebuilt Shopify scenario. Upgrade to Elevate or Unite to build multiple Shopify scenarios.",
          });
        }
      }

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

    const routerBranches = req.body.hasOwnProperty("routerBranches") && Array.isArray(req.body.routerBranches)
      ? req.body.routerBranches
      : (existingScenario.routerBranches || []);

    const incomingLead = req.body.hasOwnProperty("incomingLead") && typeof req.body.incomingLead === "object" && req.body.incomingLead !== null
      ? req.body.incomingLead
      : (existingScenario.incomingLead || {});

    /*
     * Normalize incoming lead connection ID.
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
        : (existingScenario.incomingLead?.subjectFilter || "");

    const appName = incomingLead.app?.name || existingScenario.incomingLead?.app?.name || "Gmail";
    const isMailhookTrigger = appName.toLowerCase() === "mailhook";

    const rawIncomingMailhookId = Array.isArray(incomingLead.mailhookId)
      ? incomingLead.mailhookId[0]
      : incomingLead.mailhookId;

    const incomingMailhookId =
      typeof rawIncomingMailhookId === "string"
        ? rawIncomingMailhookId.trim()
        : rawIncomingMailhookId?.toString?.().trim() || (existingScenario.incomingLead?.mailhookId?.toString?.() || "");

    const connectionIds = [];
    let missingConnectionFound = false;

    /*
     * Why activation was refused, in the client's words.
     *
     * A scenario that cannot activate used to fail silently: the flag was
     * written as false and the response said nothing about it, so the
     * builder showed the switch as On until the next reload. Every branch
     * that sets missingConnectionFound now records what it objected to,
     * and the response carries it back so the UI can name the problem.
     */
    const blockers = [];

    const addBlocker = (blocker) => {
      missingConnectionFound = true;
      blockers.push(blocker);
    };

    /* Which step the connection belongs to, for the message. */
    const connectionRoles = new Map();

    const noteConnectionRole = (connectionId, role) => {
      const existing = connectionRoles.get(connectionId);
      if (existing && !existing.includes(role)) {
        connectionRoles.set(connectionId, `${existing}, ${role}`);
        return;
      }
      if (!existing) connectionRoles.set(connectionId, role);
    };

    const incomingLeadConfigured = Boolean(
      incomingLead.enabled ||
        incomingConnectionId ||
        incomingMailhookId ||
        incomingSubjectFilter
    );

    if (incomingLeadConfigured && !isMailhookTrigger) {
      if (!incomingConnectionId) {
        addBlocker({
          code: "inbox_missing",
          role: "trigger inbox",
          message: "No inbox is connected for the trigger.",
        });
      } else {
        connectionIds.push(incomingConnectionId);
        noteConnectionRole(incomingConnectionId, "trigger inbox");
      }
    }

    routerBranches.forEach((branch) => {
      const modules = Array.isArray(branch.modules)
        ? branch.modules
        : [];

      modules.forEach((module) => {
        const modAppName =
          typeof module.app?.name === "string"
            ? module.app.name.toLowerCase()
            : "";

        const moduleType =
          typeof module.type === "string"
            ? module.type.toLowerCase()
            : "";

        const isDelayModule =
          modAppName.includes("delay") ||
          moduleType.includes("delay");

        const isEmailModule =
          !isDelayModule &&
          (
            modAppName.includes("email") ||
            modAppName.includes("gmail") ||
            modAppName.includes("follow") ||
            modAppName.includes("initial") ||
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

        const stepName = module.app?.name || module.type || "an email step";

        if (!connectionId) {
          addBlocker({
            code: "sender_missing",
            role: stepName,
            message: `"${stepName}" has no sending account selected.`,
          });
        } else {
          connectionIds.push(connectionId);
          noteConnectionRole(connectionId, stepName);
        }
      });
    });

    const uniqueConnectionIds = [...new Set(connectionIds)];

    const invalidFormatIds = uniqueConnectionIds.filter(
      (connectionId) => !mongoose.Types.ObjectId.isValid(connectionId)
    );

    invalidFormatIds.forEach((connectionId) => {
      addBlocker({
        code: "connection_invalid",
        role: connectionRoles.get(connectionId) || "a step",
        message: `The account selected for ${connectionRoles.get(connectionId) || "a step"} is not a valid connection.`,
      });
    });

    const validFormatConnectionIds = uniqueConnectionIds.filter(
      (connectionId) => mongoose.Types.ObjectId.isValid(connectionId)
    );

    if (validFormatConnectionIds.length > 0) {
      /*
       * Fetched WITHOUT the status filter so a rejected connection can be
       * described rather than just counted. An expired OAuth grant is the
       * common case and it is fixable by the user — but only if the
       * response says which mailbox needs signing in again.
       */
      const foundConnections = await ConnectionModel.find({
        _id: {
          $in: validFormatConnectionIds,
        },
      }).select("_id email provider status lastConnectionError");

      const byId = new Map(
        foundConnections.map((connection) => [
          connection._id.toString(),
          connection,
        ])
      );

      validFormatConnectionIds.forEach((connectionId) => {
        const role = connectionRoles.get(connectionId) || "a step";
        const connection = byId.get(connectionId);

        if (!connection) {
          addBlocker({
            code: "connection_missing",
            role,
            connectionId,
            message: `The account selected for ${role} no longer exists. Choose another one.`,
          });
          return;
        }

        /*
         * A row predating the status field is active by the schema's own
         * default, and that is what the connections API reports for it.
         * The old query filtered on status server-side, so those rows were
         * rejected while the UI showed them as fine — the same disagreement
         * this change exists to remove, one row-shape further down.
         */
        if (!connection.status || connection.status === "active") return;

        const label = connection.email || "this account";

        if (connection.status === "reauth_required") {
          addBlocker({
            code: "reauth_required",
            role,
            connectionId,
            email: connection.email || "",
            provider: connection.provider || "",
            status: connection.status,
            message: `${label} needs to be reconnected — its sign-in has expired. Reconnect it to activate this scenario.`,
          });
          return;
        }

        addBlocker({
          code: "connection_disconnected",
          role,
          connectionId,
          email: connection.email || "",
          provider: connection.provider || "",
          status: connection.status,
          message: `${label} is disconnected. Reconnect it to activate this scenario.`,
        });
      });
    }

    let validMailhookId = null;

    if (isMailhookTrigger && incomingLeadConfigured) {
      if (
        !incomingMailhookId ||
        !mongoose.Types.ObjectId.isValid(incomingMailhookId)
      ) {
        addBlocker({
          code: "mailhook_missing",
          role: "trigger inbox",
          message: "No mailhook is selected for the trigger.",
        });
      } else {
        const mailhookCard = await mailhookModel
          .findOne({
            _id: incomingMailhookId,
            userId: existingScenario.userId,
          })
          .select("_id connectionVerified");

        if (!mailhookCard || !mailhookCard.connectionVerified) {
          addBlocker({
            code: "mailhook_unverified",
            role: "trigger inbox",
            message:
              "The selected mailhook is not verified yet — confirm forwarding to finish setup.",
          });
        } else {
          validMailhookId = mailhookCard._id.toString();
        }
      }
    }

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
        blockers.push({
          code: "active_limit_reached",
          role: "plan limit",
          limit: maxActive,
          plan: user?.subscription?.plan || "Explore",
          message: `Your plan allows ${maxActive} active scenario${maxActive === 1 ? "" : "s"}. Pause another scenario or upgrade to activate this one.`,
        });
      }
    }

    const scenarioActive = !missingConnectionFound && requestedActive;

    /*
     * Only meaningful when the caller asked for On and did not get it —
     * a save that never requested activation is not "blocked".
     */
    const activationBlocked = Boolean(
      req.body.hasOwnProperty("scenarioActive") &&
        Boolean(req.body.scenarioActive) &&
        !scenarioActive
    );

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
        typeof req.body.name === "string" && req.body.name.trim() !== ""
          ? req.body.name.trim()
          : (existingScenario.name || "Untitled Scenario"),

      description:
        typeof req.body.description === "string"
          ? req.body.description
          : (existingScenario.description || ""),

      type: req.body.type || existingScenario.type || "other",

      incomingLead: {
        app: {
          name: incomingLead.app?.name || existingScenario.incomingLead?.app?.name || "Gmail",
          color: incomingLead.app?.color || existingScenario.incomingLead?.app?.color || "",
          icon: incomingLead.app?.icon || existingScenario.incomingLead?.app?.icon || "",
        },

        connectionId: isMailhookTrigger
          ? null
          : incomingConnectionId || (existingScenario.incomingLead?.connectionId ? String(existingScenario.incomingLead.connectionId) : null),

        mailhookId: isMailhookTrigger ? (validMailhookId || (existingScenario.incomingLead?.mailhookId ? String(existingScenario.incomingLead.mailhookId) : null)) : null,

        subjectFilter: incomingSubjectFilter,

        pollInterval:
          Number(incomingLead.pollInterval) > 0
            ? Number(incomingLead.pollInterval)
            : (existingScenario.incomingLead?.pollInterval || 60),

        enabled: incomingLeadEnabled,
      },

      routerBranches: routerBranches.map((branch) => ({
        id: branch.id || Date.now(),
        hasModule: Boolean(branch.hasModule),
        condition: typeof branch.condition === "string" ? branch.condition : null,
        filter: {
          label: branch.filter?.label || "",
          conditions: Array.isArray(branch.filter?.conditions)
            ? branch.filter.conditions.map((condition) => ({
                field: condition.field || "",
                operator: condition.operator || "",
                value: condition.value || "",
                join: ["AND", "OR"].includes(condition.join) ? condition.join : null,
              }))
            : [],
          template: branch.filter?.template || "",
        },
        modules: Array.isArray(branch.modules)
          ? branch.modules.map((module) => {
              const rawModuleConnectionId = Array.isArray(module.connectionId)
                ? module.connectionId[0]
                : module.connectionId;

              const moduleConnectionId =
                typeof rawModuleConnectionId === "string"
                  ? rawModuleConnectionId.trim()
                  : rawModuleConnectionId?.toString?.().trim() || "";

              return {
                id: module.id || Date.now(),
                type: module.type || "",
                description: module.description || "",
                subject: module.subject || "",
                to: module.to || "",
                cc: Array.isArray(module.cc) ? module.cc.filter(Boolean) : [],
                bcc: Array.isArray(module.bcc) ? module.bcc.filter(Boolean) : [],
                connectionId: moduleConnectionId,
                replyMode: module.replyMode === "ai" ? "ai" : "manual",
                companyProfileId: module.replyMode === "ai" && module.companyProfileId ? module.companyProfileId : null,
                template: module.template || "",
                delayValue: module.delayValue !== undefined && module.delayValue !== null && module.delayValue !== "" ? Number(module.delayValue) : null,
                delayUnit: module.delayUnit || null,
                app: {
                  name: module.app?.name || "",
                  color: module.app?.color || "",
                  icon: module.app?.icon || "",
                },
                position: {
                  x: Number.isFinite(Number(module.position?.x)) ? Number(module.position.x) : 200,
                  y: Number.isFinite(Number(module.position?.y)) ? Number(module.position.y) : 200,
                },
                filter: {
                  label: module.filter?.label || "",
                  conditions: Array.isArray(module.filter?.conditions)
                    ? module.filter.conditions.map((condition) => ({
                        field: condition.field || "",
                        operator: condition.operator || "",
                        value: condition.value || "",
                        join: ["AND", "OR"].includes(condition.join) ? condition.join : null,
                      }))
                    : [],
                  template: module.filter?.template || "",
                },
                emailType: module.emailType || "",
              };
            })
          : [],
      })),

      rfNodes: req.body.hasOwnProperty("rfNodes") && Array.isArray(req.body.rfNodes) ? req.body.rfNodes : (existingScenario.rfNodes || []),
      rfEdges: req.body.hasOwnProperty("rfEdges") && Array.isArray(req.body.rfEdges) ? req.body.rfEdges : (existingScenario.rfEdges || []),
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
      message: activationBlocked
        ? blockers[0]?.message ||
          "Scenario saved, but it could not be activated."
        : scenarioActive
          ? "Scenario updated and activated successfully."
          : "Scenario updated successfully.",
      scenarioActive,
      activationBlocked,
      blockers,
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
      const shopifyCount = await scenarioModel.countDocuments({
        userId: scenario.userId,
        type: "shopify",
      });
      if (shopifyCount <= 1) {
        return res.status(403).json({
          success: false,
          message: "The primary Shopify prebuilt scenario cannot be deleted.",
        });
      }
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
