import { TemplateModel } from '../Models/Template.js';

export const addTemplate = async (req, res) => {
  try {
    const { userId, platform, service, conditions, content } = req.body;

    // Basic validation
    if (!userId || !platform || !content) {
      return res.status(400).json({
        error: 'userId, platform and content are required',
      });
    }

    // Shopify requires a service
    if (platform === 'shopify' && !service) {
      return res.status(400).json({
        error: 'service is required when platform is shopify',
      });
    }

    const template = new TemplateModel({
      userId,
      platform,
      service: platform === 'shopify' ? service : null,
      conditions: conditions || [],
      content,
    });

    await template.save();
    res.json(template);
  } catch (err) {
    console.error('❌ Failed to save template:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getTemplates = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const templates = await TemplateModel.find({ userId });
    res.json(templates);
  } catch (err) {
    console.error('❌ Failed to fetch templates:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await TemplateModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updated) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      success: true,
      updated,
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

export const deleteTemplate = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await TemplateModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({ success: true, msg: 'Template deleted' });
  } catch (err) {
    console.error(' Failed to delete template:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getAllTemplates = async (req, res) => {
  try {
    const { userId, service, platform } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      });
    }

    const query = { userId };

    if (service && service.trim() !== '') {
      query.service = service.trim();
    }

    if (platform && platform.trim() !== '') {
      query.platform = platform.trim();
    }

    const templates = await TemplateModel.find(query).sort({ createdAt: 1 });

    let finalTemplates = templates;
    if (service) {
      const priority = ['Initial Email', 'First Email', 'Second Email'];
      finalTemplates = templates
        .filter((t) =>
          priority.some((p) => t.name.toLowerCase().includes(p.toLowerCase()))
        )
        .sort(
          (a, b) =>
            priority.findIndex((p) =>
              a.name.toLowerCase().includes(p.toLowerCase())
            ) -
            priority.findIndex((p) =>
              b.name.toLowerCase().includes(p.toLowerCase())
            )
        );
    }

    res.status(200).json({
      success: true,
      message: '✅ Templates fetched successfully',
      count: finalTemplates.length,
      data: finalTemplates,
    });
  } catch (err) {
    console.error('❌ Error fetching templates:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch templates',
      error: err.message,
    });
  }
};

export const updateTemplateStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    if (typeof active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: "Invalid 'active' value. Must be boolean.",
      });
    }

    // 🔹 Fetch template first
    const template = await TemplateModel.findById(id);

    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: 'Template not found.' });
    }

    // 🔹 Prevent deactivating General Service templates
    if (
      active === false &&
      (!template.service ||
        template.service.trim() === '' ||
        template.service === 'General')
    ) {
      return res.status(400).json({
        success: false,
        message: 'General Service templates cannot be deactivated.',
      });
    }

    // 🔹 Update status safely
    template.active = active;
    await template.save();

    res.json({
      success: true,
      message: 'Template status updated successfully.',
      data: template,
    });
  } catch (error) {
    console.error('❌ updateTemplateStatus Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAllTemplateStatus = async (req, res) => {
  try {
    const { userId } = req.body;

    console.log('[updateAllTemplateStatus] Request received:', req.body);

    if (!userId) {
      console.log(' userId missing in request body');
      return res.status(400).json({
        success: false,
        message: 'userId is required.',
      });
    }

    console.log(`🔍 Fetching templates for userId: ${userId}`);
    const templates = await TemplateModel.find({ userId });

    if (!templates || templates.length === 0) {
      console.log('❌ No templates found for this user.');
      return res.status(404).json({
        success: false,
        message: 'No templates found for this user.',
      });
    }

    console.log(`✅ Found ${templates.length} templates for userId: ${userId}`);

    const nonGeneralTemplates = templates.filter(
      (t) => !t.service || t.service.toLowerCase() !== 'general'
    );

    const hasActive = nonGeneralTemplates.some((t) => t.active === true);
    const newStatus = !hasActive;

    console.log(
      `🔁 Setting all non-General templates to ${
        newStatus ? 'ACTIVE' : 'INACTIVE'
      }`
    );

    const result = await TemplateModel.updateMany(
      {
        userId,
        $or: [{ service: { $ne: 'General' } }, { service: { $exists: false } }],
      },
      { $set: { active: newStatus } }
    );

    await TemplateModel.updateMany(
      { userId, service: 'General' },
      { $set: { active: true } }
    );

    console.log(
      `Updated ${result.modifiedCount} non-General templates; General templates remain active.`
    );

    return res.json({
      success: true,
      toggledTo: newStatus,
      message: `All non-General templates have been ${
        newStatus ? 'activated' : 'deactivated'
      }, while General templates remain active.`,
    });
  } catch (error) {
    console.error('❌ updateAllTemplateStatus Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};


export const getAllTemplatesByQuery = async (req, res) => {
  try {
    const { userId, service, platform } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // 🔍 Base Query
    const query = { userId };

    // ✅ Service-based filter (case-insensitive exact match)
    if (service && service.trim() !== "") {
      query.service = { $regex: new RegExp(`^${service.trim()}$`, "i") };
      // ↑ example: service="Troubleshooting" → only "Troubleshooting" match karega (case-insensitive)
    }

    // ✅ Platform optional filter
    if (platform && platform.trim() !== "") {
      query.platform = { $regex: new RegExp(platform.trim(), "i") };
    }

    // 🔹 Fetch templates
    const templates = await TemplateModel.find(query).sort({ createdAt: 1 });

    // 🔹 Apply priority sorting only for email-type services
    let finalTemplates = templates;
    if (service) {
      const priority = ["Initial Email", "First Email", "Second Email"];
      finalTemplates = templates
        .filter((t) =>
          priority.some((p) => t.name?.toLowerCase().includes(p.toLowerCase()))
        )
        .sort(
          (a, b) =>
            priority.findIndex((p) =>
              a.name?.toLowerCase().includes(p.toLowerCase())
            ) -
            priority.findIndex((p) =>
              b.name?.toLowerCase().includes(p.toLowerCase())
            )
        );
    }

    return res.status(200).json({
      success: true,
      message: "✅ Templates fetched successfully",
      count: finalTemplates.length,
      data: finalTemplates,
    });
  } catch (err) {
    console.error("❌ Error fetching templates:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch templates",
      error: err.message,
    });
  }
};

