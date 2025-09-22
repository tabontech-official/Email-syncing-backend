import { TemplateModel } from "../Models/Template.js";

// Create Template
export const addTemplate = async (req, res) => {
  try {
    const { userId, platform, service, keywords, content } = req.body;

    if (!userId || !platform || !service || !content) {
      return res.status(400).json({
        error: "userId, platform, service and content are required",
      });
    }

    const template = new TemplateModel({
      userId,
      platform,
      service,
      keywords: keywords || [],
      content,
    });

    await template.save();
    res.json(template);
  } catch (err) {
    console.error("❌ Failed to save template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// Get Templates by User
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

// Update Template
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
    console.error("❌ Failed to update template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};

// Delete Template
export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TemplateModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ error: "Template not found" });
    }

    res.json({ success: true, msg: "Template deleted" });
  } catch (err) {
    console.error("❌ Failed to delete template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
