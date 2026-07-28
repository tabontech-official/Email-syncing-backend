// import mongoose from "mongoose";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import mongoose from "mongoose";
import { encrypt } from "../middleware/encryption.js";
import { ConnectionModel } from "../Models/Connection.js";
import { restartGmailListener, startGmailListener } from "../middleware/gmailImapListener.js";


/*
|--------------------------------------------------------------------------
| Gmail Configuration
|--------------------------------------------------------------------------
*/

const GMAIL_IMAP_CONFIG = {
  host: "imap.gmail.com",
  port: 993,
  secure: true,
};

const GMAIL_SMTP_CONFIG = {
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
};

/*
|--------------------------------------------------------------------------
| Logging Helper
|--------------------------------------------------------------------------
*/

const createLogger = (requestId) => {
  return (...args) => {
    console.log(
      `[GmailConnection ${requestId} ${new Date().toISOString()}]`,
      ...args
    );
  };
};

/*
|--------------------------------------------------------------------------
| Clean Google App Password
|--------------------------------------------------------------------------
|
| Input:
| abcd efgh ijkl mnop
|
| Output:
| abcdefghijklmnop
|
*/

const cleanAppPassword = (password = "") => {
  return String(password)
    .replace(/\s/g, "")
    .trim();
};

/*
|--------------------------------------------------------------------------
| Email Validation
|--------------------------------------------------------------------------
*/

const isValidEmail = (email = "") => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/*
|--------------------------------------------------------------------------
| Test Gmail IMAP Connection
|--------------------------------------------------------------------------
*/

const testImapConnection = async ({
  email,
  appPassword,
  log,
}) => {
  let client = null;

  try {
    log("Creating temporary Gmail IMAP test client", {
      email,
      host: GMAIL_IMAP_CONFIG.host,
      port: GMAIL_IMAP_CONFIG.port,
    });

    client = new ImapFlow({
      host: GMAIL_IMAP_CONFIG.host,
      port: GMAIL_IMAP_CONFIG.port,
      secure: GMAIL_IMAP_CONFIG.secure,

      auth: {
        user: email,
        pass: appPassword,
      },

      logger: false,

      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    log("Connecting to Gmail IMAP server");

    await client.connect();

    log("Gmail IMAP authentication successful");

    const mailbox = await client.mailboxOpen(
      "INBOX",
      {
        readOnly: true,
      }
    );

    const result = {
      success: true,

      mailboxExists:
        Number(mailbox?.exists) || 0,

      uidValidity: mailbox?.uidValidity
        ? mailbox.uidValidity.toString()
        : null,

      uidNext: mailbox?.uidNext
        ? Number(mailbox.uidNext)
        : null,
    };

    log("Gmail INBOX opened successfully", result);

    return result;
  } finally {
    if (client?.usable) {
      try {
        log("Closing temporary Gmail IMAP test connection");

        await client.logout();

        log("Temporary Gmail IMAP test connection closed");
      } catch (logoutError) {
        console.error(
          "Temporary Gmail IMAP logout error:",
          logoutError.message
        );
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| Test Gmail SMTP Connection
|--------------------------------------------------------------------------
*/

const testSmtpConnection = async ({
  email,
  appPassword,
  log,
}) => {
  let transporter = null;

  try {
    log("Creating temporary Gmail SMTP test transporter", {
      email,
      host: GMAIL_SMTP_CONFIG.host,
      port: GMAIL_SMTP_CONFIG.port,
    });

    transporter =
      nodemailer.createTransport({
        host: GMAIL_SMTP_CONFIG.host,
        port: GMAIL_SMTP_CONFIG.port,
        secure: GMAIL_SMTP_CONFIG.secure,

        auth: {
          user: email,
          pass: appPassword,
        },

        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 30000,
      });

    log("Verifying Gmail SMTP credentials");

    await transporter.verify();

    log("Gmail SMTP authentication successful");

    return {
      success: true,
    };
  } finally {
    if (transporter) {
      try {
        transporter.close();

        log("Temporary Gmail SMTP transporter closed");
      } catch (closeError) {
        console.error(
          "Temporary Gmail SMTP close error:",
          closeError.message
        );
      }
    }
  }
};

/*
|--------------------------------------------------------------------------
| Authentication Error Detection
|--------------------------------------------------------------------------
*/

const isAuthenticationError = (error) => {
  const message = String(
    error?.response ||
      error?.message ||
      error?.serverResponseCode ||
      ""
  ).toLowerCase();

  return (
    error?.code === "EAUTH" ||
    error?.responseCode === 535 ||
    error?.authenticationFailed === true ||
    message.includes("authentication failed") ||
    message.includes("invalid credentials") ||
    message.includes(
      "application-specific password"
    ) ||
    message.includes(
      "username and password not accepted"
    ) ||
    message.includes("web login required") ||
    message.includes("invalid login") ||
    message.includes("credentials rejected")
  );
};

/*
|--------------------------------------------------------------------------
| Network Error Detection
|--------------------------------------------------------------------------
*/

const isNetworkError = (error) => {
  return [
    "ETIMEDOUT",
    "ESOCKET",
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
  ].includes(error?.code);
};

/*
|--------------------------------------------------------------------------
| POST /auth/gmail/app-password
|--------------------------------------------------------------------------
*/

export const connectGmailWithAppPassword =
  async (req, res) => {
    const requestId =
      new mongoose.Types.ObjectId()
        .toString()
        .slice(-8);

    const log = createLogger(requestId);

    let currentStep = "validation";
    let connection = null;
    let isNewConnection = false;

    try {
      log("=======================================");
      log("Gmail App Password connection request started");
      log("=======================================");

      const {
        userId,
        name,
        email,
        appPassword,
      } = req.body || {};

      const normalizedEmail = String(
        email || ""
      )
        .trim()
        .toLowerCase();

      const normalizedPassword =
        cleanAppPassword(appPassword);

      const connectionName =
        String(name || "").trim() ||
        "My Gmail Connection";

      log("Request information received", {
        userId,
        email: normalizedEmail,
        connectionName,
        appPasswordReceived:
          Boolean(normalizedPassword),
      });

      /*
      |--------------------------------------------------------------------------
      | Validation
      |--------------------------------------------------------------------------
      */

      currentStep = "validation";

      if (!userId) {
        log("Validation failed: User ID missing");

        return res.status(400).json({
          success: false,
          step: currentStep,
          message: "User ID is required.",
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        log("Validation failed: Invalid User ID", {
          userId,
        });

        return res.status(400).json({
          success: false,
          step: currentStep,
          message: "Invalid User ID.",
        });
      }

      if (!normalizedEmail) {
        log("Validation failed: Gmail address missing");

        return res.status(400).json({
          success: false,
          step: currentStep,
          message: "Gmail address is required.",
        });
      }

      if (!isValidEmail(normalizedEmail)) {
        log("Validation failed: Invalid email format", {
          email: normalizedEmail,
        });

        return res.status(400).json({
          success: false,
          step: currentStep,
          message:
            "Please enter a valid email address.",
        });
      }

      if (!normalizedPassword) {
        log("Validation failed: App Password missing");

        return res.status(400).json({
          success: false,
          step: currentStep,
          message:
            "Google App Password is required.",
        });
      }

      if (normalizedPassword.length !== 16) {
        log(
          "Validation failed: Invalid App Password length",
          {
            receivedLength:
              normalizedPassword.length,
          }
        );

        return res.status(400).json({
          success: false,
          step: currentStep,
          message:
            "Google App Password must contain exactly 16 characters.",
        });
      }

      log("Request validation completed successfully");

      /*
      |--------------------------------------------------------------------------
      | Test Gmail IMAP
      |--------------------------------------------------------------------------
      */

      currentStep = "imap";

      log("Starting Gmail IMAP test", {
        email: normalizedEmail,
      });

      const imapResult =
        await testImapConnection({
          email: normalizedEmail,
          appPassword:
            normalizedPassword,
          log,
        });

      log("Gmail IMAP test completed successfully", {
        mailboxMessages:
          imapResult.mailboxExists,
        uidValidity:
          imapResult.uidValidity,
        uidNext:
          imapResult.uidNext,
      });

      /*
      |--------------------------------------------------------------------------
      | Test Gmail SMTP
      |--------------------------------------------------------------------------
      */

      currentStep = "smtp";

      log("Starting Gmail SMTP test", {
        email: normalizedEmail,
      });

      await testSmtpConnection({
        email: normalizedEmail,
        appPassword:
          normalizedPassword,
        log,
      });

      log("Gmail SMTP test completed successfully");

      /*
      |--------------------------------------------------------------------------
      | Encrypt App Password
      |--------------------------------------------------------------------------
      */

      currentStep = "encryption";

      log("Encrypting Gmail App Password");

      const encryptedAppPassword = encrypt(
        normalizedPassword
      );

      if (!encryptedAppPassword) {
        throw new Error(
          "Failed to encrypt Gmail App Password."
        );
      }

      log("Gmail App Password encrypted successfully");

      /*
      |--------------------------------------------------------------------------
      | Find Existing Connection
      |--------------------------------------------------------------------------
      */

      currentStep = "database";

      log("Searching for existing Gmail connection", {
        userId,
        email: normalizedEmail,
      });

      connection =
        await ConnectionModel.findOne({
          userId,
          email: normalizedEmail,
        }).select(
          "+smtp.password +imap.password"
        );

      isNewConnection = !connection;

      log(
        isNewConnection
          ? "No existing connection found. Creating new connection."
          : "Existing connection found. Updating connection.",
        {
          connectionId:
            connection?._id || null,
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Create New Connection
      |--------------------------------------------------------------------------
      */

      if (isNewConnection) {
        connection =
          new ConnectionModel({
            userId,

            provider: "gmail",
            subProvider:
              "google-app-password",
            connectionType:
              "app-password",

            email:
              normalizedEmail,
            name:
              connectionName,

            verified: true,

            smtp: {
              host:
                GMAIL_SMTP_CONFIG.host,
              port:
                GMAIL_SMTP_CONFIG.port,
              secure:
                GMAIL_SMTP_CONFIG.secure,
              username:
                normalizedEmail,
              password:
                encryptedAppPassword,
              verified: true,
            },

            imap: {
              host:
                GMAIL_IMAP_CONFIG.host,
              port:
                GMAIL_IMAP_CONFIG.port,
              secure:
                GMAIL_IMAP_CONFIG.secure,
              username:
                normalizedEmail,
              password:
                encryptedAppPassword,
              mailbox: "INBOX",
              verified: true,

              uidValidity:
                imapResult.uidValidity,

              uidNext:
                imapResult.uidNext,

              /*
               * Only new emails received after
               * connection should be processed.
               */
              lastUid:
                imapResult.uidNext
                  ? Math.max(
                      Number(
                        imapResult.uidNext
                      ) - 1,
                      0
                    )
                  : 0,

              lastSyncAt:
                new Date(),
            },

            status: "active",
            lastConnected:
              new Date(),
            lastConnectionError:
              null,
          });
      } else {
        /*
        |--------------------------------------------------------------------------
        | Update Existing Connection
        |--------------------------------------------------------------------------
        */

        const previousLastUid =
          Number(
            connection.imap?.lastUid ||
              0
          );

        const previousLastSyncAt =
          connection.imap?.lastSyncAt ||
          null;

        log("Preserving previous IMAP state", {
          previousLastUid,
          previousLastSyncAt,
        });

        connection.provider =
          "gmail";

        connection.subProvider =
          "google-app-password";

        connection.connectionType =
          "app-password";

        connection.email =
          normalizedEmail;

        connection.name =
          connectionName;

        connection.verified =
          true;

        connection.smtp = {
          host:
            GMAIL_SMTP_CONFIG.host,
          port:
            GMAIL_SMTP_CONFIG.port,
          secure:
            GMAIL_SMTP_CONFIG.secure,
          username:
            normalizedEmail,
          password:
            encryptedAppPassword,
          verified: true,
        };

        connection.imap = {
          host:
            GMAIL_IMAP_CONFIG.host,
          port:
            GMAIL_IMAP_CONFIG.port,
          secure:
            GMAIL_IMAP_CONFIG.secure,
          username:
            normalizedEmail,
          password:
            encryptedAppPassword,
          mailbox: "INBOX",
          verified: true,

          uidValidity:
            imapResult.uidValidity,

          uidNext:
            imapResult.uidNext,

          lastUid:
            previousLastUid,

          lastSyncAt:
            previousLastSyncAt,
        };

        /*
         * Remove old Gmail OAuth data.
         */
        connection.tokens =
          undefined;

        connection.gmailWatch =
          undefined;

        connection.status =
          "active";

        connection.lastConnected =
          new Date();

        connection.lastConnectionError =
          null;
      }

      /*
      |--------------------------------------------------------------------------
      | Save Connection
      |--------------------------------------------------------------------------
      */

      log("Saving Gmail connection to database");

      await connection.save();

      log("Gmail connection saved successfully", {
        connectionId:
          connection._id.toString(),
        email:
          connection.email,
        status:
          connection.status,
        newConnection:
          isNewConnection,
      });

      /*
      |--------------------------------------------------------------------------
      | Start or Restart Real-Time IMAP Listener
      |--------------------------------------------------------------------------
      */

      currentStep = "listener";

      log(
        isNewConnection
          ? "Starting new Gmail real-time listener"
          : "Restarting existing Gmail real-time listener",
        {
          connectionId:
            connection._id.toString(),
          email:
            normalizedEmail,
        }
      );

      let listenerResult = null;

      try {
        if (isNewConnection) {
          listenerResult =
            await startGmailListener(
              connection._id
            );
        } else {
          listenerResult =
            await restartGmailListener(
              connection._id
            );
        }

        log(
          "Gmail real-time listener activated successfully",
          {
            connectionId:
              connection._id.toString(),
            email:
              normalizedEmail,
            listenerResult,
          }
        );

        await ConnectionModel.findByIdAndUpdate(
          connection._id,
          {
            $set: {
              status: "active",
              lastConnected:
                new Date(),
              lastConnectionError:
                null,
            },
          }
        );
      } catch (listenerError) {
        log(
          "Gmail connection saved, but listener activation failed",
          {
            connectionId:
              connection._id.toString(),
            email:
              normalizedEmail,
            error:
              listenerError.message,
            code:
              listenerError.code,
          }
        );

        await ConnectionModel.findByIdAndUpdate(
          connection._id,
          {
            $set: {
              lastConnectionError:
                listenerError.message,
            },
          }
        );

        return res.status(500).json({
          success: false,
          step: "listener",

          message:
            "Gmail credentials were verified and saved, but the real-time inbox listener could not be started.",

          connectionId:
            connection._id,

          connectionSaved:
            true,

          tests: {
            imap: true,
            smtp: true,
            realTimeListener:
              false,
          },

          error:
            process.env.NODE_ENV ===
            "development"
              ? listenerError.message
              : undefined,
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Success Response
      |--------------------------------------------------------------------------
      */

      log("=======================================");
      log("Gmail connection process completed successfully");
      log("=======================================");

      return res.status(200).json({
        success: true,

        message:
          "Gmail connected successfully. Real-time incoming and outgoing email processing is active.",

        connectionId:
          connection._id,

        connection: {
          _id:
            connection._id,
          userId:
            connection.userId,
          name:
            connection.name,
          email:
            connection.email,
          provider:
            connection.provider,
          subProvider:
            connection.subProvider,
          connectionType:
            connection.connectionType,
          verified:
            connection.verified,
          status:
            connection.status,
          lastConnected:
            connection.lastConnected,
        },

        tests: {
          imap: true,
          smtp: true,
          realTimeListener:
            true,
        },

        listener: {
          active: true,
          action:
            isNewConnection
              ? "started"
              : "restarted",
          result:
            listenerResult,
        },

        mailbox: {
          messages:
            imapResult.mailboxExists,
          uidValidity:
            imapResult.uidValidity,
          uidNext:
            imapResult.uidNext,
        },
      });
    } catch (error) {
      console.error(
        `[GmailConnection ${requestId}] Gmail connection failed during ${currentStep}`,
        {
          name:
            error?.name,
          code:
            error?.code,
          message:
            error?.message,
          responseCode:
            error?.responseCode,
          response:
            error?.response,

          /*
           * Never log appPassword or
           * encrypted password here.
           */
        }
      );

      /*
      |--------------------------------------------------------------------------
      | Authentication Failure
      |--------------------------------------------------------------------------
      */

      if (isAuthenticationError(error)) {
        return res.status(401).json({
          success: false,
          step:
            currentStep,

          message:
            "Google authentication failed. Check your Gmail address and App Password. Do not enter your normal Gmail password.",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Network Failure
      |--------------------------------------------------------------------------
      */

      if (isNetworkError(error)) {
        return res.status(503).json({
          success: false,
          step:
            currentStep,

          message:
            "Unable to reach Gmail servers. Please check the server network and try again.",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Duplicate Connection
      |--------------------------------------------------------------------------
      */

      if (error?.code === 11000) {
        return res.status(409).json({
          success: false,
          step:
            currentStep,

          message:
            "This Gmail account is already connected.",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | General Failure
      |--------------------------------------------------------------------------
      */

      return res.status(500).json({
        success: false,
        step:
          currentStep,

        message:
          currentStep ===
          "listener"
            ? "Gmail was connected, but its real-time listener could not be started."
            : "Unable to connect the Gmail account.",

        connectionId:
          connection?._id ||
          undefined,

        error:
          process.env.NODE_ENV ===
          "development"
            ? error.message
            : undefined,
      });
    }
  };