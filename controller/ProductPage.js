import ProductPage from "../Models/ProductPage.js";

const defaultProductContent = {
  logoText: "Replex Engine",

  hero: {
    badge: "Product",
    title: "Lead automation, built visually",
    description:
      "Build automated email replies, smart follow-ups, and lead workflows visually — without writing code.",
    buttons: [
      { text: "Start Automating Leads", route: "/login", isPrimary: true },
      { text: "View Solutions", route: "/solutions", isPrimary: false },
    ],
  },

  workflowSection: {
    title: "Everything your lead workflow needs",
    description:
      "Capture inbound leads, understand intent, send instant replies, and keep follow-ups running from one visual automation engine.",
    cards: [
      {
        iconName: "FiZap",
        label: "Visual builder",
        title: "Build lead workflows visually",
        description:
          "Create automated flows with conditions, delays, AI replies, and follow-up actions without touching code.",
        visualText: "incoming-lead → detect-intent → send-reply",
        className: "lg:col-span-2",
      },
      {
        iconName: "FiSend",
        label: "Smart replies",
        title: "Send the right response instantly",
        description:
          "Use templates or AI-assisted replies based on lead source, urgency, and message intent.",
        visualText: "Reply generated",
        className: "lg:row-span-2",
      },
      {
        iconName: "FiMail",
        label: "Lead capture",
        title: "Capture leads from email",
        description:
          "Connect your inbox, forwarding address, forms, or mailhooks and turn every message into a tracked lead.",
        visualText: "new lead received",
      },
      {
        iconName: "FiRepeat",
        label: "Follow-ups",
        title: "Keep follow-ups running",
        description:
          "Trigger delayed sequences automatically and stop them when the lead replies or converts.",
        visualText: "follow-up automation",
      },
    ],
  },

  scaleSection: {
    title: "Scale your lead automation",
    description: "A workflow engine built for every stage of your growth.",
    cards: [
      {
        iconName: "FiMail",
        title: "Dedicated lead inbox",
        description:
          "Connect your inbox or forwarding address and capture every inbound opportunity automatically.",
      },
      {
        iconName: "FiZap",
        title: "Built for your workflow",
        description:
          "Create lightweight or advanced automation flows with templates, AI replies, delays, and conditions.",
      },
      {
        iconName: "FiBarChart2",
        title: "Flexible automation",
        description:
          "Start simple and scale your lead handling as your team, volume, and follow-up needs grow.",
      },
    ],
  },

  contactSection: {
    title: "Talk to the team",
    description:
      "Tell us what you need and we’ll help you set up the right lead automation workflow.",
    bullets: [
      "Automated lead capture from email or forms",
      "AI-assisted replies and template workflows",
      "Smart follow-up sequences",
      "Lead tracking and reply status visibility",
      "Custom workflow automation for your team",
      "Setup support for sales teams and agencies",
    ],
    buttonText: "Contact us",
  },

  footer: {
    copyrightText: "© 2026 Replex Engine — AI powered lead automation",
  },
};

const mergeProductContent = (existing = {}) => {
  const data = existing?.toObject ? existing.toObject() : existing;

  return {
    ...defaultProductContent,
    ...data,

    hero: {
      ...defaultProductContent.hero,
      ...(data?.hero || {}),
      buttons:
        data?.hero?.buttons?.length > 0
          ? data.hero.buttons
          : defaultProductContent.hero.buttons,
    },

    workflowSection: {
      ...defaultProductContent.workflowSection,
      ...(data?.workflowSection || {}),
      cards:
        data?.workflowSection?.cards?.length > 0
          ? data.workflowSection.cards
          : defaultProductContent.workflowSection.cards,
    },

    scaleSection: {
      ...defaultProductContent.scaleSection,
      ...(data?.scaleSection || {}),
      cards:
        data?.scaleSection?.cards?.length > 0
          ? data.scaleSection.cards
          : defaultProductContent.scaleSection.cards,
    },

    contactSection: {
      ...defaultProductContent.contactSection,
      ...(data?.contactSection || {}),
      bullets:
        data?.contactSection?.bullets?.length > 0
          ? data.contactSection.bullets
          : defaultProductContent.contactSection.bullets,
    },

    footer: {
      ...defaultProductContent.footer,
      ...(data?.footer || {}),
    },
  };
};

export const getProductPageContent = async (req, res) => {
  try {
    let content = await ProductPage.findOne();

    if (!content) {
      content = await ProductPage.create(defaultProductContent);
      return res.status(200).json(content);
    }

    const mergedContent = mergeProductContent(content);

    const updatedContent = await ProductPage.findByIdAndUpdate(
      content._id,
      mergedContent,
      { new: true, runValidators: true }
    );

    return res.status(200).json(updatedContent);
  } catch (err) {
    console.error("Error fetching product page content:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const updateProductPageContent = async (req, res) => {
  try {
    const updateData = mergeProductContent(req.body);

    let content = await ProductPage.findOne();

    if (!content) {
      content = await ProductPage.create(updateData);
    } else {
      content = await ProductPage.findByIdAndUpdate(content._id, updateData, {
        new: true,
        runValidators: true,
        overwrite: true,
      });
    }

    return res.status(200).json({
      message: "Product page updated successfully",
      content,
    });
  } catch (err) {
    console.error("Error updating product page content:", err);
    return res.status(500).json({ error: "Server error" });
  }
};