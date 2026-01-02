import { TemplateModel } from '../Models/Template.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { authModel } from '../Models/auth.js';
import { OrganizationModel } from '../Models/Organization.js';
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

    // 👉 Sirf Shopify templates fetch karo
    const templates = await TemplateModel.find({
      userId,
      platform: 'shopify', // <--- added filter
    });

    res.json(templates);
  } catch (err) {
    console.error('❌ Failed to fetch templates:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getCustomTemplates = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    // 👉 Sirf Shopify templates fetch karo
    const templates = await TemplateModel.find({
      userId,
      platform: 'other', // <--- added filter
    });

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

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required.',
      });
    }

    // Get all Shopify templates
    const templates = await TemplateModel.find({ userId, platform: 'shopify' });

    if (!templates.length) {
      return res.status(404).json({
        success: false,
        message: 'No Shopify templates found for this user.',
      });
    }

    // Identify only non-General templates
    const nonGeneralTemplates = templates.filter(
      (t) => !t.service || t.service.toLowerCase() !== 'general'
    );

    const hasActive = nonGeneralTemplates.some((t) => t.active === true);

    const newStatus = !hasActive; // Toggle

    // Update non-general Shopify templates
    await TemplateModel.updateMany(
      {
        userId,
        platform: 'shopify',
        $or: [{ service: { $ne: 'General' } }, { service: { $exists: false } }],
      },
      { $set: { active: newStatus } }
    );

    // General templates always ON
    await TemplateModel.updateMany(
      { userId, platform: 'shopify', service: 'General' },
      { $set: { active: true } }
    );

    return res.json({
      success: true,
      toggledTo: newStatus,
      message: `All Shopify non-general templates are now ${
        newStatus ? 'active' : 'inactive'
      }. General remains active.`,
    });
  } catch (error) {
    console.error('Shopify update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};

export const updateOtherTemplateStatus = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required.',
      });
    }

    const templates = await TemplateModel.find({ userId, platform: 'other' });

    if (!templates.length) {
      return res.status(404).json({
        success: false,
        message: 'No OTHER templates found for this user.',
      });
    }

    const hasActive = templates.some((t) => t.active === true);

    const newStatus = !hasActive;

    await TemplateModel.updateMany(
      { userId, platform: 'other' },
      { $set: { active: newStatus } }
    );

    return res.json({
      success: true,
      toggledTo: newStatus,
      message: `All OTHER templates have been ${
        newStatus ? 'activated' : 'deactivated'
      }.`,
    });
  } catch (error) {
    console.error('Other update error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};

export const getActiveOtherTemplates = async (req, res) => {
  try {
    const { userId } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required.',
      });
    }

    const templates = await TemplateModel.find({
      userId,
      platform: 'other',
      active: true,
    });

    return res.json({
      success: true,
      count: templates.length,
      templates,
    });
  } catch (error) {
    console.error('Error fetching active other templates:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error.',
    });
  }
};

export const saveOtherTemplate = async (req, res) => {
  try {
    const { userId, name, content } = req.body;

    if (!userId || !name || !content) {
      return res.status(400).json({
        success: false,
        message: 'userId, name, and content are required',
      });
    }

    const newTemplate = await TemplateModel.create({
      userId,
      name,
      content,
      platform: 'other',
      active: true,
      service: 'General',
      conditions: [],
    });

    return res.json({
      success: true,
      template: newTemplate,
      message: 'Template saved successfully',
    });
  } catch (error) {
    console.error('Save template error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getAllTemplatesByQuery = async (req, res) => {
  try {
    const { userId, service, platform } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'User ID is required',
      });
    }

    // 🔍 Base Query
    const query = { userId };

    // ✅ Service-based filter (case-insensitive exact match)
    if (service && service.trim() !== '') {
      query.service = { $regex: new RegExp(`^${service.trim()}$`, 'i') };
      // ↑ example: service="Troubleshooting" → only "Troubleshooting" match karega (case-insensitive)
    }

    // ✅ Platform optional filter
    if (platform && platform.trim() !== '') {
      query.platform = { $regex: new RegExp(platform.trim(), 'i') };
    }

    // 🔹 Fetch templates
    const templates = await TemplateModel.find(query).sort({ createdAt: 1 });

    // 🔹 Apply priority sorting only for email-type services
    let finalTemplates = templates;
    if (service) {
      const priority = ['Initial Email', 'First Email', 'Second Email'];
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
      message: '✅ Templates fetched successfully',
      count: finalTemplates.length,
      data: finalTemplates,
    });
  } catch (err) {
    console.error('❌ Error fetching templates:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch templates',
      error: err.message,
    });
  }
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY is missing in env');

const genAI = new GoogleGenerativeAI(apiKey);

export async function generateTemplateWithGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.() || '';

  return text.trim();
}

// export const generateTemplateWithAI = async (req, res) => {
//   try {
//     const { userId, templateId } = req.body;

//     if (!userId || !templateId) {
//       return res.status(400).json({
//         success: false,
//         message: "userId and templateId are required",
//       });
//     }

//     // 🔐 Fetch template safely
//     const template = await TemplateModel.findOne({ _id: templateId, userId });
//     if (!template) {
//       return res.status(404).json({
//         success: false,
//         message: "Template not found for this user",
//       });
//     }

//     // 🔒 AI lock
//     if (template.aiInProgress) {
//       return res.status(409).json({
//         success: false,
//         message: "AI generation already in progress",
//       });
//     }

//     template.aiInProgress = true;
//     await template.save();

//     const service = template.service || "General";
//     const platform = template.platform || "shopify";
//     const name = template.name || "Initial Email";

//     const lowerName = name.toLowerCase();
//     const sequenceType = lowerName.includes("initial")
//       ? "Initial Email"
//       : lowerName.includes("first")
//       ? "First Follow-Up"
//       : lowerName.includes("second")
//       ? "Second Follow-Up"
//       : name;

//     const placeholders = [
//       "{{FullName}}",
//       "{{BusinessEmail}}",
//       "{{StoreName}}",
//       "{{StoreURL}}",
//       "{{Country}}",
//       "{{Service}}",
//       "{{Budget}}",
//       "{{ProblemGoal}}",
//       "{{OrganizationName}}",
//     ];

//     const conditionsText =
//       template.conditions?.length > 0
//         ? template.conditions
//             .map(
//               (c) =>
//                 `- Field: ${c.field}, Operator: ${c.operator}, Value: ${c.value}`
//             )
//             .join("\n")
//         : "None";

//     // 🔥 FINAL PROMPT
//     const prompt = `
// You are an expert Shopify service sales email copywriter.

// Context:
// Platform: ${platform}
// Service: ${service}
// Email Type: ${sequenceType}

// Service Guidance:
// - If service is "Troubleshooting": focus on fixing bugs, errors, broken features.
// - If service is "SEO": focus on traffic, rankings, and conversions.
// - If service is "Theme customization" or "Store build or redesign": focus on UX, branding, design quality.
// - If service is "Email marketing": focus on retention, revenue, automation.
// - If service is "General": keep it broad and helpful.
// - Otherwise: act as a specialist for the given service.

// Email Rules:
// - Write a ${sequenceType} email.
// - Tone: professional, friendly, confident, conversion-focused.
// - Length: 120–180 words.
// - Output ONLY clean HTML (no markdown, no explanations).
// - Include a clear CTA.
// - Do NOT use [Your Name] or [Company Name].

// Placeholders:
// Use these EXACT placeholders:
// ${placeholders.join(", ")}

// Mandatory:
// - Use {{FullName}}, {{StoreName}}, {{ProblemGoal}} at least once.
// - Always end the email with:
//   Best regards,<br/>
//   <strong>{{OrganizationName}}</strong>
// - If this is a follow-up email, politely reference the previous email.
// - Do NOT mention AI.

// Conditions:
// ${conditionsText}

// Return HTML suitable for ReactQuill editor.
// `;

//     const aiHtml = await generateTemplateWithGemini(prompt);

//     if (!aiHtml) {
//       template.aiInProgress = false;
//       await template.save();

//       return res.status(500).json({
//         success: false,
//         message: "AI returned empty content",
//       });
//     }

//     // ✅ Save result
//     template.content = aiHtml
//       .replace(/```html|```/g, "")
//       .trim();
//     template.aiGenerated = true;
//     template.aiGeneratedAt = new Date();
//     template.aiInProgress = false;

//     await template.save();

//     return res.json({
//       success: true,
//       message: "✅ AI template generated & saved",
//       template,
//     });
//   } catch (error) {
//     console.error("❌ generateTemplateWithAI error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: error.message,
//     });
//   }
// };

export const generateTemplateWithAI = async (req, res) => {
  try {
    const { userId, templateId } = req.body;

    if (!userId || !templateId) {
      return res.status(400).json({
        success: false,
        message: "userId and templateId are required",
      });
    }

    const user = await authModel.findById(userId).lean();
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

  const organization = await OrganizationModel.findOne({ userId }).lean();

if (!organization) {
  return res.status(404).json({
    success: false,
    message: "Organization not found for this user",
  });
}

const organizationName = organization.organizationName;
    console.log("USER DOC FROM DB:", organizationName);

    const template = await TemplateModel.findOne({ _id: templateId, userId });
    if (!template) {
      return res.status(404).json({
        success: false,
        message: "Template not found for this user",
      });
    }

    if (template.aiInProgress) {
      return res.status(409).json({
        success: false,
        message: "AI generation already in progress",
      });
    }

    template.aiInProgress = true;
    await template.save();

    const service = template.service || "General";
    const platform = template.platform || "shopify";
    const name = template.name || "Initial Email";

    const lowerName = name.toLowerCase();
    const sequenceType = lowerName.includes("initial")
      ? "Initial Email"
      : lowerName.includes("first")
      ? "First Follow-Up"
      : lowerName.includes("second")
      ? "Second Follow-Up"
      : name;

    const placeholders = [
      "{{FullName}}",
      "{{BusinessEmail}}",
      "{{StoreName}}",
      "{{StoreURL}}",
      "{{Country}}",
      "{{Service}}",
      "{{Budget}}",
      "{{ProblemGoal}}",
      "{{OrganizationName}}",
    ];

    const conditionsText =
      template.conditions?.length > 0
        ? template.conditions
            .map(
              (c) =>
                `- Field: ${c.field}, Operator: ${c.operator}, Value: ${c.value}`
            )
            .join("\n")
        : "None";

    const prompt = `
You are an expert Shopify service sales email copywriter.

Context:
Platform: ${platform}
Service: ${service}
Email Type: ${sequenceType}

Email Rules:
- Write a ${sequenceType} email.
- Tone: professional, friendly, confident, conversion-focused.
- Length: 120–180 words.
- Output ONLY clean HTML.
- Include a clear CTA.
- Do NOT use [Your Name] or [Company Name].

Placeholders:
Use these EXACT placeholders:
${placeholders.join(", ")}

Mandatory:
- Use {{FullName}}, {{StoreName}}, {{ProblemGoal}} at least once.
- Always end the email with:
  Best regards,<br/>
  <strong>{{OrganizationName}}</strong>
- If follow-up, reference previous email.
- Do NOT mention AI.

Conditions:
${conditionsText}

Return HTML suitable for ReactQuill editor.
`;

    const aiHtml = await generateTemplateWithGemini(prompt);

    if (!aiHtml) {
      template.aiInProgress = false;
      await template.save();

      return res.status(500).json({
        success: false,
        message: "AI returned empty content",
      });
    }

    const finalHtml = aiHtml
      .replace(/```html|```/g, "")
      .replace(/{{OrganizationName}}/g, organizationName)
      .trim();

    template.content = finalHtml;
    template.aiGenerated = true;
    template.aiGeneratedAt = new Date();
    template.aiInProgress = false;

    await template.save();

    return res.json({
      success: true,
      message: " AI template generated & saved",
      template,
    });
  } catch (error) {
    console.error("❌ generateTemplateWithAI error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
