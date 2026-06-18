import mongoose from 'mongoose';

const landingPageSchema = new mongoose.Schema({
  logoText: { type: String, default: 'Replex Engine' },
  navbarLinks: [{
    label: { type: String, required: true },
    route: { type: String, required: true }
  }],
  hero: {
    badge: { type: String, default: 'Lead Automation' },
    mainTitle: { type: String, default: 'Automate your lead replies' },
    highlightedTitle: { type: String, default: 'visually.' },
    description: { type: String, default: 'Build visual automation flows to reply to leads instantly, apply delays, and send the right email at the perfect time — without writing code.' },
    buttons: [{
      text: { type: String, required: true },
      route: { type: String, required: true },
      isPrimary: { type: Boolean, default: false }
    }],
    videoUrl: { type: String, default: 'https://videos.ctfassets.net/un655fb9wln6/3wNElEdBiFdK2eauJB7wMp/021db93cbf76430c0b75cfb622876308/make_new_hero_animation.webm' },
    demoVideoUrl: { type: String, default: 'https://videos.ctfassets.net/un655fb9wln6/3wNElEdBiFdK2eauJB7wMp/021db93cbf76430c0b75cfb622876308/make_new_hero_animation.webm' }
  },
  features: {
    title: { type: String, default: 'Lead Automation Engine' },
    subtitle: { type: String, default: 'Capture leads, reply instantly, and automate follow-ups.' },
    cards: [{
      iconName: { type: String }, // e.g. "FiZap", "PiRobotLight", etc.
      title: { type: String, required: true },
      description: { type: String, required: true }
    }]
  },
  cta: {
    title: { type: String, default: 'Ready to automate your leads?' },
    description: { type: String, default: 'Build powerful automation flows with delays, conditions, and templates — and reply to every lead instantly.' },
    buttons: [{
      text: { type: String, required: true },
      route: { type: String, required: true },
      isPrimary: { type: Boolean, default: false }
    }]
  },
  footer: {
    copyrightText: { type: String, default: '© 2025 Replex Engine — AI powered lead automation' },
    links: [{
      label: { type: String, required: true },
      route: { type: String, required: true }
    }]
  }
}, { timestamps: true });

const LandingPage = mongoose.model('LandingPage', landingPageSchema);
export default LandingPage;
