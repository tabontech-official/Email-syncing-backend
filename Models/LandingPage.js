import mongoose from "mongoose";

const buttonSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    route: { type: String, required: true },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true },
);

const reviewSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    handle: { type: String, default: "" },
    text: { type: String, default: "" },
  },
  { _id: true },
);

const landingPageSchema = new mongoose.Schema(
  {
    logoText: {
      type: String,
      default: "Replex Engine",
    },

    navbarLinks: [
      {
        label: { type: String, required: true },
        route: { type: String, required: true },
      },
    ],

    hero: {
      badge: {
        type: String,
        default: "Shopify Partners Lead Automation Tool",
      },
      mainTitle: {
        type: String,
        default: "Automate your lead replies",
      },
      highlightedTitle: {
        type: String,
        default: "visually.",
      },
      description: {
        type: String,
        default:
          "Build visual automation flows to reply to leads instantly, apply delays, and send the right email at the perfect time — without writing code.",
      },
      buttons: {
        type: [buttonSchema],
        default: [
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
      },
      trustItems: {
        type: [String],
        default: [
          "No-code workflows",
          "Instant AI replies",
          "Automated follow-ups",
        ],
      },
      videoUrl: {
        type: String,
        default: "Comming soon",
      },
      demoVideoUrl: {
        type: String,
        default: "Comming soon",
      },
    },

    trustedCountries: {
      type: [String],
      default: [
        "United States",
        "United Kingdom",
        "Germany",
        "Canada",
        "Australia",
      ],
    },

    leadAutomation: {
      badge: {
        type: String,
        default: "Lead automation",
      },
      title: {
        type: String,
        default: "Capture, understand, and reply to every lead in minutes",
      },
      description: {
        type: String,
        default:
          "Replex Engine turns your inbox into an automated sales workflow.",
      },
      bullets: {
        type: [String],
        default: [
          "Connect your lead inbox or forwarding address",
          "Let AI detect intent, urgency, and customer context",
          "Send instant replies and continue follow-ups automatically",
        ],
      },
      pipelineLabel: {
        type: String,
        default: "Active pipeline",
      },
      pipelineTitle: {
        type: String,
        default: "Agency lead scenario",
      },
      pipelineStatus: {
        type: String,
        default: "Running",
      },
      steps: {
        type: [
          {
            step: { type: String, default: "" },
            title: { type: String, default: "" },
            description: { type: String, default: "" },
          },
        ],
        default: [
          { step: "01", title: "Lead", description: "Email received" },
          { step: "02", title: "Intent", description: "Template detected" },
          { step: "03", title: "Reply", description: "Response sent" },
          {
            step: "04",
            title: "Follow-up",
            description: "Sequence completed",
          },
        ],
      },
      completionTitle: {
        type: String,
        default: "Scenario completed",
      },
      completionStatus: {
        type: String,
        default: "Delivered",
      },
      completionDescription: {
        type: String,
        default:
          "Lead captured, intent analyzed, reply sent, and follow-up sequence completed automatically.",
      },
      stats: {
        type: [
          {
            label: { type: String, default: "" },
            value: { type: String, default: "" },
          },
        ],
        default: [
          { label: "Reply time", value: "18s" },
          { label: "Lead score", value: "92%" },
          { label: "Status", value: "Won" },
        ],
      },
    },

    clientCommunication: {
      badge: {
        type: String,
        default: "Client Communication",
      },
      title: {
        type: String,
        default: "Keep every client conversation clear, fast, and organized",
      },
      description: {
        type: String,
        default:
          "Replex Engine helps your team handle incoming conversations, respond faster, and keep follow-ups consistent.",
      },
      cards: {
        type: [
          {
            title: { type: String, default: "" },
            text: { type: String, default: "" },
          },
        ],
        default: [
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
      },
      buttonText: {
        type: String,
        default: "Organize Conversations",
      },
      buttonRoute: {
        type: String,
        default: "/register",
      },
    },

    testimonials: {
      badge: {
        type: String,
        default: "Customer Reviews",
      },
      title: {
        type: String,
        default: "Trusted by teams who move fast",
      },
      description: {
        type: String,
        default:
          "Join businesses using Replex Engine to capture leads, send instant AI replies, and keep follow-ups running automatically.",
      },
      buttonText: {
        type: String,
        default: "Start automating for free",
      },
      buttonRoute: {
        type: String,
        default: "/register",
      },
      quote: {
        type: String,
        default:
          "Replex Engine helped us respond to every inbound lead without adding more sales reps.",
      },
      authorName: {
        type: String,
        default: "Replex Customer",
      },
      authorRole: {
        type: String,
        default: "Growth Team",
      },
      leftReviews: {
        type: [reviewSchema],
        default: [],
      },
      rightReviews: {
        type: [reviewSchema],
        default: [],
      },
    },

    footer: {
      copyrightText: {
        type: String,
        default: "© 2025 Replex Engine — AI powered lead automation",
      },
      links: [
        {
          label: { type: String, required: true },
          route: { type: String, required: true },
        },
      ],
    },
  },
  { timestamps: true },
);

const LandingPage = mongoose.model("LandingPage", landingPageSchema);

export default LandingPage;