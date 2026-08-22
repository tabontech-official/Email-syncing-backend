/*
|--------------------------------------------------------------------------
| Microsoft App Password Connection
|--------------------------------------------------------------------------
|
| Connects an Outlook.com / Hotmail / Live.com / Microsoft 365 mailbox
| using an app password, mirroring the Gmail app-password flow.
|
| Host and port are NOT accepted from the request body. They are read
| from the server-side provider registry (config/providerConfigs.js) so
| the customer never sees or edits them. See that file for the rationale
| before changing this.
|
*/

import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import mongoose from 'mongoose';
import { encrypt } from '../middleware/encryption.js';
import { ConnectionModel } from '../Models/Connection.js';
import { getProviderConfig } from '../config/providerConfigs.js';
import {
  restartGmailListener,
  startGmailListener,
} from '../middleware/gmailImapListener.js';

const MICROSOFT = getProviderConfig('microsoft');

const MICROSOFT_IMAP_CONFIG = MICROSOFT.imap;
const MICROSOFT_SMTP_CONFIG = MICROSOFT.smtp;

/*
|--------------------------------------------------------------------------
| Failure Reasons
|--------------------------------------------------------------------------
|
| Distinct, user-facing outcomes. These are deliberately NOT collapsed
| into one generic "connection failed" — a Microsoft 365 tenant blocking
| legacy auth needs a completely different action from a mistyped
| password, and the customer cannot tell them apart on their own.
|
*/

export const MICROSOFT_FAILURE_REASONS = Object.freeze({
  INVALID_CREDENTIALS: 'invalid_credentials',
  SMTP_AUTH_DISABLED: 'smtp_auth_disabled',
  APP_PASSWORD_BLOCKED: 'app_password_blocked',
  NETWORK: 'network',
  GENERIC: 'generic',
});

/*
|--------------------------------------------------------------------------
| Logging Helpers
|--------------------------------------------------------------------------
*/

/*
 * Defence in depth: the app password must never reach a log sink, not
 * even embedded inside a server error string echoed back by Microsoft.
 * Every value logged from this module passes through here first.
 */
const buildRedactor = (secret) => {
  const needle = String(secret || '');

  return (value) => {
    if (!needle || value === null || value === undefined) return value;

    const asText = typeof value === 'string' ? value : String(value);
    return asText.split(needle).join('[REDACTED]');
  };
};

const createLogger = (requestId, redact) => {
  return (...args) => {
    const safeArgs = args.map((arg) => {
      if (typeof arg === 'string') return redact(arg);

      if (arg && typeof arg === 'object') {
        try {
          return JSON.parse(redact(JSON.stringify(arg)));
        } catch {
          return arg;
        }
      }

      return arg;
    });

    console.log(
      `[MicrosoftConnection ${requestId} ${new Date().toISOString()}]`,
      ...safeArgs
    );
  };
};

/*
|--------------------------------------------------------------------------
| Input Normalisation
|--------------------------------------------------------------------------
*/

/*
 * Microsoft displays app passwords without spaces, but users often paste
 * them with whitespace from the portal. Unlike Google's, Microsoft app
 * passwords are NOT a fixed 16 characters, so length is not validated.
 */
const cleanAppPassword = (password = '') =>
  String(password).replace(/\s/g, '').trim();

const isValidEmail = (email = '') =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/*
|--------------------------------------------------------------------------
| Error Classification
|--------------------------------------------------------------------------
*/

const errorText = (error) =>
  String(
    [
      error?.response,
      error?.responseText,
      error?.message,
      error?.authenticationFailedText,
      error?.serverResponseCode,
    ]
      .filter(Boolean)
      .join(' ')
  ).toLowerCase();

const isNetworkError = (error) =>
  [
    'ETIMEDOUT',
    'ESOCKET',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'EAI_AGAIN',
  ].includes(error?.code);

/*
 * (b) The mailbox itself has Authenticated SMTP switched off.
 * Exchange Online reports this as:
 *   535 5.7.139 Authentication unsuccessful,
 *   SmtpClientAuthentication is disabled for the Mailbox
 */
const isSmtpAuthDisabled = (error) => {
  const text = errorText(error);

  return (
    text.includes('smtpclientauthentication is disabled') ||
    text.includes('smtp auth is disabled') ||
    text.includes('smtpclientauthentication')
  );
};

/*
 * (c) The tenant blocks this authentication method outright —
 * Security Defaults, Conditional Access, or basic/legacy auth disabled.
 */
const isAppPasswordBlocked = (error) => {
  const text = errorText(error);

  return (
    text.includes('basic authentication is disabled') ||
    text.includes('legacy authentication') ||
    text.includes('conditional access') ||
    text.includes('security defaults') ||
    text.includes('did not meet the criteria to be authenticated') ||
    /*
     * Exchange Online's signature reply when basic auth / app passwords
     * are switched off and only OAuth (XOAUTH2) is accepted:
     *   NO AUTHENTICATE failed. Provided authentication mechanism is not supported.
     * The words 'AUTHENTICATE failed' also appear for genuinely wrong
     * credentials, so this MUST be matched before the generic auth case
     * or the user is told to check a password that was never read.
     */
    text.includes('authentication mechanism is not supported') ||
    text.includes('mechanism is not supported') ||
    text.includes('basic auth') ||
    text.includes('tenant') ||
    /aadsts\d+/.test(text)
  );
};

/*
 * (a) Ordinary bad email / app password combination.
 */
const isAuthenticationError = (error) => {
  const text = errorText(error);

  return (
    error?.code === 'EAUTH' ||
    error?.responseCode === 535 ||
    error?.authenticationFailed === true ||
    text.includes('authenticationfailed') ||
    text.includes('authentication failed') ||
    /* bare IMAP form: 'NO AUTHENTICATE failed.' */
    text.includes('authenticate failed') ||
    text.includes('authentication unsuccessful') ||
    text.includes('invalid credentials') ||
    text.includes('login failed') ||
    text.includes('invalid login') ||
    text.includes('username and password not accepted')
  );
};

/*
 * Order matters: the most specific cause wins. A tenant-policy block and
 * a disabled-mailbox block both surface as 535, so they must be checked
 * before the generic credential case.
 */
export const classifyMicrosoftError = (error) => {
  if (isNetworkError(error)) return MICROSOFT_FAILURE_REASONS.NETWORK;
  if (isSmtpAuthDisabled(error))
    return MICROSOFT_FAILURE_REASONS.SMTP_AUTH_DISABLED;
  if (isAppPasswordBlocked(error))
    return MICROSOFT_FAILURE_REASONS.APP_PASSWORD_BLOCKED;
  if (isAuthenticationError(error))
    return MICROSOFT_FAILURE_REASONS.INVALID_CREDENTIALS;

  return MICROSOFT_FAILURE_REASONS.GENERIC;
};

const FAILURE_RESPONSES = Object.freeze({
  [MICROSOFT_FAILURE_REASONS.INVALID_CREDENTIALS]: {
    status: 401,
    message:
      'Microsoft rejected this email address and app password. Check both, and make sure you entered the app password generated by Microsoft — not your normal account password.',
  },

  [MICROSOFT_FAILURE_REASONS.SMTP_AUTH_DISABLED]: {
    status: 403,
    message:
      'The app password was rejected because Authenticated SMTP is turned off for this mailbox. Ask your admin to enable Authenticated SMTP for this mailbox.',
  },

  [MICROSOFT_FAILURE_REASONS.APP_PASSWORD_BLOCKED]: {
    status: 403,
    message:
      "The app password was rejected by your organization's security policy, which may block this method. Ask your Microsoft 365 admin to enable app passwords, or use OAuth if available.",
  },

  [MICROSOFT_FAILURE_REASONS.NETWORK]: {
    status: 503,
    message:
      'Unable to reach Microsoft mail servers. Please check the network connection and try again.',
  },

  [MICROSOFT_FAILURE_REASONS.GENERIC]: {
    status: 500,
    message: 'Unable to connect the Microsoft email account.',
  },
});

/*
|--------------------------------------------------------------------------
| IMAP Test — outlook.office365.com:993 (implicit TLS)
|--------------------------------------------------------------------------
*/

const testImapConnection = async ({ email, appPassword, log }) => {
  let client = null;

  try {
    log('Creating temporary Microsoft IMAP test client', {
      email,
      host: MICROSOFT_IMAP_CONFIG.host,
      port: MICROSOFT_IMAP_CONFIG.port,
    });

    client = new ImapFlow({
      host: MICROSOFT_IMAP_CONFIG.host,
      port: MICROSOFT_IMAP_CONFIG.port,
      secure: MICROSOFT_IMAP_CONFIG.secure,

      auth: {
        user: email,
        pass: appPassword,
      },

      /* Must stay false — imapflow's verbose logger prints credentials. */
      logger: false,

      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    /*
     * ImapFlow is an EventEmitter. When authentication fails the socket
     * is left open and can emit a LATER 'error' (typically a socket
     * timeout) after connect() has already rejected. With no listener
     * attached Node treats that as an unhandled 'error' event and kills
     * the whole process — i.e. one wrong password would take the server
     * down. This listener must stay attached.
     */
    client.on('error', (socketError) => {
      log('Microsoft IMAP socket error (ignored, test client)', {
        code: socketError?.code,
        message: socketError?.message,
      });
    });

    log('Connecting to Microsoft IMAP server');

    await client.connect();

    log('Microsoft IMAP authentication successful');

    const mailbox = await client.mailboxOpen(
      MICROSOFT_IMAP_CONFIG.mailbox,
      { readOnly: true }
    );

    const result = {
      success: true,

      mailboxExists: Number(mailbox?.exists) || 0,

      uidValidity: mailbox?.uidValidity
        ? mailbox.uidValidity.toString()
        : null,

      uidNext: mailbox?.uidNext ? Number(mailbox.uidNext) : null,
    };

    log('Microsoft INBOX opened successfully', result);

    return result;
  } finally {
    if (client?.usable) {
      try {
        log('Closing temporary Microsoft IMAP test connection');
        await client.logout();
        log('Temporary Microsoft IMAP test connection closed');
      } catch (logoutError) {
        log('Temporary Microsoft IMAP logout error', {
          message: logoutError.message,
        });
      }
    } else if (client) {
      /*
       * Not usable (e.g. auth was rejected) — tear the socket down hard
       * so it cannot time out later and emit on a dead handler.
       */
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| SMTP Test — smtp.office365.com:587 (STARTTLS)
|--------------------------------------------------------------------------
*/

const testSmtpConnection = async ({ email, appPassword, log }) => {
  let transporter = null;

  try {
    log('Creating temporary Microsoft SMTP test transporter', {
      email,
      host: MICROSOFT_SMTP_CONFIG.host,
      port: MICROSOFT_SMTP_CONFIG.port,
    });

    transporter = nodemailer.createTransport({
      host: MICROSOFT_SMTP_CONFIG.host,
      port: MICROSOFT_SMTP_CONFIG.port,

      /* Port 587 is STARTTLS: start plaintext, then upgrade. */
      secure: MICROSOFT_SMTP_CONFIG.secure,
      requireTLS: MICROSOFT_SMTP_CONFIG.requireTLS,

      auth: {
        user: email,
        pass: appPassword,
      },

      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    log('Verifying Microsoft SMTP credentials');

    await transporter.verify();

    log('Microsoft SMTP authentication successful');

    return { success: true };
  } finally {
    if (transporter) {
      try {
        transporter.close();
        log('Temporary Microsoft SMTP transporter closed');
      } catch (closeError) {
        log('Temporary Microsoft SMTP close error', {
          message: closeError.message,
        });
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| POST /auth/microsoft/app-password
|--------------------------------------------------------------------------
*/

export const connectMicrosoftWithAppPassword = async (req, res) => {
  const requestId = new mongoose.Types.ObjectId().toString().slice(-8);

  const { userId, name, email, appPassword } = req.body || {};

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = cleanAppPassword(appPassword);
  const connectionName =
    String(name || '').trim() || 'My Microsoft Connection';

  const redact = buildRedactor(normalizedPassword);
  const log = createLogger(requestId, redact);

  let currentStep = 'validation';
  let connection = null;
  let isNewConnection = false;

  try {
    log('=======================================');
    log('Microsoft App Password connection request started');
    log('=======================================');

    /* Never log the password itself — only whether one arrived. */
    log('Request information received', {
      userId,
      email: normalizedEmail,
      connectionName,
      appPasswordReceived: Boolean(normalizedPassword),
    });

    /*
    |--------------------------------------------------------------------------
    | Validation
    |--------------------------------------------------------------------------
    */

    if (!userId) {
      return res.status(400).json({
        success: false,
        step: currentStep,
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,
        message: 'User ID is required.',
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        step: currentStep,
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,
        message: 'Invalid User ID.',
      });
    }

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        step: currentStep,
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,
        message: 'Email address is required.',
      });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        step: currentStep,
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,
        message: 'Please enter a valid email address.',
      });
    }

    if (!normalizedPassword) {
      return res.status(400).json({
        success: false,
        step: currentStep,
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,
        message: 'Microsoft app password is required.',
      });
    }

    log('Request validation completed successfully');

    /*
    |--------------------------------------------------------------------------
    | Test IMAP
    |--------------------------------------------------------------------------
    */

    currentStep = 'imap';

    const imapResult = await testImapConnection({
      email: normalizedEmail,
      appPassword: normalizedPassword,
      log,
    });

    log('Microsoft IMAP test completed successfully', {
      mailboxMessages: imapResult.mailboxExists,
      uidValidity: imapResult.uidValidity,
      uidNext: imapResult.uidNext,
    });

    /*
    |--------------------------------------------------------------------------
    | Test SMTP
    |--------------------------------------------------------------------------
    */

    currentStep = 'smtp';

    await testSmtpConnection({
      email: normalizedEmail,
      appPassword: normalizedPassword,
      log,
    });

    log('Microsoft SMTP test completed successfully');

    /*
    |--------------------------------------------------------------------------
    | Encrypt App Password
    |--------------------------------------------------------------------------
    |
    | Same at-rest encryption helper the Gmail flow uses — no new storage
    | pattern is introduced here.
    */

    currentStep = 'encryption';

    const encryptedAppPassword = encrypt(normalizedPassword);

    if (!encryptedAppPassword) {
      throw new Error('Failed to encrypt Microsoft app password.');
    }

    log('Microsoft app password encrypted successfully');

    /*
    |--------------------------------------------------------------------------
    | Find Existing Connection
    |--------------------------------------------------------------------------
    */

    currentStep = 'database';

    connection = await ConnectionModel.findOne({
      userId,
      email: normalizedEmail,
    }).select('+smtp.password +imap.password');

    isNewConnection = !connection;

    log(
      isNewConnection
        ? 'No existing connection found. Creating new connection.'
        : 'Existing connection found. Updating connection.',
      { connectionId: connection?._id || null }
    );

    const smtpBlock = {
      host: MICROSOFT_SMTP_CONFIG.host,
      port: MICROSOFT_SMTP_CONFIG.port,
      secure: MICROSOFT_SMTP_CONFIG.secure,
      username: normalizedEmail,
      password: encryptedAppPassword,
      verified: true,
    };

    if (isNewConnection) {
      connection = new ConnectionModel({
        userId,

        provider: MICROSOFT.provider,
        subProvider: MICROSOFT.subProvider,
        connectionType: MICROSOFT.connectionType,

        email: normalizedEmail,
        name: connectionName,

        verified: true,

        smtp: smtpBlock,

        imap: {
          host: MICROSOFT_IMAP_CONFIG.host,
          port: MICROSOFT_IMAP_CONFIG.port,
          secure: MICROSOFT_IMAP_CONFIG.secure,
          username: normalizedEmail,
          password: encryptedAppPassword,
          mailbox: MICROSOFT_IMAP_CONFIG.mailbox,
          verified: true,

          uidValidity: imapResult.uidValidity,
          uidNext: imapResult.uidNext,

          /*
           * Only mail arriving after connection should be processed,
           * so start from the current end of the mailbox.
           */
          lastUid: imapResult.uidNext
            ? Math.max(Number(imapResult.uidNext) - 1, 0)
            : 0,

          lastSyncAt: new Date(),
        },

        status: 'active',
        lastConnected: new Date(),
        lastConnectionError: null,
      });
    } else {
      const previousLastUid = Number(connection.imap?.lastUid || 0);
      const previousLastSyncAt = connection.imap?.lastSyncAt || null;

      log('Preserving previous IMAP state', {
        previousLastUid,
        previousLastSyncAt,
      });

      connection.provider = MICROSOFT.provider;
      connection.subProvider = MICROSOFT.subProvider;
      connection.connectionType = MICROSOFT.connectionType;

      connection.email = normalizedEmail;
      connection.name = connectionName;
      connection.verified = true;

      connection.smtp = smtpBlock;

      connection.imap = {
        host: MICROSOFT_IMAP_CONFIG.host,
        port: MICROSOFT_IMAP_CONFIG.port,
        secure: MICROSOFT_IMAP_CONFIG.secure,
        username: normalizedEmail,
        password: encryptedAppPassword,
        mailbox: MICROSOFT_IMAP_CONFIG.mailbox,
        verified: true,

        uidValidity: imapResult.uidValidity,
        uidNext: imapResult.uidNext,

        lastUid: previousLastUid,
        lastSyncAt: previousLastSyncAt,
      };

      /* Drop any stale OAuth artefacts from a previous auth method. */
      connection.tokens = undefined;
      connection.gmailWatch = undefined;

      connection.status = 'active';
      connection.lastConnected = new Date();
      connection.lastConnectionError = null;
    }

    log('Saving Microsoft connection to database');

    await connection.save();

    log('Microsoft connection saved successfully', {
      connectionId: connection._id.toString(),
      email: connection.email,
      status: connection.status,
      newConnection: isNewConnection,
    });

    /*
    |--------------------------------------------------------------------------
    | Start or Restart Real-Time IMAP Listener
    |--------------------------------------------------------------------------
    |
    | The IMAP listener is provider-agnostic: it reads host/port from the
    | stored connection, so the same helper serves Gmail and Microsoft.
    */

    currentStep = 'listener';

    let listenerResult = null;

    try {
      listenerResult = isNewConnection
        ? await startGmailListener(connection._id)
        : await restartGmailListener(connection._id);

      log('Microsoft real-time listener activated successfully', {
        connectionId: connection._id.toString(),
        email: normalizedEmail,
      });

      await ConnectionModel.findByIdAndUpdate(connection._id, {
        $set: {
          status: 'active',
          lastConnected: new Date(),
          lastConnectionError: null,
        },
      });
    } catch (listenerError) {
      log('Microsoft connection saved, but listener activation failed', {
        connectionId: connection._id.toString(),
        error: redact(listenerError.message),
      });

      await ConnectionModel.findByIdAndUpdate(connection._id, {
        $set: { lastConnectionError: redact(listenerError.message) },
      });

      return res.status(500).json({
        success: false,
        step: 'listener',
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,

        message:
          'Microsoft credentials were verified and saved, but the real-time inbox listener could not be started.',

        connectionId: connection._id,
        connectionSaved: true,

        tests: { imap: true, smtp: true, realTimeListener: false },

        error:
          process.env.NODE_ENV === 'development'
            ? redact(listenerError.message)
            : undefined,
      });
    }

    log('=======================================');
    log('Microsoft connection process completed successfully');
    log('=======================================');

    return res.status(200).json({
      success: true,

      message:
        'Microsoft account connected successfully. Real-time incoming and outgoing email processing is active.',

      connectionId: connection._id,

      connection: {
        _id: connection._id,
        userId: connection.userId,
        name: connection.name,
        email: connection.email,
        provider: connection.provider,
        subProvider: connection.subProvider,
        connectionType: connection.connectionType,
        verified: connection.verified,
        status: connection.status,
        lastConnected: connection.lastConnected,
      },

      tests: { imap: true, smtp: true, realTimeListener: true },

      listener: {
        active: true,
        action: isNewConnection ? 'started' : 'restarted',
        result: listenerResult,
      },

      mailbox: {
        messages: imapResult.mailboxExists,
        uidValidity: imapResult.uidValidity,
        uidNext: imapResult.uidNext,
      },
    });
  } catch (error) {
    /*
     * Error payloads from Exchange Online echo the failed command back.
     * Everything here is redacted so the app password can never surface
     * in a log line.
     */
    console.error(
      `[MicrosoftConnection ${requestId}] Microsoft connection failed during ${currentStep}`,
      {
        name: error?.name,
        code: error?.code,
        message: redact(error?.message),
        responseCode: error?.responseCode,
        response: redact(error?.response),
      }
    );

    /* Duplicate connection is a schema-level conflict, not an auth issue. */
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        step: currentStep,
        reason: MICROSOFT_FAILURE_REASONS.GENERIC,
        message: 'This Microsoft account is already connected.',
      });
    }

    const reason = classifyMicrosoftError(error);
    const response = FAILURE_RESPONSES[reason];

    return res.status(response.status).json({
      success: false,
      step: currentStep,
      reason,
      message: response.message,

      connectionId: connection?._id || undefined,

      error:
        process.env.NODE_ENV === 'development'
          ? redact(error.message)
          : undefined,
    });
  }
};
