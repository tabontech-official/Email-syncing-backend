import { scenarioModel } from "../Models/Scenario.js";

// Create
export const addScenario = async (req, res) => {
  try {
    console.log("=======================================");
    console.log("📥 Incoming request to ADD SCENARIO");
    console.log("=======================================");

    // 🔹 Raw body log karo
    console.log("🔹 Raw Request Body:", JSON.stringify(req.body, null, 2));

    // 🔹 Specific fields ko separately log karo
    console.log("🔹 userId:", req.body.userId);
    console.log("🔹 name:", req.body.name);
    console.log("🔹 description:", req.body.description);
    console.log("🔹 type:", req.body.type);

    // 🔹 Router branches detail
    if (Array.isArray(req.body.routerBranches)) {
      console.log(`🔹 Total routerBranches: ${req.body.routerBranches.length}`);
      req.body.routerBranches.forEach((branch, bIndex) => {
        console.log(`  ➝ Branch[${bIndex}] id=${branch.id}, hasModule=${branch.hasModule}`);
        if (branch.filter) {
          console.log(`    └─ Filter Label: ${branch.filter.label}`);
          console.log(`    └─ Filter Conditions: ${JSON.stringify(branch.filter.conditions)}`);
          console.log(`    └─ Filter Template: ${branch.filter.template}`);
        }
        if (Array.isArray(branch.modules)) {
          console.log(`    └─ Total Modules: ${branch.modules.length}`);
          branch.modules.forEach((m, mIndex) => {
            console.log(`       • Module[${mIndex}] → id=${m.id}, type=${m.type}`);
            console.log(`         ├─ App: ${m.app?.name} (${m.app?.color})`);
            console.log(`         ├─ Description: ${m.description}`);
            console.log(`         ├─ ConnectionId: ${m.connectionId}`);
            console.log(`         ├─ Delay: ${m.delayValue ?? "N/A"} ${m.delayUnit ?? ""}`);
            if (m.filter) {
              console.log(`         ├─ Filter Label: ${m.filter.label}`);
              console.log(`         ├─ Filter Conditions: ${JSON.stringify(m.filter.conditions)}`);
              console.log(`         └─ Filter Template: ${m.filter.template}`);
            }
          });
        }
      });
    } else {
      console.log("⚠️ No routerBranches found in request body!");
    }

    // 🔹 Create and save
    const scenario = new scenarioModel(req.body);
    console.log("🛠 Saving scenario to DB...");
    await scenario.save();
    console.log("✅ Scenario successfully saved!");
    console.log("Saved Scenario Document:", JSON.stringify(scenario, null, 2));
    console.log("=======================================");

    res.status(201).json(scenario);
  } catch (error) {
    console.log("=======================================");
    console.error("❌ Error in addScenario:", error);
    console.log("=======================================");
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

export const updateScenario = async (req, res) => {
  try {
    const updated = await scenarioModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
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
