import { McpTokenModel, hashMcpToken } from '../Models/McpToken.js';
import { authModel } from '../Models/auth.js';

/*
|--------------------------------------------------------------------------
| MCP authentication
|--------------------------------------------------------------------------
|
| Resolves the bearer token an MCP client presents into the account it
| acts for, and decides whether that account may use the connector at all.
|
| MASTER ACCOUNT ONLY (for now)
|
| The connector is deliberately restricted to admin accounts while it is
| private. The gate is enforced HERE, on every call, rather than only when
| a token is issued — so demoting an account from admin disables its
| existing tokens immediately, instead of leaving live credentials behind
| that outlast the privilege they were granted under.
|
| To open the connector to ordinary users later, relax this one function;
| nothing else in the MCP layer assumes an admin.
*/

export const MCP_REQUIRES_ADMIN = true;

export class McpAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.name = 'McpAuthError';
    this.status = status;
  }
}

/* Pulls the credential out of an Authorization header. */
export const bearerFrom = (headerValue = '') => {
  const value = String(headerValue || '');
  if (!value.toLowerCase().startsWith('bearer ')) return '';
  return value.slice(7).trim();
};

/*
 * Resolve a token to { user, token, scope }.
 *
 * Throws McpAuthError with a status, never a bare 500 — an MCP client
 * needs to distinguish "your token is wrong" from "the server broke".
 */
export const resolveMcpToken = async (rawToken) => {
  if (!rawToken) {
    throw new McpAuthError('Missing MCP access token.', 401);
  }

  const record = await McpTokenModel.findOne({
    tokenHash: hashMcpToken(rawToken),
  });

  if (!record || !record.isUsable()) {
    /*
     * One message for "no such token", "revoked" and "expired". Telling a
     * caller which of those it is confirms that a token existed.
     */
    throw new McpAuthError('Invalid or revoked MCP access token.', 401);
  }

  const user = await authModel
    .findById(record.userId)
    .select('_id email fullName role subscription locked');

  if (!user) {
    throw new McpAuthError('The account for this token no longer exists.', 401);
  }

  if (user.locked) {
    throw new McpAuthError('This account is locked.', 403);
  }

  if (MCP_REQUIRES_ADMIN && user.role !== 'admin') {
    throw new McpAuthError(
      'The Replex Engine MCP connector is currently limited to the master account.',
      403
    );
  }

  /*
   * Best-effort: a failed usage stamp must not fail the call the client
   * actually made.
   */
  McpTokenModel.updateOne(
    { _id: record._id },
    { $set: { lastUsedAt: new Date() } }
  ).catch(() => {});

  return { user, token: record, scope: record.scope };
};
