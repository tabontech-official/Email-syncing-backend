import { TemplateModel } from '../Models/Template.js';
import { authModel } from '../Models/auth.js';
import { OrganizationModel } from '../Models/Organization.js';
import { isOwnerOrAdmin, getAuthUserId } from '../middleware/authmiddleware.js';
import mongoose from 'mongoose';
import { loadPlatformRules } from '../utils/platformScenarioConfig.js';

export const addTemplate = async (req, res) => {
  try {
    const authUserId = getAuthUserId(req);
    const userId = req.body.userId || authUserId;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({ error: "Forbidden: You cannot create templates for another user" });
    }

    const { platform, service, conditions, content } = req.body;

    /*
     * The model requires a name, but this handler never set one — so every
     * create threw a ValidationError and returned a 500. It is also what a
     * user needs to tell several custom templates apart.
     */
    const name = String(req.body?.name || "").trim();

    // Basic validation
    if (!name) {
      return res.status(400).json({
        error: 'A template name is required',
      });
    }

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
      name,
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
    const authUserId = getAuthUserId(req);
    const requestedUserId = req.query.userId || authUserId;

    if (!isOwnerOrAdmin(req, requestedUserId)) {
      return res.status(403).json({ error: "Forbidden: You cannot access another user's templates" });
    }

    // 👉 Sirf Shopify templates fetch karo
    const templates = await TemplateModel.find({
      userId: requestedUserId,
      platform: 'shopify',
    });

    res.json(templates);
  } catch (err) {
    console.error('❌ Failed to fetch templates:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

export const getCustomTemplates = async (req, res) => {
  try {
    const authUserId = getAuthUserId(req);
    const requestedUserId = req.query.userId || authUserId;

    if (!isOwnerOrAdmin(req, requestedUserId)) {
      return res.status(403).json({ error: "Forbidden: You cannot access another user's custom templates" });
    }

    const templates = await TemplateModel.find({
      userId: requestedUserId,
      platform: 'other',
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
    const existing = await TemplateModel.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (!isOwnerOrAdmin(req, existing.userId)) {
      return res.status(403).json({ error: "Forbidden: You cannot update another user's template" });
    }

    /*
     * A blank name would fail the model's required rule on the next save,
     * so an empty string is dropped rather than written over a good name.
     */
    const updateData = { ...req.body };

    if (typeof updateData.name === 'string' && !updateData.name.trim()) {
      delete updateData.name;
    }

    const updated = await TemplateModel.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

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
    const existing = await TemplateModel.findById(id);
    if (!existing) {
      return res.status(404).json({ error: 'Template not found' });
    }

    if (!isOwnerOrAdmin(req, existing.userId)) {
      return res.status(403).json({ error: "Forbidden: You cannot delete another user's template" });
    }

    await TemplateModel.findByIdAndDelete(id);

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

export const toggleTemplateAiResponse = async (req, res) => {
  try {
    const { id } = req.params;
    const { aiResponse } = req.body;

    const template = await TemplateModel.findById(id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    template.aiResponse = typeof aiResponse === 'boolean' ? aiResponse : true;
    await template.save();

    res.json({
      success: true,
      message: 'Template AI response status updated successfully.',
      data: template,
    });
  } catch (error) {
    console.error('❌ toggleTemplateAiResponse Error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const bulkToggleTemplateAiResponse = async (req, res) => {
  try {
    const { userId, platform, aiResponse } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }
    const query = { userId };
    if (platform) query.platform = platform;
    const targetStatus = typeof aiResponse === 'boolean' ? aiResponse : true;

    await TemplateModel.updateMany(query, { aiResponse: targetStatus });

    res.json({
      success: true,
      message: `All ${platform || ''} templates updated to AI ${targetStatus ? 'Enabled' : 'Disabled'}.`,
    });
  } catch (error) {
    console.error('❌ bulkToggleTemplateAiResponse Error:', error.message);
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

const OPENROUTER_TEMPLATE_MODEL = 'google/gemma-4-26b-a4b-it:free';

export async function generateTemplateWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.warn('OPENROUTER_API_KEY is not set; cannot generate template');
    return '';
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://replex-engine.vercel.app',
        'X-Title': 'Replex Engine AI Template Generation',
      },
      body: JSON.stringify({
        model: OPENROUTER_TEMPLATE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn('OpenRouter API error during template generation:', response.status, errText);
      return '';
    }

    const data = await response.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    console.error('OpenRouter template generation error:', err.message);
    return '';
  }
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

//     const aiHtml = await generateTemplateWithOpenRouter(prompt);

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

    const aiHtml = await generateTemplateWithOpenRouter(prompt);

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

export const toggleTemplateAi = async (req, res) => {
  try {
    const { id } = req.params;
    const { aiResponse } = req.body;

    const updated = await TemplateModel.findByIdAndUpdate(
      id,
      { aiResponse: Boolean(aiResponse) },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }

    res.status(200).json({
      success: true,
      message: 'Template Auto Reply status updated successfully',
      data: updated,
    });
  } catch (err) {
    console.error('❌ Error updating template Auto Reply status:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

export const toggleAllTemplatesAi = async (req, res) => {
  try {
    const { userId, platform, aiResponse } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    const query = { userId };
    if (platform) query.platform = platform;

    await TemplateModel.updateMany(query, {
      $set: { aiResponse: Boolean(aiResponse) },
    });

    res.status(200).json({
      success: true,
      message: 'All templates Auto Reply status updated successfully',
    });
  } catch (err) {
    console.error('❌ Error updating all templates Auto Reply status:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

/*
|--------------------------------------------------------------------------
| Restore default Shopify templates
|--------------------------------------------------------------------------
|
| Default templates are created once, during signup. An account that
| predates that code, or whose signup partially failed, has none — and
| there was no way to get them back, so the Templates page stayed empty
| and scenarios had nothing to reply with.
|
| This rebuilds the set from the platform service list (master admin ->
| Scenario Triggers -> Service Routing), which is also what signup seeds
| from, so the two cannot drift.
|
| IDEMPOTENT
|
| Only templates that are actually missing are created, matched on
| (service, sequence). Running it twice adds nothing the second time, and
| it never touches a template the user has edited.
*/
export const restoreDefaultTemplates = async (req, res) => {
  try {
    const authUserId = getAuthUserId(req);
    const userId = req.body?.userId || req.query?.userId || authUserId;

    if (!isOwnerOrAdmin(req, userId)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You cannot restore another user's templates",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid user ID.' });
    }

    const services = (await loadPlatformRules()).services.list;
    const sequences = ['Initial Email', 'First Email', 'Second Email'];

    const existing = await TemplateModel.find({
      userId,
      platform: 'shopify',
    })
      .select('name')
      .lean();

    const existingNames = new Set(
      existing.map((t) => String(t.name || '').trim().toLowerCase())
    );

    const missing = [];

    services.forEach((service) => {
      sequences.forEach((sequence) => {
        const name = `${service} - ${sequence}`;

        if (existingNames.has(name.toLowerCase())) return;

        missing.push({
          userId,
          platform: 'shopify',
          service,
          name,
          conditions: [],
          content: `This is the ${sequence.toUpperCase()} template for ${service}. You can edit this content.`,
          active: true,
        });
      });
    });

    if (missing.length > 0) {
      await TemplateModel.insertMany(missing);
    }

    console.log(
      `[restoreDefaultTemplates] user=${userId} existing=${existing.length} created=${missing.length}`
    );

    return res.status(200).json({
      success: true,
      created: missing.length,
      existing: existing.length,
      message:
        missing.length > 0
          ? `${missing.length} template(s) restored.`
          : 'All default templates are already in place.',
    });
  } catch (error) {
    console.error('[restoreDefaultTemplates] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to restore default templates',
      error: error.message,
    });
  }
};
