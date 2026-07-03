export const PROVIDER_MAP = {
  gmail: {
    group: "gmail",
  },

  hotmail: {
    group: "microsoft",
    imap: {
      host: "outlook.office365.com",
      port: 993,
      secure: true,
    },
    smtp: {
      host: "smtp.office365.com",
      port: 587,
      secure: true,
    },
  },

  "outlook.com": {
    group: "microsoft",
    imap: {
      host: "outlook.office365.com",
      port: 993,
      secure: true,
    },
  },

  yandex: {
    group: "imap",
    imap: {
      host: "imap.yandex.com",
      port: 993,
      secure: true,
    },
  },

  zoho: {
    group: "imap",
    imap: {
      host: "imap.zoho.com",
      port: 993,
      secure: true,
    },
  },
};