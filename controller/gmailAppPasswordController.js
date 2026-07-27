import mongoose from "mongoose";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

import { encrypt } from "../middleware/encryption.js";
import { ConnectionModel } from "../Models/Connection.js";

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

/**
 * Google App Password se spaces remove karta hai.
 *
 * Input:
 * abcd efgh ijkl mnop
 *
 * Output:
 * abcdefghijklmnop
 */
const cleanAppPassword = (password = "") => {
  return String(password)
    .replace(/\s/g, "")
    .trim();
};

/**
 * Basic email validation.
 */
const isValidEmail = (email = "") => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

/**
 * Incoming Gmail IMAP connection test.
 */
const testImapConnection = async ({
  email,
  appPassword,
}) => {
  const client = new ImapFlow({
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

  try {
    await client.connect();

    const mailbox = await client.mailboxOpen(
      "INBOX",
      {
        readOnly: true,
      }
    );

    return {
      success: true,

      mailboxExists:
        Number(mailbox.exists) || 0,

      uidValidity: mailbox.uidValidity
        ? mailbox.uidValidity.toString()
        : null,

      uidNext: mailbox.uidNext
        ? Number(mailbox.uidNext)
        : null,
    };
  } finally {
    if (client.usable) {
      try {
        await client.logout();
      } catch (logoutError) {
        console.error(
          "IMAP logout error:",
          logoutError.message
        );
      }
    }
  }
};

/**
 * Outgoing Gmail SMTP connection test.
 */
const testSmtpConnection = async ({
  email,
  appPassword,
}) => {
  const transporter =
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

  try {
    await transporter.verify();

    return {
      success: true,
    };
  } finally {
    transporter.close();
  }
};

/**
 * Authentication-related errors detect karta hai.
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

/**
 * Network-related errors detect karta hai.
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

/**
 * POST /auth/gmail/app-password
 */
export const connectGmailWithAppPassword =
  async (req, res) => {
    let currentStep = "validation";

    try {
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

      /*
       * Validation
       */
      if (!userId) {
        return res.status(400).json({
          success: false,
          message: "User ID is required.",
        });
      }

      if (
        !mongoose.Types.ObjectId.isValid(userId)
      ) {
        return res.status(400).json({
          success: false,
          message: "Invalid User ID.",
        });
      }

      if (!normalizedEmail) {
        return res.status(400).json({
          success: false,
          message: "Gmail address is required.",
        });
      }

      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({
          success: false,
          message:
            "Please enter a valid email address.",
        });
      }

      if (!normalizedPassword) {
        return res.status(400).json({
          success: false,
          message:
            "Google App Password is required.",
        });
      }

      if (normalizedPassword.length !== 16) {
        return res.status(400).json({
          success: false,
          message:
            "Google App Password must contain exactly 16 characters.",
        });
      }

      /*
       * Test incoming Gmail connection.
       */
      currentStep = "imap";

      console.log(
        `Testing Gmail IMAP for ${normalizedEmail}`
      );

      const imapResult =
        await testImapConnection({
          email: normalizedEmail,
          appPassword: normalizedPassword,
        });

      console.log(
        `Gmail IMAP successful for ${normalizedEmail}`
      );

      /*
       * Test outgoing Gmail connection.
       */
      currentStep = "smtp";

      console.log(
        `Testing Gmail SMTP for ${normalizedEmail}`
      );

      await testSmtpConnection({
        email: normalizedEmail,
        appPassword: normalizedPassword,
      });

      console.log(
        `Gmail SMTP successful for ${normalizedEmail}`
      );

      /*
       * Encrypt App Password.
       */
      currentStep = "encryption";

      const encryptedAppPassword = encrypt(
        normalizedPassword
      );

      if (!encryptedAppPassword) {
        throw new Error(
          "Failed to encrypt Gmail App Password."
        );
      }

      /*
       * Find existing connection.
       *
       * Password fields select:false hain,
       * is liye explicit select use kiya hai.
       */
      currentStep = "database";

      let connection =
        await ConnectionModel.findOne({
          userId,
          email: normalizedEmail,
        }).select(
          "+smtp.password +imap.password"
        );

      if (!connection) {
        /*
         * New Gmail connection.
         */
        connection = new ConnectionModel({
          userId,

          provider: "gmail",
          subProvider:
            "google-app-password",
          connectionType:
            "app-password",

          email: normalizedEmail,
          name: connectionName,

          verified: true,

          smtp: {
            host: GMAIL_SMTP_CONFIG.host,
            port: GMAIL_SMTP_CONFIG.port,
            secure:
              GMAIL_SMTP_CONFIG.secure,
            username: normalizedEmail,
            password:
              encryptedAppPassword,
            verified: true,
          },

          imap: {
            host: GMAIL_IMAP_CONFIG.host,
            port: GMAIL_IMAP_CONFIG.port,
            secure:
              GMAIL_IMAP_CONFIG.secure,
            username: normalizedEmail,
            password:
              encryptedAppPassword,
            mailbox: "INBOX",
            verified: true,

            uidValidity:
              imapResult.uidValidity,

            uidNext:
              imapResult.uidNext,

            lastUid: 0,
            lastSyncAt: null,
          },

          status: "active",
          lastConnected: new Date(),
          lastConnectionError: null,
        });
      } else {
        /*
         * Existing connection update.
         */
        connection.provider = "gmail";
        connection.subProvider =
          "google-app-password";
        connection.connectionType =
          "app-password";

        connection.email =
          normalizedEmail;
        connection.name =
          connectionName;

        connection.verified = true;

        /*
         * Preserve previous sync state.
         */
        const previousLastUid =
          connection.imap?.lastUid || 0;

        const previousLastSyncAt =
          connection.imap?.lastSyncAt || null;

        connection.smtp = {
          host: GMAIL_SMTP_CONFIG.host,
          port: GMAIL_SMTP_CONFIG.port,
          secure:
            GMAIL_SMTP_CONFIG.secure,
          username: normalizedEmail,
          password:
            encryptedAppPassword,
          verified: true,
        };

        connection.imap = {
          host: GMAIL_IMAP_CONFIG.host,
          port: GMAIL_IMAP_CONFIG.port,
          secure:
            GMAIL_IMAP_CONFIG.secure,
          username: normalizedEmail,
          password:
            encryptedAppPassword,
          mailbox: "INBOX",
          verified: true,

          uidValidity:
            imapResult.uidValidity,

          uidNext:
            imapResult.uidNext,

          lastUid: previousLastUid,
          lastSyncAt:
            previousLastSyncAt,
        };

        /*
         * OAuth data remove.
         */
        connection.tokens = undefined;
        connection.gmailWatch = undefined;

        connection.status = "active";
        connection.lastConnected =
          new Date();
        connection.lastConnectionError =
          null;
      }

      await connection.save();

      console.log(
        `Gmail connection saved: ${connection._id}`
      );

      return res.status(200).json({
        success: true,

        message:
          "Gmail connected successfully for incoming and outgoing emails.",

        connectionId: connection._id,

        connection: {
          _id: connection._id,
          userId: connection.userId,
          name: connection.name,
          email: connection.email,
          provider: connection.provider,
          subProvider:
            connection.subProvider,
          connectionType:
            connection.connectionType,
          verified:
            connection.verified,
          status: connection.status,
          lastConnected:
            connection.lastConnected,
        },

        tests: {
          imap: true,
          smtp: true,
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
        `Gmail App Password connection failed during ${currentStep}:`,
        {
          name: error?.name,
          code: error?.code,
          message: error?.message,
          responseCode:
            error?.responseCode,
          response: error?.response,
        }
      );

      /*
       * App Password ko kabhi log na karein.
       */

      if (isAuthenticationError(error)) {
        return res.status(401).json({
          success: false,
          step: currentStep,
          message:
            "Google authentication failed. Check your Gmail address and App Password. Do not enter your normal Gmail password.",
        });
      }

      if (isNetworkError(error)) {
        return res.status(503).json({
          success: false,
          step: currentStep,
          message:
            "Unable to reach Gmail servers. Please check the server network and try again.",
        });
      }

      if (
        error?.code === 11000
      ) {
        return res.status(409).json({
          success: false,
          step: currentStep,
          message:
            "This Gmail account is already connected.",
        });
      }

      return res.status(500).json({
        success: false,
        step: currentStep,
        message:
          "Unable to connect the Gmail account.",

        error:
          process.env.NODE_ENV ===
          "development"
            ? error.message
            : undefined,
      });
    }
  };