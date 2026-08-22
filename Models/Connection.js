// import mongoose from 'mongoose';

// const connectionSchema = new mongoose.Schema(
//   {
//     userId: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: 'User',
//       required: true,
//     },
//     provider: {
//       type: String,
//       // enum: ['gmail', 'outlook', 'smtp','microsoft','imap'],
//       required: true,
//     },
//     subProvider: { type: String }, 

//     email: { type: String, required: true },
//     name: { type: String },
// outlookSubscription: {
//   id: { type: String },
//   resource: { type: String },
//   expirationDateTime: { type: String },
//   clientState: { type: String },
// },
//     tokens: { type: Object },
//     verified: {
//       type: Boolean,
//       default: false,
//     },
//     smtp: {
//       host: { type: String },
//       port: { type: Number },
//       username: { type: String },
//       password: { type: String },
//     },
//     gmailWatch: {
//       historyId: { type: String },
//       expiration: { type: String },
//       watchEnabledAt: { type: Date },
//     },
//     status: {
//       type: String,
//       enum: ['active', 'disconnected'],
//       default: 'active',
//     },
//   },
//   { timestamps: true }
// );

// connectionSchema.index({ userId: 1, email: 1 }, { unique: true });

// export const ConnectionModel = mongoose.model('Connection', connectionSchema);
import mongoose from "mongoose";

const connectionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /*
     * Managed providers (gmail, microsoft) have their host/port supplied
     * server-side from config/providerConfigs.js. "smtp" / "outlook" are
     * legacy + customer-configured ("Other Email") connections.
     *
     * A future OAuth-based Microsoft integration should be added as its
     * own provider value (e.g. "microsoft-oauth") so existing "microsoft"
     * app-password records need no migration.
     */
    provider: {
      type: String,
      required: true,
      enum: ["gmail", "microsoft", "microsoft-oauth", "smtp", "outlook"],
    },

    /*
     * Distinguishes auth strategies within one provider, e.g.
     * "google-app-password" vs "microsoft-app-password".
     */
    subProvider: {
      type: String,
      default: null,
    },

    connectionType: {
      type: String,
      enum: ["app-password", "oauth", "smtp", "imap"],
      default: "app-password",
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    name: {
      type: String,
      default: "My Gmail Connection",
      trim: true,
    },

    outlookSubscription: {
      id: {
        type: String,
      },
      resource: {
        type: String,
      },
      expirationDateTime: {
        type: String,
      },
      clientState: {
        type: String,
      },
    },

    /*
     * OAuth connections ke liye.
     * Gmail App Password connection mein empty rahega.
     */
    tokens: {
      type: Object,
      default: undefined,
    },

    verified: {
      type: Boolean,
      default: false,
    },

    /*
     * Outgoing email configuration.
     */
    smtp: {
      host: {
        type: String,
      },
      port: {
        type: Number,
      },
      secure: {
        type: Boolean,
        default: true,
      },
      username: {
        type: String,
      },
      password: {
        type: String,
        select: false,
      },
      verified: {
        type: Boolean,
        default: false,
      },
    },

    /*
     * Incoming email configuration.
     */
    imap: {
      host: {
        type: String,
      },
      port: {
        type: Number,
      },
      secure: {
        type: Boolean,
        default: true,
      },
      username: {
        type: String,
      },
      password: {
        type: String,
        select: false,
      },
      mailbox: {
        type: String,
        default: "INBOX",
      },
      verified: {
        type: Boolean,
        default: false,
      },
      uidValidity: {
        type: String,
        default: null,
      },
      uidNext: {
        type: Number,
        default: null,
      },
      lastUid: {
        type: Number,
        default: 0,
      },
      lastSyncAt: {
        type: Date,
        default: null,
      },
    },

    /*
     * Microsoft OAuth2 (MSAL) credentials — provider "microsoft-oauth".
     *
     * Deliberately NOT the snake_case { access_token, refresh_token,
     * expires_at } shape used by the retired simple-oauth2 flow.
     *
     * accessToken/refreshToken are encrypted at rest with the same
     * encrypt() helper used for Gmail app passwords, and are select:false
     * so an ordinary query can never serialise them into a response.
     *
     * expiresOn is stored in the clear on purpose: expiry must be
     * comparable without decrypting anything.
     */
    microsoftOAuth: {
      accessToken: { type: String, select: false },
      refreshToken: { type: String, select: false },
      expiresOn: { type: Date, default: null },
      account: { type: String },
      tenantId: { type: String },
      scopesGranted: { type: [String], default: [] },
      /* High-water mark for Graph polling; drives the receivedDateTime filter. */
      lastPolledAt: { type: Date, default: null },
    },

    gmailWatch: {
      historyId: {
        type: String,
      },
      expiration: {
        type: String,
      },
      watchEnabledAt: {
        type: Date,
      },
    },

    lastConnected: {
      type: Date,
      default: null,
    },

    lastConnectionError: {
      type: String,
      default: null,
    },

    /*
     * reauth_required: the OAuth refresh token was rejected (revoked,
     * expired, or consent withdrawn). Not broken config — the user must
     * sign in with Microsoft again.
     */
    status: {
      type: String,
      enum: ["active", "disconnected", "reauth_required"],
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

connectionSchema.index(
  {
    userId: 1,
    email: 1,
  },
  {
    unique: true,
  }
);

export const ConnectionModel = mongoose.model(
  "Connection",
  connectionSchema
);