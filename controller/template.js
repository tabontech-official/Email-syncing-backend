import { TemplateModel } from "../Models/Template.js";

export const addTemplate = async (req, res) => {
  try {
    const { userId, platform, service, conditions, content } = req.body;

    // Basic validation
    if (!userId || !platform || !content) {
      return res.status(400).json({
        error: "userId, platform and content are required",
      });
    }

    // Shopify requires a service
    if (platform === "shopify" && !service) {
      return res.status(400).json({
        error: "service is required when platform is shopify",
      });
    }

    const template = new TemplateModel({
      userId,
      platform,
      service: platform === "shopify" ? service : null,
      conditions: conditions || [],
      content,
    });

    await template.save();
    res.json(template);
  } catch (err) {
    console.error("❌ Failed to save template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

export const getTemplates = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: "userId is required" });
    }

    const templates = await TemplateModel.find({ userId });
    res.json(templates);
  } catch (err) {
    console.error("❌ Failed to fetch templates:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await TemplateModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updated) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TemplateModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json({ success: true, msg: "Template deleted" });
  } catch (err) {
    console.error(" Failed to delete template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};



