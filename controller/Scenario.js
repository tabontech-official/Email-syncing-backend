import { scenarioModel } from "../Models/Scenario.js";
import { ConnectionModel } from "../Models/Connection.js";
import { authModel } from "../Models/auth.js";
// export const addScenario = async (req, res) => {
//   try {
//     console.log("=======================================");
//     console.log("📥 Incoming request to ADD SCENARIO");
//     console.log("=======================================");

//     // 🔹 Raw body log karo
//     console.log("🔹 Raw Request Body:", JSON.stringify(req.body, null, 2));

//     // 🔹 Specific fields ko separately log karo
//     console.log("🔹 userId:", req.body.userId);
//     console.log("🔹 name:", req.body.name);
//     console.log("🔹 description:", req.body.description);
//     console.log("🔹 type:", req.body.type);

//     // 🔹 Router branches detail
//     if (Array.isArray(req.body.routerBranches)) {
//       console.log(`🔹 Total routerBranches: ${req.body.routerBranches.length}`);
//       req.body.routerBranches.forEach((branch, bIndex) => {
//         console.log(`  ➝ Branch[${bIndex}] id=${branch.id}, hasModule=${branch.hasModule}`);
//         if (branch.filter) {
//           console.log(`    └─ Filter Label: ${branch.filter.label}`);
//           console.log(`    └─ Filter Conditions: ${JSON.stringify(branch.filter.conditions)}`);
//           console.log(`    └─ Filter Template: ${branch.filter.template}`);
//         }
//         if (Array.isArray(branch.modules)) {
//           console.log(`    └─ Total Modules: ${branch.modules.length}`);
//           branch.modules.forEach((m, mIndex) => {
//             console.log(`       • Module[${mIndex}] → id=${m.id}, type=${m.type}`);
//             console.log(`         ├─ App: ${m.app?.name} (${m.app?.color})`);
//             console.log(`         ├─ Description: ${m.description}`);
//             console.log(`         ├─ ConnectionId: ${m.connectionId}`);
//             console.log(`         ├─ Delay: ${m.delayValue ?? "N/A"} ${m.delayUnit ?? ""}`);
//             if (m.filter) {
//               console.log(`         ├─ Filter Label: ${m.filter.label}`);
//               console.log(`         ├─ Filter Conditions: ${JSON.stringify(m.filter.conditions)}`);
//               console.log(`         └─ Filter Template: ${m.filter.template}`);
//             }
//           });
//         }
//       });
//     } else {
//       console.log("⚠️ No routerBranches found in request body!");
//     }

//     // 🔹 Create and save
//     const scenario = new scenarioModel(req.body);
//     console.log("🛠 Saving scenario to DB...");
//     await scenario.save();
//     console.log("✅ Scenario successfully saved!");
//     console.log("Saved Scenario Document:", JSON.stringify(scenario, null, 2));
//     console.log("=======================================");

//     res.status(201).json(scenario);
//   } catch (error) {
//     console.log("=======================================");
//     console.error("❌ Error in addScenario:", error);
//     console.log("=======================================");
//     res.status(400).json({ error: error.message });
//   }
// };


export const addScenario = async (req, res) => {
  try {
    const scenario = new scenarioModel(req.body);
    await scenario.save();

    res.status(201).json(scenario);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};


export const getUserScenarios = async (req, res) => {
  try {
    const scenarios = await scenarioModel.find({ userId: req.params.userId });
    res.json(scenarios);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getSingleScenario = async (req, res) => {
  try {
    const scenario = await scenarioModel.findById(req.params.id);
    if (!scenario) return res.status(404).json({ message: "Not found" });
    res.json(scenario);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};






// export const updateScenario = async (req, res) => {
//   try {
//     const routerBranches = req.body.routerBranches || [];

//     const connectionIds = [];
//     routerBranches.forEach((branch) => {
//       (branch.modules || []).forEach((m) => {
//         const appName = m.app?.name?.toLowerCase?.() || "";
//         const isEmailModule =
//           appName.includes("email") ||
//           appName.includes("gmail") ||
//           appName.includes("follow") ||
//           appName.includes("initial");

//         const connId =
//           typeof m.connectionId === "string"
//             ? m.connectionId.trim()
//             : m.connectionId?.toString?.().trim();

//         if (isEmailModule && connId) {
//           connectionIds.push(connId);
//         }
//       });
//     });


//     let missingConnectionFound = false;

//     if (connectionIds.length > 0) {
//       const validConnections = await ConnectionModel.find({
//         _id: { $in: connectionIds },
//         status: "active",
//       }).select("_id");

//       const validIds = validConnections.map((c) => c._id.toString());

//       const invalidIds = connectionIds.filter(
//         (id) => !validIds.includes(id)
//       );

//       if (invalidIds.length > 0) {
//         missingConnectionFound = true;
//       }
//     } else {
//       missingConnectionFound = true;
//     }

//     const updateData = {
//       name: req.body.name,
//       description: req.body.description,
//       type: req.body.type,
//       routerBranches: routerBranches.map((branch) => ({
//         id: branch.id,
//         hasModule: branch.hasModule,
//         condition: branch.condition,
//         filter: branch.filter || { conditions: [] },
//         modules: (branch.modules || []).map((m) => ({
//           id: m.id,
//           type: m.type || "",
//           description: m.description || "",
//           subject: m.subject || "",
//           cc: Array.isArray(m.cc) ? m.cc : [],
//           bcc: Array.isArray(m.bcc) ? m.bcc : [],
//           connectionId: Array.isArray(m.connectionId)
//             ? m.connectionId[0]
//             : m.connectionId || "",
//           template: m.template || "",
//           delayValue: m.delayValue || null,
//           delayUnit: m.delayUnit || null,
//           app: m.app || { name: "", color: "", icon: "" },
//           filter: m.filter || { conditions: [] },
//           emailType: m.emailType || "",
//         })),
//       })),
//       scenarioActive: !missingConnectionFound,
//     };

//     const updated = await scenarioModel.findByIdAndUpdate(
//       req.params.id,
//       { $set: updateData },
//       { new: true, runValidators: false }
//     );

//     if (!updated) {
//       return res.status(404).json({
//         success: false,
//         message: "Scenario not found",
//       });
//     }

  
//     res.status(200).json({ success: true, updated });
//   } catch (error) {
//     console.error("[updateScenario] Error:", error);
//     res.status(400).json({ success: false, message: error.message });
//   }
// };

export const updateScenario = async (req, res) => {
  try {
    const routerBranches = req.body.routerBranches || [];

    // Collect all connection IDs from non-delay modules
    const connectionIds = [];
    let missingConnectionFound = false;

    routerBranches.forEach((branch) => {
      (branch.modules || []).forEach((m) => {
        const appName = m.app?.name?.toLowerCase?.() || "";

        // ✅ Only check non-delay modules (ignore "Delay" type)
        const isEmailModule =
          appName.includes("email") ||
          appName.includes("gmail") ||
          appName.includes("follow") ||
          appName.includes("initial");

        if (isEmailModule) {
          const connId =
            typeof m.connectionId === "string"
              ? m.connectionId.trim()
              : m.connectionId?.toString?.().trim();

          if (!connId) {
            // 🚫 Missing connection
            missingConnectionFound = true;
          } else {
            connectionIds.push(connId);
          }
        }
      });
    });

    // ✅ Validate that all connectionIds exist and are active
    if (connectionIds.length > 0) {
      const validConnections = await ConnectionModel.find({
        _id: { $in: connectionIds },
        status: "active",
      }).select("_id");

      const validIds = validConnections.map((c) => c._id.toString());
      const invalidIds = connectionIds.filter((id) => !validIds.includes(id));

      if (invalidIds.length > 0) {
        console.warn("⚠️ Found inactive or invalid connections:", invalidIds);
        missingConnectionFound = true;
      }
    }

    // ✅ Determine active state — inactive if any missing/inactive connection
    const scenarioActive = !missingConnectionFound;

    const updateData = {
      name: req.body.name,
      description: req.body.description,
      type: req.body.type,
      routerBranches: routerBranches.map((branch) => ({
        id: branch.id,
        hasModule: branch.hasModule,
        condition: branch.condition,
        filter: branch.filter || { conditions: [] },
        modules: (branch.modules || []).map((m) => ({
          id: m.id,
          type: m.type || "",
          description: m.description || "",
          subject: m.subject || "",
          cc: Array.isArray(m.cc) ? m.cc : [],
          bcc: Array.isArray(m.bcc) ? m.bcc : [],
          connectionId: Array.isArray(m.connectionId)
            ? m.connectionId[0]
            : m.connectionId || "",
          template: m.template || "",
          delayValue: m.delayValue || null,
          delayUnit: m.delayUnit || null,
          app: m.app || { name: "", color: "", icon: "" },
          filter: m.filter || { conditions: [] },
          emailType: m.emailType || "",
        })),
      })),
      scenarioActive, // ✅ final calculated active state
    };

    const updated = await scenarioModel.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: false }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Scenario not found",
      });
    }

    res.status(200).json({
      success: true,
      message: scenarioActive
        ? "Scenario updated and active."
        : "Scenario updated but deactivated due to missing/inactive connections.",
      scenarioActive,
      updated,
    });
  } catch (error) {
    console.error("[updateScenario] Error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};


export const deleteScenario = async (req, res) => {
  try {
    await scenarioModel.findByIdAndDelete(req.params.id);
    res.json({ message: "Scenario deleted" });
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
