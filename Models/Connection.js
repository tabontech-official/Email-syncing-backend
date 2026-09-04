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

    /*
     * When the owner was emailed that this connection needs signing in
     * again. Set once per incident and cleared the moment the connection
     * goes back to active, so a mailbox that breaks, is fixed, and breaks
     * again is reported each time — while a mailbox that stays broken and
     * is polled every minute is reported once.
     */
    reauthNotifiedAt: {
      type: Date,
      default: null,
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

/*
|--------------------------------------------------------------------------
| Recovery clears the "we told them" stamp
|--------------------------------------------------------------------------
|
| reauthNotifiedAt stops the owner being emailed on every poll of a
| mailbox that is already known to be broken. That means it MUST be
| cleared when the mailbox comes back, or the next genuine failure is
| silent — the bug this whole alert exists to prevent, one incident later.
|
| Reconnection happens down several paths (OAuth callback, app-password
| re-verification, admin repair), and each writes the connection its own
| way. Hooking the model catches all of them, including paths added later,
| rather than relying on every author to remember.
*/
const clearReauthStampOnRecovery = function (next) {
  if (this.status === "active" && this.reauthNotifiedAt) {
    this.reauthNotifiedAt = null;
  }
  next();
};

connectionSchema.pre("save", clearReauthStampOnRecovery);

/* The same rule for the update-in-place forms, which skip pre('save'). */
const clearReauthStampOnUpdate = function (next) {
  const update = this.getUpdate() || {};
  const nextStatus = update.status ?? update.$set?.status;

  if (nextStatus === "active") {
    update.$set = { ...(update.$set || {}), reauthNotifiedAt: null };
    this.setUpdate(update);
  }

  next();
};

connectionSchema.pre("findOneAndUpdate", clearReauthStampOnUpdate);
connectionSchema.pre("updateOne", clearReauthStampOnUpdate);
connectionSchema.pre("updateMany", clearReauthStampOnUpdate);

export const ConnectionModel = mongoose.model(
  "Connection",
  connectionSchema
);