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

    provider: {
      type: String,
      required: true,
    },

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

    status: {
      type: String,
      enum: ["active", "disconnected"],
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