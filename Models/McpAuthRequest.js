import mongoose from 'mongoose';
import crypto from 'crypto';

/*
|--------------------------------------------------------------------------
| One authorization, from request to redemption
|--------------------------------------------------------------------------
|
| A single document follows the whole handshake:
|
|   1. Claude sends the user to /mcp/oauth/authorize. We record what was
|      asked for and hand the browser a requestId.
|   2. The admin approves on the consent screen. We attach their user id
|      and the hash of a freshly minted authorization code.
|   3. Claude exchanges that code at /mcp/oauth/token. We mark it used.
|
| Keeping the three stages in one record is what makes step 3 checkable:
| the code can only be redeemed against the exact client, redirect URI and
| PKCE challenge that were present when the human said yes. A separate
| "codes" table would let those drift apart.
|
| THE CODE IS STORED HASHED, like every other credential here — a database
| dump must not yield a redeemable authorization code. It is single-use
| (`usedAt`) and short-lived, so an intercepted code is worth little even
| before PKCE is considered.
*/

export const generateRequestId = () => crypto.randomBytes(24).toString('base64url');

export const generateAuthCode = () => crypto.randomBytes(32).toString('base64url');

export const hashAuthCode = (code) =>
  crypto.createHash('sha256').update(String(code)).digest('hex');

/*
 * PKCE S256: the client sends a challenge up front and the verifier at
 * redemption. Only the party that generated the verifier can redeem, so a
 * stolen code alone is useless.
 */
export const verifyPkce = (verifier, challenge) => {
  if (!verifier || !challenge) return false;

  const computed = crypto
    .createHash('sha256')
    .update(String(verifier))
    .digest('base64url');

  /* Constant-time: these are equal-length base64url digests. */
  const a = Buffer.from(computed);
  const b = Buffer.from(String(challenge));

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const mcpAuthRequestSchema = new mongoose.Schema(
  {
    requestId: { type: String, required: true, unique: true, index: true },

    clientId: { type: String, required: true, index: true },

    /* Exactly as sent, so redemption can compare it byte-for-byte. */
    redirectUri: { type: String, required: true },

    state: { type: String, default: '' },
    scope: { type: String, default: 'read' },

    /* RFC 8707 — which resource the token is for. Bound into the token. */
    resource: { type: String, default: '' },

    codeChallenge: { type: String, required: true },
    codeChallengeMethod: { type: String, default: 'S256' },

    /* Set when the admin approves. Null while the consent screen is open. */
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    codeHash: { type: String, default: null, index: true },

    approvedAt: { type: Date, default: null },
    usedAt: { type: Date, default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

/* Mongo removes these on its own; nothing accumulates. */
mcpAuthRequestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

mcpAuthRequestSchema.methods.isPending = function isPending() {
  return !this.approvedAt && !this.usedAt && this.expiresAt > new Date();
};

mcpAuthRequestSchema.methods.isRedeemable = function isRedeemable() {
  return Boolean(this.approvedAt) && !this.usedAt && this.expiresAt > new Date();
};

export const McpAuthRequestModel = mongoose.model(
  'McpAuthRequest',
  mcpAuthRequestSchema
);
