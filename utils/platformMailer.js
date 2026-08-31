import nodemailer from 'nodemailer';
import { PlatformEmailConfigModel } from '../Models/PlatformEmailConfig.js';
import { decrypt } from '../middleware/encryption.js';

/*
|--------------------------------------------------------------------------
| Platform mailer — one transport for everything Replex Engine sends
|--------------------------------------------------------------------------
|
| Every message the platform sends as itself goes through here: welcome
| mail, password resets, plan notifications, forwarding validation tests,
| internal alerts.
|
| It does NOT touch mail sent on a user's behalf. Those use the user's own
| connection credentials and stay where they are — a scenario reply must
| come from the customer's mailbox, not ours.
|
| RESOLUTION ORDER
|
|   1. The singleton config, when an admin has filled it in and enabled it.
|   2. process.env (EMAIL_USER / EMAIL_PASS / SMTP_HOST / SMTP_PORT /
|      SMTP_SECURE / SMTP_FROM), which is what shipped.
|
| So nothing changes until the config is enabled, and if an admin saves a
| broken configuration the environment is still there to fall back on.
*/

const CACHE_TTL_MS = 60 * 1000;

let cache = null;
let cachedAt = 0;
let cachedTransport = null;

export const invalidatePlatformMailer = () => {
  cache = null;
  cachedAt = 0;

  /* Free the pooled connections tied to the old credentials. */
  if (cachedTransport?.close) {
    try {
      cachedTransport.close();
    } catch {
      /* a transport that never connected has nothing to close */
    }
  }

  cachedTransport = null;
};

const envSettings = () => {
  const user = process.env.EMAIL_USER || '';

  return {
    source: 'env',
    fromName: 'Replex Engine',
    fromEmail: user,
    replyTo: '',
    smtp: {
      /* `service: gmail` was the shipped default where no host was set. */
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      username: user,
      password: process.env.EMAIL_PASS || '',
      rejectUnauthorized: true,
    },
    fromHeader:
      process.env.SMTP_FROM || (user ? `"Replex Engine" <${user}>` : ''),
  };
};

const decryptSafe = (value) => {
  if (!value) return '';

  try {
    return decrypt(value);
  } catch (error) {
    console.error('[platformMailer] Could not decrypt stored password:', error.message);
    return '';
  }
};

/*
 * The settings in effect right now. Never throws: a database problem must
 * not stop a password-reset email, so the environment stands in.
 */
export const loadPlatformEmailSettings = async ({ force = false } = {}) => {
  const now = Date.now();

  if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;

  let resolved = envSettings();

  try {
    const config = await PlatformEmailConfigModel.findOne({}).lean();

    if (config?.enabled && config.fromEmail && config.smtp?.host) {
      const password = decryptSafe(config.smtp.passwordEncrypted);
      const username = config.smtp.username || config.fromEmail;

      resolved = {
        source: 'config',
        fromName: config.fromName || 'Replex Engine',
        fromEmail: config.fromEmail,
        replyTo: config.replyTo || '',
        smtp: {
          host: config.smtp.host,
          port: Number(config.smtp.port) || 587,
          secure: Boolean(config.smtp.secure),
          username,
          password,
          rejectUnauthorized: config.smtp.rejectUnauthorized !== false,
        },
        fromHeader: `"${config.fromName || 'Replex Engine'}" <${config.fromEmail}>`,
      };
    }
  } catch (error) {
    console.error(
      '[platformMailer] Could not load config — using environment:',
      error.message
    );
  }

  cache = resolved;
  cachedAt = now;

  return resolved;
};

/* Builds a nodemailer transport from a settings object. */
export const buildTransport = (settings) =>
  nodemailer.createTransport({
    host: settings.smtp.host,
    port: settings.smtp.port,
    secure: settings.smtp.secure,
    auth: settings.smtp.username
      ? {
          user: settings.smtp.username,
          pass: settings.smtp.password,
        }
      : undefined,
    tls: { rejectUnauthorized: settings.smtp.rejectUnauthorized !== false },
  });

export const getPlatformTransport = async () => {
  const settings = await loadPlatformEmailSettings();

  /* Rebuild when the settings behind the pooled transport have changed. */
  if (!cachedTransport) {
    cachedTransport = buildTransport(settings);
  }

  return { transport: cachedTransport, settings };
};

/*
 * Send as the platform.
 *
 * Drop-in for the transporter.sendMail() calls this replaced: pass the same
 * options. `from` is filled in from the configuration when omitted, which
 * is what nearly every caller wants — hardcoding it was how two callers
 * ended up sending as an unrelated account.
 */
export const sendPlatformMail = async (options = {}) => {
  const { transport, settings } = await getPlatformTransport();

  if (!settings.smtp.host || !settings.smtp.username) {
    throw new Error(
      'Platform email is not configured. Set it in master admin → Platform Email, or provide EMAIL_USER / EMAIL_PASS.'
    );
  }

  return transport.sendMail({
    from: settings.fromHeader,
    ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
    ...options,
  });
};

/* The From header the platform sends with, for callers that build their own. */
export const platformFromHeader = async () =>
  (await loadPlatformEmailSettings()).fromHeader;

/* The bare platform address, for callers that need it without a display name. */
export const platformFromAddress = async () =>
  (await loadPlatformEmailSettings()).fromEmail;

/*
 * Verifies credentials against the server and optionally sends a test
 * message. Used by the admin panel so a bad password is caught there
 * rather than by a user who never receives a password reset.
 */
export const verifyPlatformEmail = async (settings, testRecipient = '') => {
  const transport = buildTransport(settings);

  try {
    await transport.verify();

    if (testRecipient) {
      await transport.sendMail({
        from: settings.fromHeader,
        to: testRecipient,
        subject: 'Replex Engine platform email test',
        text:
          'This is a test message from the Replex Engine master admin panel.\n\n' +
          `Sent via ${settings.smtp.host}:${settings.smtp.port} as ${settings.smtp.username}.\n\n` +
          'If you received this, platform email is configured correctly.',
      });
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (transport?.close) {
      try {
        transport.close();
      } catch {
        /* nothing to close */
      }
    }
  }
};
