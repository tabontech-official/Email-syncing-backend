// import LandingPage from '../Models/LandingPage.js';

// const defaultContent = {
//   logoText: 'Replex Engine',
//   navbarLinks: [
//     { label: 'Product', route: '/product' },
//     { label: 'Developers', route: '/developer' },
//     { label: 'Pricing', route: '/pricing' }
//   ],
//   hero: {
//     badge: 'Lead Automation',
//     mainTitle: 'Automate your lead replies\n',
//     highlightedTitle: 'visually.',
//     description: 'Build visual automation flows to reply to leads instantly, apply delays, and send the right email at the perfect time — without writing code.',
//     buttons: [
//       { text: 'Get Started For Free No Credit Card Required', route: '/register', isPrimary: true },
//       { text: 'Watch Demo', route: '#demo', isPrimary: false }
//     ],
//     videoUrl: 'https://videos.ctfassets.net/un655fb9wln6/3wNElEdBiFdK2eauJB7wMp/021db93cbf76430c0b75cfb622876308/make_new_hero_animation.webm',
//     demoVideoUrl: 'https://videos.ctfassets.net/un655fb9wln6/3wNElEdBiFdK2eauJB7wMp/021db93cbf76430c0b75cfb622876308/make_new_hero_animation.webm'
//   },
//   features: {
//     title: 'Lead Automation Engine',
//     subtitle: 'Capture leads, reply instantly, and automate follow-ups.',
//     cards: [
//       { iconName: 'FiZap', title: 'Capture', description: 'Automatically capture leads from email using mailhooks or forwarding.' },
//       { iconName: 'PiRobotLight', title: 'Understand', description: 'Analyze incoming emails and detect intent or keywords.' },
//       { iconName: 'FiSend', title: 'Reply', description: 'Send templates or AI-generated replies automatically.' },
//       { iconName: 'FiRepeat', title: 'Follow-up', description: 'Create delayed follow-up sequences until the lead replies.' },
//       { iconName: 'FiBarChart2', title: 'Track', description: 'Monitor every lead and see exactly where they are in your workflow.' }
//     ]
//   },
//   cta: {
//     title: 'Ready to automate your leads?',
//     description: 'Build powerful automation flows with delays, conditions, and templates — and reply to every lead instantly.',
//     buttons: [
//       { text: 'Get Started Free', route: '/login', isPrimary: true },
//       { text: 'Talk to Sales', route: '/talk-to-sales', isPrimary: false }
//     ]
//   },
//   footer: {
//     copyrightText: '© 2025 Replex Engine — AI powered lead automation',
//     links: [
//       { label: 'Privacy Policy', route: '/privacy-policy' },
//       { label: 'Terms & Conditions', route: '/terms' }
//     ]
//   }
// };

// export const getLandingPageContent = async (req, res) => {
//   try {
//     let content = await LandingPage.findOne();
//     if (!content) {
//       return res.status(200).json(defaultContent);
//     }
//     res.status(200).json(content);
//   } catch (err) {
//     console.error('Error fetching landing page content:', err);
//     res.status(500).json({ error: 'Server error' });
//   }
// };

// export const updateLandingPageContent = async (req, res) => {
//   try {
//     const updateData = req.body;
//     let content = await LandingPage.findOne();
    
//     if (!content) {
//       content = new LandingPage(updateData);
//       await content.save();
//     } else {
//       content = await LandingPage.findOneAndUpdate({}, updateData, { new: true, runValidators: true });
//     }
    
//     res.status(200).json({ message: 'Landing page updated successfully', content });
//   } catch (err) {
//     console.error('Error updating landing page content:', err);
//     res.status(500).json({ error: 'Server error' });
//   }
// };
import LandingPage from "../Models/LandingPage.js";

const defaultContent = {
  logoText: "Replex Engine",

  navbarLinks: [
    { label: "Product", route: "/product" },
    { label: "Developers", route: "/developer" },
    { label: "Pricing", route: "/pricing" },
  ],

  hero: {
    badge: "Shopify Partners Lead Automation Tool",
    mainTitle: "Automate your lead replies",
    highlightedTitle: "visually.",
    description:
      "Build visual automation flows to reply to leads instantly, apply delays, and send the right email at the perfect time — without writing code.",
    buttons: [
      {
        text: "Get Started For Free No Credit Card Required",
        route: "/register",
        isPrimary: true,
      },
      {
        text: "Watch Demo",
        route: "#demo",
        isPrimary: false,
      },
    ],
    trustItems: [
      "No-code workflows",
      "Instant AI replies",
      "Automated follow-ups",
    ],
    videoUrl: "Comming soon",
    demoVideoUrl: "Comming soon",
  },

  trustedCountries: [
    "United States",
    "United Kingdom",
    "Germany",
    "Canada",
    "Australia",
  ],

  leadAutomation: {
    badge: "Lead automation",
    title: "Capture, understand, and reply to every lead in minutes",
    description:
      "Replex Engine turns your inbox into an automated sales workflow.",
    bullets: [
      "Connect your lead inbox or forwarding address",
      "Let AI detect intent, urgency, and customer context",
      "Send instant replies and continue follow-ups automatically",
    ],
    pipelineLabel: "Active pipeline",
    pipelineTitle: "Agency lead scenario",
    pipelineStatus: "Running",
    steps: [
      { step: "01", title: "Lead", description: "Email received" },
      { step: "02", title: "Intent", description: "Template detected" },
      { step: "03", title: "Reply", description: "Response sent" },
      { step: "04", title: "Follow-up", description: "Sequence completed" },
    ],
    completionTitle: "Scenario completed",
    completionStatus: "Delivered",
    completionDescription:
      "Lead captured, intent analyzed, reply sent, and follow-up sequence completed automatically.",
    stats: [
      { label: "Reply time", value: "18s" },
      { label: "Lead score", value: "92%" },
      { label: "Status", value: "Won" },
    ],
  },

  clientCommunication: {
    badge: "Client Communication",
    title: "Keep every client conversation clear, fast, and organized",
    description:
      "Replex Engine helps your team handle incoming conversations, respond faster, and keep follow-ups consistent.",
    cards: [
      {
        title: "Clear conversation flow",
        text: "Keep every incoming message organized so your team knows what needs attention.",
      },
      {
        title: "Faster response handling",
        text: "Use ready replies and smart suggestions to answer clients quickly.",
      },
      {
        title: "Consistent follow-through",
        text: "Make sure no conversation is forgotten by keeping reminders and follow-ups aligned with your process.",
      },
      {
        title: "Simple team visibility",
        text: "Give your team a cleaner way to track client conversations, response status, and next steps from one place.",
      },
    ],
    buttonText: "Organize Conversations",
    buttonRoute: "/register",
  },

  testimonials: {
    badge: "Customer Reviews",
    title: "Trusted by teams who move fast",
    description:
      "Join businesses using Replex Engine to capture leads, send instant AI replies, and keep follow-ups running automatically.",
    buttonText: "Start automating for free",
    buttonRoute: "/register",
    quote:
      "Replex Engine helped us respond to every inbound lead without adding more sales reps.",
    authorName: "Replex Customer",
    authorRole: "Growth Team",
    leftReviews: [
      {
        name: "Ahmed Khan",
        handle: "@ahmedkhan",
        text: "Replex Engine replies faster than our team could manually. Lead response time dropped badly.",
      },
      {
        name: "Sara Malik",
        handle: "@saramalik",
        text: "The follow-up automation is the real win. Leads no longer go cold in our inbox.",
      },
    ],
    rightReviews: [
      {
        name: "Ayesha Noor",
        handle: "@ayesha",
        text: "Before Replex we missed replies. Now every inbound email gets handled instantly.",
      },
      {
        name: "Usman Tariq",
        handle: "@usman",
        text: "AI intent detection saves our sales team a lot of repetitive work.",
      },
    ],
  },

  footer: {
    copyrightText: "© 2025 Replex Engine — AI powered lead automation",
    links: [
      { label: "Privacy Policy", route: "/privacy-policy" },
      { label: "Terms & Conditions", route: "/terms" },
    ],
  },
};

const mergeLandingContent = (existing = {}) => {
  const data = existing?.toObject ? existing.toObject() : existing;

  return {
    ...defaultContent,
    ...data,

    navbarLinks:
      data?.navbarLinks?.length > 0
        ? data.navbarLinks
        : defaultContent.navbarLinks,

    hero: {
      ...defaultContent.hero,
      ...(data?.hero || {}),
      buttons:
        data?.hero?.buttons?.length > 0
          ? data.hero.buttons
          : defaultContent.hero.buttons,
      trustItems:
        data?.hero?.trustItems?.length > 0
          ? data.hero.trustItems
          : defaultContent.hero.trustItems,
    },

    trustedCountries:
      data?.trustedCountries?.length > 0
        ? data.trustedCountries
        : defaultContent.trustedCountries,

    leadAutomation: {
      ...defaultContent.leadAutomation,
      ...(data?.leadAutomation || {}),
      bullets:
        data?.leadAutomation?.bullets?.length > 0
          ? data.leadAutomation.bullets
          : defaultContent.leadAutomation.bullets,
      steps:
        data?.leadAutomation?.steps?.length > 0
          ? data.leadAutomation.steps
          : defaultContent.leadAutomation.steps,
      stats:
        data?.leadAutomation?.stats?.length > 0
          ? data.leadAutomation.stats
          : defaultContent.leadAutomation.stats,
    },

    clientCommunication: {
      ...defaultContent.clientCommunication,
      ...(data?.clientCommunication || {}),
      cards:
        data?.clientCommunication?.cards?.length > 0
          ? data.clientCommunication.cards
          : defaultContent.clientCommunication.cards,
    },

    testimonials: {
      ...defaultContent.testimonials,
      ...(data?.testimonials || {}),
      leftReviews:
        data?.testimonials?.leftReviews?.length > 0
          ? data.testimonials.leftReviews
          : defaultContent.testimonials.leftReviews,
      rightReviews:
        data?.testimonials?.rightReviews?.length > 0
          ? data.testimonials.rightReviews
          : defaultContent.testimonials.rightReviews,
    },

    footer: {
      ...defaultContent.footer,
      ...(data?.footer || {}),
      links:
        data?.footer?.links?.length > 0
          ? data.footer.links
          : defaultContent.footer.links,
    },
  };
};

export const getLandingPageContent = async (req, res) => {
  try {
    let content = await LandingPage.findOne();

    if (!content) {
      content = await LandingPage.create(defaultContent);
      return res.status(200).json(content);
    }

    const mergedContent = mergeLandingContent(content);

    const updatedContent = await LandingPage.findByIdAndUpdate(
      content._id,
      mergedContent,
      {
        new: true,
        runValidators: true,
      },
    );

    return res.status(200).json(updatedContent);
  } catch (err) {
    console.error("Error fetching landing page content:", err);
    return res.status(500).json({ error: "Server error" });
  }
};

export const updateLandingPageContent = async (req, res) => {
  try {
    const updateData = mergeLandingContent(req.body);

    let content = await LandingPage.findOne();

    if (!content) {
      content = await LandingPage.create(updateData);
    } else {
      content = await LandingPage.findByIdAndUpdate(content._id, updateData, {
        new: true,
        runValidators: true,
        overwrite: true,
      });
    }

    return res.status(200).json({
      message: "Landing page updated successfully",
      content,
    });
  } catch (err) {
    console.error("Error updating landing page content:", err);
    return res.status(500).json({ error: "Server error" });
  }
};