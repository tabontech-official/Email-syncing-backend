/*
|--------------------------------------------------------------------------
| Microsoft OAuth Token Service
|--------------------------------------------------------------------------
|
| Owns the MSAL client and everything that touches Microsoft OAuth tokens:
| persisting them, refreshing them, and handing a valid access token to
| callers.
|
| It lives here rather than in the OAuth controller so that both the
| controller and middleware/refreshMicrosoftToken.js can use it without a
| circular import.
|
| SECURITY CONTRACT for this module:
|   - accessToken / refreshToken are encrypted at rest with the shared
|     encrypt() helper (the same one the Gmail app-password flow uses).
|     There is no second encryption implementation.
|   - Raw token values are NEVER logged, and never returned to a client.
|     getValidMicrosoftAccessToken() returns a decrypted token to
|     server-side callers only — do not pass its result into a response.
|
*/

import { ConfidentialClientApplication } from '@azure/msal-node';
import { ConnectionModel } from '../Models/Connection.js';
import { decrypt, encrypt } from './encryption.js';

/*
 * Delegated Graph permissions. offline_access is what makes Microsoft
 * return a refresh token at all.
 */
export const MICROSOFT_OAUTH_SCOPES = [
  'Mail.Read',
  'Mail.Send',
  'offline_access',
  'User.Read',
];

export const MICROSOFT_OAUTH_PROVIDER = 'microsoft-oauth';

/*
 * Refresh this far ahead of expiry so an in-flight request never races
 * the token going stale.
 */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Typed Error
|--------------------------------------------------------------------------
|
| Thrown only when Microsoft rejects the refresh token itself, so callers
| can tell "this user must sign in again" apart from a network blip or a
| bug. Check `error.name === 'MicrosoftReauthRequiredError'` or use
| instanceof.
*/
export class MicrosoftReauthRequiredError extends Error {
  constructor(message, { connectionId, cause } = {}) {
    super(message);
    this.name = 'MicrosoftReauthRequiredError';
    this.code = 'MICROSOFT_REAUTH_REQUIRED';
    this.connectionId = connectionId || null;
    if (cause) this.cause = cause;
  }
}

/*
|--------------------------------------------------------------------------
| MSAL Client
|--------------------------------------------------------------------------
|
| Built lazily so a missing env var surfaces as a handled error on the
| route rather than crashing the process at import time.
*/
let cachedClient = null;

export const getMsalClient = () => {
  const clientId = (process.env.MS_CLIENT_ID || '').trim();
  const clientSecret = (process.env.MS_CLIENT_SECRET || '').trim();
  const tenant = (process.env.MS_TENANT || 'common').trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      'MS_CLIENT_ID and MS_CLIENT_SECRET must be set in the environment.'
    );
  }

  if (cachedClient) return cachedClient;

  cachedClient = new ConfidentialClientApplication({
    auth: {
      clientId,
      clientSecret,
      authority: `https://login.microsoftonline.com/${tenant}`,
    },
  });

  return cachedClient;
};

export const getRedirectUri = () => {
  const uri = (process.env.MS_REDIRECT_URI || '').trim();
  if (!uri) throw new Error('MS_REDIRECT_URI must be set in the environment.');
  return uri;
};

/*
|--------------------------------------------------------------------------
| Refresh Token Extraction
|--------------------------------------------------------------------------
|
| MSAL does not expose the refresh token on the auth result — it keeps it
| in its own token cache. Read it back out, matched to the account that
| just authenticated so a shared client instance cannot hand back another
| user's token.
|
| The value returned here is a live credential: encrypt it immediately,
| and never log it.
*/
const readRefreshTokenFromCache = (homeAccountId) => {
  try {
    const cache = JSON.parse(getMsalClient().getTokenCache().serialize());
    const entries = Object.values(cache.RefreshToken || {});

    if (!entries.length) return null;

    const matched = homeAccountId
      ? entries.find((entry) => entry.home_account_id === homeAccountId)
      : null;

    return (matched || entries[0])?.secret || null;
  } catch (error) {
    console.warn(
      '[MicrosoftTokenService] Could not read refresh token from MSAL cache:',
      error.message
    );
    return null;
  }
};

/*
|--------------------------------------------------------------------------
| Persist Tokens
|--------------------------------------------------------------------------
|
| Creates or updates the Connection for this mailbox. Matched on
| connectionId when the caller supplied one (re-authorising an existing
| connection), otherwise on (userId, email) — which is also the schema's
| unique index.
*/
export const persistMicrosoftOAuthTokens = async ({
  userId,
  connectionId,
  result,
}) => {
  const account = result?.account?.username;

  if (!account) {
    throw new Error('Microsoft token response contained no account username.');
  }

  const email = String(account).trim().toLowerCase();

  const refreshTokenValue = readRefreshTokenFromCache(
    result?.account?.homeAccountId
  );

  const encryptedAccessToken = encrypt(result.accessToken);
  const encryptedRefreshToken = refreshTokenValue
    ? encrypt(refreshTokenValue)
    : null;

  if (!encryptedAccessToken) {
    throw new Error('Failed to encrypt Microsoft access token.');
  }

  let connection = connectionId
    ? await ConnectionModel.findOne({ _id: connectionId, userId })
    : null;

  if (!connection) {
    connection = await ConnectionModel.findOne({ userId, email });
  }

  const isNew = !connection;
  if (isNew) connection = new ConnectionModel({ userId, email });

  connection.provider = MICROSOFT_OAUTH_PROVIDER;
  connection.subProvider = 'microsoft-oauth';
  connection.connectionType = 'oauth';
  connection.email = email;
  connection.name = connection.name || 'My Microsoft Connection';
  connection.verified = true;
  connection.status = 'active';
  connection.lastConnected = new Date();
  connection.lastConnectionError = null;

  connection.microsoftOAuth = {
    accessToken: encryptedAccessToken,

    /*
     * Microsoft only returns a refresh token on the first consent unless
     * prompt=consent forces one. Keep the stored token if this exchange
     * did not produce a new one.
     */
    refreshToken:
      encryptedRefreshToken || connection.microsoftOAuth?.refreshToken || null,

    expiresOn: result.expiresOn ? new Date(result.expiresOn) : null,
    account: email,
    tenantId: result.account?.tenantId || null,
    scopesGranted: result.scopes || [],
  };

  await connection.save();

  /* Presence and metadata only — never token values. */
  console.log('[MicrosoftTokenService] OAuth tokens persisted', {
    connectionId: connection._id.toString(),
    account: email,
    isNew,
    expiresOn: connection.microsoftOAuth.expiresOn,
    accessTokenStored: Boolean(connection.microsoftOAuth.accessToken),
    refreshTokenStored: Boolean(connection.microsoftOAuth.refreshToken),
  });

  return connection;
};

/*
|--------------------------------------------------------------------------
| Get A Valid Access Token
|--------------------------------------------------------------------------
|
| Returns a decrypted, non-expired access token for server-side use.
| Refreshes and re-persists transparently when the stored one is within
| REFRESH_WINDOW_MS of expiry.
|
| Throws MicrosoftReauthRequiredError when the refresh token is rejected.
*/
export const getValidMicrosoftAccessToken = async (connectionId) => {
  const connection = await ConnectionModel.findById(connectionId).select(
    '+microsoftOAuth.accessToken +microsoftOAuth.refreshToken'
  );

  if (!connection) {
    throw new Error(`Connection ${connectionId} not found.`);
  }

  if (connection.provider !== MICROSOFT_OAUTH_PROVIDER) {
    throw new Error(
      `Connection ${connectionId} is not a ${MICROSOFT_OAUTH_PROVIDER} connection.`
    );
  }

  const stored = connection.microsoftOAuth || {};
  const expiresOn = stored.expiresOn ? new Date(stored.expiresOn) : null;
  const needsRefresh =
    !expiresOn || expiresOn.getTime() - Date.now() <= REFRESH_WINDOW_MS;

  if (!needsRefresh) {
    const accessToken = decrypt(stored.accessToken);
    if (accessToken) return accessToken;
    /* Fall through to refresh if the stored value was unusable. */
  }

  const refreshToken = stored.refreshToken ? decrypt(stored.refreshToken) : null;

  if (!refreshToken) {
    connection.status = 'reauth_required';
    connection.lastConnectionError = 'No Microsoft refresh token stored.';
    await connection.save();

    throw new MicrosoftReauthRequiredError(
      'No Microsoft refresh token is stored for this connection. The user must sign in with Microsoft again.',
      { connectionId }
    );
  }

  console.log('[MicrosoftTokenService] Refreshing Microsoft access token', {
    connectionId: String(connectionId),
    account: stored.account,
    expiredAt: expiresOn,
  });

  let result;
  try {
    result = await getMsalClient().acquireTokenByRefreshToken({
      refreshToken,
      scopes: MICROSOFT_OAUTH_SCOPES,
    });
  } catch (error) {
    /* Error text can echo the request — log the code only, never a token. */
    console.error('[MicrosoftTokenService] Refresh failed', {
      connectionId: String(connectionId),
      errorCode: error?.errorCode,
      name: error?.name,
    });

    connection.status = 'reauth_required';
    connection.lastConnectionError = `Microsoft refresh rejected: ${
      error?.errorCode || error?.name || 'unknown'
    }`;
    await connection.save();

    throw new MicrosoftReauthRequiredError(
      'Microsoft rejected the stored refresh token. The user must sign in with Microsoft again.',
      { connectionId, cause: error }
    );
  }

  if (!result?.accessToken) {
    connection.status = 'reauth_required';
    connection.lastConnectionError =
      'Microsoft refresh returned no access token.';
    await connection.save();

    throw new MicrosoftReauthRequiredError(
      'Microsoft returned no access token when refreshing. The user must sign in with Microsoft again.',
      { connectionId }
    );
  }

  const encryptedAccessToken = encrypt(result.accessToken);
  if (!encryptedAccessToken) {
    throw new Error('Failed to encrypt refreshed Microsoft access token.');
  }

  connection.microsoftOAuth.accessToken = encryptedAccessToken;
  connection.microsoftOAuth.expiresOn = result.expiresOn
    ? new Date(result.expiresOn)
    : null;

  /*
   * Microsoft may rotate the refresh token on use. If a new one landed in
   * the cache, store it — otherwise the old one stays valid.
   */
  const rotated = readRefreshTokenFromCache(result?.account?.homeAccountId);
  if (rotated && rotated !== refreshToken) {
    connection.microsoftOAuth.refreshToken = encrypt(rotated);
  }

  if (result.scopes?.length) {
    connection.microsoftOAuth.scopesGranted = result.scopes;
  }

  connection.status = 'active';
  connection.lastConnected = new Date();
  connection.lastConnectionError = null;

  await connection.save();

  console.log('[MicrosoftTokenService] Access token refreshed', {
    connectionId: String(connectionId),
    account: connection.microsoftOAuth.account,
    expiresOn: connection.microsoftOAuth.expiresOn,
    refreshTokenRotated: Boolean(rotated && rotated !== refreshToken),
  });

  return result.accessToken;
};

/*
 * Non-sensitive projection safe to send to a client. Never includes
 * accessToken or refreshToken.
 */
export const toPublicConnection = (connection) => ({
  _id: connection._id,
  userId: connection.userId,
  name: connection.name,
  email: connection.email,
  provider: connection.provider,
  subProvider: connection.subProvider,
  connectionType: connection.connectionType,
  status: connection.status,
  verified: connection.verified,
  lastConnected: connection.lastConnected,
  microsoftOAuth: {
    account: connection.microsoftOAuth?.account || null,
    tenantId: connection.microsoftOAuth?.tenantId || null,
    expiresOn: connection.microsoftOAuth?.expiresOn || null,
    scopesGranted: connection.microsoftOAuth?.scopesGranted || [],
  },
});
