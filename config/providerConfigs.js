/*
|--------------------------------------------------------------------------
| Email Provider Configuration Registry
|--------------------------------------------------------------------------
|
| Central lookup table for every *managed* email provider — that is, any
| provider where we know the mail server settings ahead of time and the
| customer must never be asked for them.
|
| WHY HOST / PORT ARE HARDCODED HERE
| ----------------------------------
| For Gmail and Microsoft the IMAP/SMTP endpoints are fixed, published,
| and identical for every customer. Exposing them as editable form fields
| only creates support tickets (typos, wrong ports, "SSL vs TLS"
| confusion) and lets a customer point our credentials at an arbitrary
| host. They are therefore server-side constants.
|
| Please do NOT "fix" this by moving host/port into the connection modal
| or into user-editable settings. If a customer genuinely needs custom
| mail servers, that is what the separate "Other Email" (custom SMTP)
| flow is for — it already collects host/port explicitly.
|
| FUTURE-PROOFING
| ---------------
| Each entry is keyed by the value stored in `connection.provider`, and
| carries its own `authMethod`. A provider is therefore free to gain a
| second authentication strategy later — e.g. `microsoft-oauth` — by
| adding a NEW top-level key here. Existing `microsoft` (app password)
| connection records keep working untouched, because nothing in this
| table assumes "one Microsoft entry" or derives auth method from the
| provider name. No data migration is required to add one.
|
*/

/*
 * Supported values for `connection.provider`.
 * Includes legacy values already present on stored records so that
 * validation never rejects an existing connection.
 */
export const CONNECTION_PROVIDERS = Object.freeze({
  GMAIL: 'gmail',
  MICROSOFT: 'microsoft',

  /* Legacy / non-managed providers, kept for backwards compatibility. */
  SMTP: 'smtp',
  OUTLOOK: 'outlook',
});

export const PROVIDER_CONFIGS = Object.freeze({
  /*
   * Microsoft personal + business mailboxes:
   * Outlook.com, Hotmail, Live.com, Office 365 / Microsoft 365.
   *
   * Authenticated with an app password (not the account password).
   */
  microsoft: {
    provider: CONNECTION_PROVIDERS.MICROSOFT,
    subProvider: 'microsoft-app-password',
    connectionType: 'app-password',
    authMethod: 'app-password',
    displayName: 'Outlook / Live / Microsoft 365',

    /* Incoming — IMAP over implicit TLS. */
    imap: {
      host: 'outlook.office365.com',
      port: 993,
      secure: true, // implicit SSL/TLS
      mailbox: 'INBOX',
    },

    /*
     * Outgoing — SMTP submission over STARTTLS.
     *
     * `secure: false` is correct and intentional for port 587: the
     * session starts in plaintext and is upgraded via STARTTLS. Setting
     * secure: true here would attempt implicit TLS on a STARTTLS port
     * and hang. `requireTLS` guarantees we never fall back to cleartext.
     */
    smtp: {
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      requireTLS: true,
    },
  },

  /*
   * Gmail / Google Workspace.
   *
   * Documented here for completeness and so the registry is the single
   * source of truth going forward. The existing Gmail connection flow
   * keeps its own local constants and is deliberately left untouched.
   */
  gmail: {
    provider: CONNECTION_PROVIDERS.GMAIL,
    subProvider: 'google-app-password',
    connectionType: 'app-password',
    authMethod: 'app-password',
    displayName: 'Gmail / Google Workspace',

    imap: {
      host: 'imap.gmail.com',
      port: 993,
      secure: true,
      mailbox: 'INBOX',
    },

    smtp: {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true, // implicit TLS
      requireTLS: false,
    },
  },
});

/*
 * Providers whose mail server settings we manage ourselves.
 * Anything not listed here is a customer-configured ("Other Email")
 * connection and keeps whatever host/port the customer supplied.
 */
export const MANAGED_PROVIDERS = Object.freeze(
  Object.keys(PROVIDER_CONFIGS)
);

export const getProviderConfig = (provider) => {
  const key = String(provider || '').toLowerCase();
  return PROVIDER_CONFIGS[key] || null;
};

export const isManagedProvider = (provider) =>
  Boolean(getProviderConfig(provider));
