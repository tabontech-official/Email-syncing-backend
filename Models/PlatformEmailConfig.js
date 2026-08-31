import mongoose from 'mongoose';

/*
|--------------------------------------------------------------------------
| Platform email configuration (singleton)
|--------------------------------------------------------------------------
|
| The mailbox Replex Engine itself sends from: welcome mail, password
| resets, plan notifications, forwarding validation tests. Distinct from a
| user's connected mailbox, which carries their own credentials and is used
| to send THEIR scenario replies — nothing here touches those.
|
| Before this, the platform mailbox came from process.env (EMAIL_USER /
| EMAIL_PASS / SMTP_HOST...) in ten places, and from credentials hardcoded
| in source in two more. Changing the sending address meant a redeploy, and
| the two hardcoded copies sent as an unrelated account entirely.
|
| SECRETS
|
| Passwords are encrypted at rest with the same AES helper the Stripe vault
| uses, and are never returned by the read endpoint — only a masked hint.
| Saving without a password keeps the stored one, so an admin editing the
| host does not have to retype the secret.
*/

const smtpSchema = new mongoose.Schema(
  {
    host: { type: String, default: '', trim: true },

    port: { type: Number, default: 587 },

    /*
     * True for implicit TLS (usually port 465). False for 587, where the
     * connection starts plain and upgrades via STARTTLS.
     */
    secure: { type: Boolean, default: false },

    /* Defaults to the from address when blank — most providers want them equal. */
    username: { type: String, default: '', trim: true },

    passwordEncrypted: { type: String, default: '' },

    /*
     * Only for a server with a self-signed certificate. Off means the
     * certificate chain is not verified, so leave it on unless a private
     * mail server genuinely requires otherwise.
     */
    rejectUnauthorized: { type: Boolean, default: true },
  },
  { _id: false }
);

/*
 * Inbound settings.
 *
 * NOTE: nothing reads these today — mail addressed to the platform arrives
 * through the mailhook webhook, not by polling a mailbox. They are stored
 * so the credentials live in one place if an inbound poller is added, and
 * the admin page labels them as inactive so nobody assumes they are live.
 */
const inboundSchema = new mongoose.Schema(
  {
    protocol: {
      type: String,
      enum: ['none', 'imap', 'pop3'],
      default: 'none',
    },

    host: { type: String, default: '', trim: true },
    port: { type: Number, default: 993 },
    secure: { type: Boolean, default: true },
    username: { type: String, default: '', trim: true },
    passwordEncrypted: { type: String, default: '' },
    rejectUnauthorized: { type: Boolean, default: true },
  },
  { _id: false }
);

const platformEmailConfigSchema = new mongoose.Schema(
  {
    /*
     * Off means fall back to the environment variables, which is the
     * behaviour that shipped. Nothing changes until an admin configures
     * and enables this.
     */
    enabled: { type: Boolean, default: false },

    /* Display name in the From header: "Replex Engine" <hello@...>. */
    fromName: { type: String, default: 'Replex Engine', trim: true },

    /* The address mail is sent from, and the SMTP username default. */
    fromEmail: { type: String, default: '', trim: true },

    /* Where replies go, when that differs from the sending address. */
    replyTo: { type: String, default: '', trim: true },

    smtp: { type: smtpSchema, default: () => ({}) },

    inbound: { type: inboundSchema, default: () => ({}) },

    /* Outcome of the last "send test email" from the admin panel. */
    lastTestedAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: null },
    lastTestError: { type: String, default: '' },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

export const PlatformEmailConfigModel =
  mongoose.models.PlatformEmailConfig ||
  mongoose.model('PlatformEmailConfig', platformEmailConfigSchema);
