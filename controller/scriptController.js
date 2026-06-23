import { ScriptSetting } from "../Models/ScriptSetting.js";

export const getScripts = async (req, res) => {
  try {
    let scripts = await ScriptSetting.findOne();

    if (!scripts) {
      scripts = await ScriptSetting.create({
        headerScript: "",
        footerScript: "",
        isActive: true,
      });
    }

    return res.status(200).json({
      success: true,
      data: scripts,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch scripts",
    });
  }
};

export const saveScripts = async (req, res) => {
  try {
    const {
      headerScript = "",
      footerScript = "",
      isActive = true,
    } = req.body;

    let scripts = await ScriptSetting.findOne();

    if (!scripts) {
      scripts = await ScriptSetting.create({
        headerScript,
        footerScript,
        isActive,
      });
    } else {
      scripts.headerScript = headerScript;
      scripts.footerScript = footerScript;
      scripts.isActive = isActive;

      await scripts.save();
    }

    return res.status(200).json({
      success: true,
      message: "Scripts saved successfully",
      data: scripts,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to save scripts",
    });
  }
};