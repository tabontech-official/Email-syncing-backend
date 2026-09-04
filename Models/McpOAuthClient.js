import mongoose from 'mongoose';
import crypto from 'crypto';

/*
|--------------------------------------------------------------------------
| MCP OAuth clients (RFC 7591 dynamic client registration)
|--------------------------------------------------------------------------
|
| An MCP client such as Claude has never heard of this server before the
| moment someone pastes the URL into it. It cannot have a client id we
| issued in advance, so it registers itself: POST /mcp/oauth/register,
| here is my name and my callback URL, give me an id.
|
| WHY OPEN REGISTRATION IS SAFE HERE
|
| Anyone can register a client — that is the point of the protocol, and it
| grants nothing on its own. A registration is only a name and a redirect
| URI; it becomes access solely when the master admin, signed in to this
| app, looks at a consent screen and approves it. So the gate is the human
| approval step, not the registration step.
|
| The redirect URI is the part that has to be defended: it is where the
| authorization code is delivered. It is stored exactly as registered and
| compared byte-for-byte at authorize time, and must be HTTPS or loopback,
| so a registration cannot be used to bounce a code to an attacker.
*/

export const generateClientId = () =>
  'rxe_client_' + crypto.randomBytes(16).toString('hex');

export const generateClientSecret = () =>
  crypto.randomBytes(32).toString('base64url');

export const hashClientSecret = (secret) =>
  crypto.createHash('sha256').update(String(secret)).digest('hex');

/*
 * OAuth 2.1 requires every redirect URI to be HTTPS, with an exception for
 * loopback addresses so a desktop client can receive the code on a local
 * port. Anything else is refused at registration rather than at authorize
 * time, so a bad client fails early and visibly.
 */
export const isAllowedRedirectUri = (value) => {
  let url;

  try {
    url = new URL(String(value));
  } catch {
    return false;
  }

  /* A fragment would be silently dropped when we redirect. */
  if (url.hash) return false;

  if (url.protocol === 'https:') return true;

  if (url.protocol === 'http:') {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  }

  return false;
};

const mcpOAuthClientSchema = new mongoose.Schema(
  {
    clientId: { type: String, required: true, unique: true, index: true },

    clientName: { type: String, default: 'MCP client', trim: true },

    /* Compared with exact string equality — never a prefix or wildcard. */
    redirectUris: { type: [String], default: [] },

    grantTypes: {
      type: [String],
      default: ['authorization_code', 'refresh_token'],
    },

    responseTypes: { type: [String], default: ['code'] },

    scope: { type: String, default: 'read' },

    /*
     * Public clients (PKCE, no secret) are the norm for MCP: a desktop app
     * cannot keep a secret. Confidential clients are still supported for
     * anything that can.
     */
    tokenEndpointAuthMethod: { type: String, default: 'none' },

    clientSecretHash: { type: String, default: null },

    softwareId: { type: String, default: '' },
    softwareVersion: { type: String, default: '' },

    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

mcpOAuthClientSchema.methods.isPublic = function isPublic() {
  return this.tokenEndpointAuthMethod === 'none' || !this.clientSecretHash;
};

export const McpOAuthClientModel = mongoose.model(
  'McpOAuthClient',
  mcpOAuthClientSchema
);
