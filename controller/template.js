import { TemplateModel } from '../Models/Template.js';

export const addTemplate = async (req, res) => {
  try {
    const { userId, platform, templates } = req.body;

    if (!userId || !platform || !templates || !Array.isArray(templates)) {
      return res.status(400).json({
        error: "userId, platform, and templates[] are required",
      });
    }

    // Map templates to the proper format { name: "template name" }
    const formattedTemplates = templates.map((template) => ({
      name: template,  // each template will now be an object with the name field
    }));

    // Check if the user already has templates for this platform
    let doc = await TemplateModel.findOne({ userId, platform });

    if (!doc) {
      // If not, create a new document for the user with the templates array
      doc = new TemplateModel({
        userId,
        platform,
        templates: formattedTemplates,  // add formatted templates
      });
    } else {
      // If document exists, just add the new templates to the array
      const existingTemplates = doc.templates.map((t) => t.name);
      const newTemplates = formattedTemplates.filter(
        (t) => !existingTemplates.includes(t.name)  // avoid duplicates
      );

      if (newTemplates.length > 0) {
        doc.templates.push(...newTemplates);  // push the formatted templates
      }
    }

    await doc.save();
    res.json(doc);
  } catch (err) {
    console.error("❌ Failed to save bulk templates:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};


export const getTemplates = async (req, res) => {
  try {
    const { platform } = req.params;

    if (!platform) {
      return res.status(400).json({ error: "Platform parameter is required" });
    }

    // Fetch templates based on platform
    const templates = await TemplateModel.find({ platform });

    if (!templates.length) {
      return res.status(404).json({ error: "No templates found for this platform" });
    }

    // Return templates, showing name and _id
    const formattedTemplates = templates.map(doc => ({
      _id: doc._id,
      platform: doc.platform,
      templates: doc.templates.map(template => template.name) // Only return the name of each template
    }));

    res.json(formattedTemplates);
  } catch (err) {
    console.error("❌ Failed to fetch templates:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};


export const deleteTemplate=async(req,res)=>{
    try {
    await TemplateModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error(" Failed to delete template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
}

export const addOtherTemplate = async (req, res) => {
  try {
    const { userId, name } = req.body;

    if (!userId || !name) {
      return res
        .status(400)
        .json({ error: "userId and name are required" });
    }

    const template = new TemplateModel({
      userId,
      platform: "other", 
      name,
    });

    await template.save();

    res.json(template);
  } catch (err) {
    console.error("❌ Failed to save other template:", err.message);
    res.status(500).json({ error: "Server error" });
  }
};
