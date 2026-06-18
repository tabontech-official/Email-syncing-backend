import LandingPage from '../Models/LandingPage.js';

const defaultContent = {
  logoText: 'Replex Engine',
  navbarLinks: [
    { label: 'Product', route: '/product' },
    { label: 'Developers', route: '/developer' },
    { label: 'Pricing', route: '/pricing' }
  ],
  hero: {
    badge: 'Lead Automation',
    mainTitle: 'Automate your lead replies\n',
    highlightedTitle: 'visually.',
    description: 'Build visual automation flows to reply to leads instantly, apply delays, and send the right email at the perfect time — without writing code.',
    buttons: [
      { text: 'Get Started For Free No Credit Card Required', route: '/register', isPrimary: true },
      { text: 'Watch Demo', route: '#demo', isPrimary: false }
    ],
    videoUrl: 'https://videos.ctfassets.net/un655fb9wln6/3wNElEdBiFdK2eauJB7wMp/021db93cbf76430c0b75cfb622876308/make_new_hero_animation.webm',
    demoVideoUrl: 'https://videos.ctfassets.net/un655fb9wln6/3wNElEdBiFdK2eauJB7wMp/021db93cbf76430c0b75cfb622876308/make_new_hero_animation.webm'
  },
  features: {
    title: 'Lead Automation Engine',
    subtitle: 'Capture leads, reply instantly, and automate follow-ups.',
    cards: [
      { iconName: 'FiZap', title: 'Capture', description: 'Automatically capture leads from email using mailhooks or forwarding.' },
      { iconName: 'PiRobotLight', title: 'Understand', description: 'Analyze incoming emails and detect intent or keywords.' },
      { iconName: 'FiSend', title: 'Reply', description: 'Send templates or AI-generated replies automatically.' },
      { iconName: 'FiRepeat', title: 'Follow-up', description: 'Create delayed follow-up sequences until the lead replies.' },
      { iconName: 'FiBarChart2', title: 'Track', description: 'Monitor every lead and see exactly where they are in your workflow.' }
    ]
  },
  cta: {
    title: 'Ready to automate your leads?',
    description: 'Build powerful automation flows with delays, conditions, and templates — and reply to every lead instantly.',
    buttons: [
      { text: 'Get Started Free', route: '/login', isPrimary: true },
      { text: 'Talk to Sales', route: '/talk-to-sales', isPrimary: false }
    ]
  },
  footer: {
    copyrightText: '© 2025 Replex Engine — AI powered lead automation',
    links: [
      { label: 'Privacy Policy', route: '/privacy-policy' },
      { label: 'Terms & Conditions', route: '/terms' }
    ]
  }
};

export const getLandingPageContent = async (req, res) => {
  try {
    let content = await LandingPage.findOne();
    if (!content) {
      return res.status(200).json(defaultContent);
    }
    res.status(200).json(content);
  } catch (err) {
    console.error('Error fetching landing page content:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateLandingPageContent = async (req, res) => {
  try {
    const updateData = req.body;
    let content = await LandingPage.findOne();
    
    if (!content) {
      content = new LandingPage(updateData);
      await content.save();
    } else {
      content = await LandingPage.findOneAndUpdate({}, updateData, { new: true, runValidators: true });
    }
    
    res.status(200).json({ message: 'Landing page updated successfully', content });
  } catch (err) {
    console.error('Error updating landing page content:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
