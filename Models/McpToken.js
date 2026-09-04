import mongoose from 'mongoose';
import crypto from 'crypto';

/*
|--------------------------------------------------------------------------
| MCP access tokens
|--------------------------------------------------------------------------
|
| Credentials for the Model Context Protocol connector — what Claude,
| ChatGPT or any other MCP client presents to reach this account's data.
|
| WHY NOT REUSE THE LOGIN JWT
|
| A session JWT is short-lived, is minted by signing in, and cannot be
| revoked individually. An MCP client holds its credential indefinitely
| and stores it in a config file on the user's machine, so it needs the
| opposite properties: long-lived, individually revocable, and traceable
| to the tool that holds it.
|
| STORED HASHED
|
| Only a SHA-256 of the token is kept. A database dump therefore cannot be
| replayed against the connector, and the plaintext exists exactly once —
| in the response that created it. There is no way to show it again, which
| is deliberate: a token you can re-read is a token that leaks twice.
|
| SHA-256 rather than bcrypt on purpose. These are 256 bits of random,
| not passwords — there is no dictionary to attack, and the lookup happens
| on every MCP call, so a deliberately slow hash would only slow the
| server down.
*/

export const MCP_TOKEN_PREFIX = 'rxe_mcp_';

/* The value handed to the client. Never stored in this form. */
export const generateMcpToken = () =>
  MCP_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');

export const hashMcpToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

const mcpTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    /* Which client holds it — "Claude Desktop", "ChatGPT", "Laptop". */
    label: {
      type: String,
      default: 'MCP client',
      trim: true,
    },

    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    /*
     * The last few characters of the token, so a user can tell two
     * entries apart in a list without either being reversible.
     */
    tokenHint: {
      type: String,
      default: '',
    },

    /*
     * Read-only tokens cannot invoke a tool that changes anything. The
     * distinction matters because an MCP client acts on a model's
     * judgement, and "let it look, do not let it switch things off" is a
     * reasonable default for a connector.
     */
    scope: {
      type: String,
      enum: ['read', 'read_write'],
      default: 'read',
    },

    lastUsedAt: { type: Date, default: null },

    /* Revoked rather than deleted, so the audit trail survives. */
    revokedAt: { type: Date, default: null },

    expiresAt: { type: Date, default: null },

    /*
     |------------------------------------------------------------------
     | OAuth-issued tokens
     |------------------------------------------------------------------
     |
     | A token minted through the connector flow is the SAME kind of
     | record as one pasted in by hand. That is deliberate: the admin
     | panel lists both, and revoking either is one operation on one row.
     | A parallel "oauth tokens" collection would mean two places to look
     | when withdrawing access, which is how a live credential gets left
     | behind.
     */
    grantedVia: {
      type: String,
      enum: ['manual', 'oauth'],
      default: 'manual',
    },

    clientId: { type: String, default: null, index: true },

    /*
     | Rotated in place on every refresh rather than inserted as a new
     | row, so one authorization stays one line in the panel and revoking
     | it kills the access token and the refresh token together.
     */
    refreshTokenHash: { type: String, default: null, index: true },

    refreshExpiresAt: { type: Date, default: null },

    /* RFC 8707 audience. A token is only valid for the resource it names. */
    audience: { type: String, default: '' },
  },
  { timestamps: true }
);

mcpTokenSchema.methods.isUsable = function isUsable() {
  if (this.revokedAt) return false;
  if (this.expiresAt && this.expiresAt.getTime() <= Date.now()) return false;
  return true;
};

export const McpTokenModel = mongoose.model('McpToken', mcpTokenSchema);
