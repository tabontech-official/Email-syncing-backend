/*
|--------------------------------------------------------------------------
| Microsoft OAuth2 (MSAL) — Authorization Code Flow
|--------------------------------------------------------------------------
|
| Replaces app-password / basic auth for Microsoft mailboxes. Exchange
| Online refuses basic auth outright:
|   "NO AUTHENTICATE failed. Provided authentication mechanism is not
|    supported."
| so OAuth is the only workable path for Microsoft 365 tenants.
|
| Routes:
|   GET /auth/outlook/connect   -> redirect the user to Microsoft
|   GET /auth/outlook/callback  -> exchange ?code for tokens
|
| The callback path must stay exactly /auth/outlook/callback because that
| is what is registered as the redirect URI in Azure. Changing it here
| without changing the Azure app registration breaks the whole flow.
|
| Tokens are persisted encrypted on the Connection record (provider
| "microsoft-oauth") by middleware/microsoftTokenService.js. Raw token
| values are never logged and never returned to the client.
|
*/

import {
  MICROSOFT_OAUTH_SCOPES,
  getMsalClient,
  getRedirectUri,
  persistMicrosoftOAuthTokens,
} from '../middleware/microsoftTokenService.js';

/* Re-exported for callers that imported it from here previously. */
export { MICROSOFT_OAUTH_SCOPES };

const getFrontendUrl = () =>
  (process.env.FRONTEND_URL || 'http://localhost:3006').replace(/\/$/, '');

/*
 * Build the post-callback URL safely.
 *
 * The `redirect` value carried through state is caller-supplied and may
 * already contain a leading slash and its own query string (the setup
 * page sends "/setup?step=5"). Naive interpolation produced
 * "host//setup?step=5?outlook-auth-success=true" — a double slash and a
 * second "?", which no router will match. Join the path and merge the
 * query properly instead.
 */
const buildRedirect = (redirectPath, params) => {
  const base = getFrontendUrl();
  const path = String(redirectPath || 'connection').replace(/^\/+/, '');

  const [pathname, existingQuery] = path.split('?');
  const query = new URLSearchParams(existingQuery || undefined);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) query.set(key, String(value));
  }

  return `${base}/${pathname}?${query.toString()}`;
};

/*
|--------------------------------------------------------------------------
| GET /auth/outlook/connect
|--------------------------------------------------------------------------
|
| Query params:
|   userId       (required) ReplexEngine user this mailbox belongs to
|   connectionId (optional) existing connection being re-authorised
|   redirect     (optional) frontend path to return to
|
| The identifiers travel through Microsoft in `state` and come back
| unchanged on the callback, which is how we know whose mailbox this is.
*/
export const startMicrosoftOAuth = async (req, res) => {
  try {
    const { userId, connectionId, redirect } = req.query;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId query parameter is required.',
      });
    }

    const state = JSON.stringify({
      userId,
      connectionId: connectionId || null,
      redirect: redirect || null,
    });

    const authCodeUrl = await getMsalClient().getAuthCodeUrl({
      scopes: MICROSOFT_OAUTH_SCOPES,
      redirectUri: getRedirectUri(),
      state,

      /*
       * Forces the consent screen so a refresh token is reliably issued
       * even if the user has authorised this app before.
       */
      prompt: 'consent',
    });

    console.log('[MicrosoftOAuth] Redirecting user to Microsoft', {
      userId,
      connectionId: connectionId || null,
      scopes: MICROSOFT_OAUTH_SCOPES.join(' '),
      redirectUri: getRedirectUri(),
    });

    return res.redirect(authCodeUrl);
  } catch (error) {
    console.error('[MicrosoftOAuth] Failed to build auth code URL:', error.message);

    return res.status(500).json({
      success: false,
      message: 'Unable to start Microsoft sign-in.',
      error:
        process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET /auth/outlook/callback
|--------------------------------------------------------------------------
|
| Microsoft redirects here with ?code and ?state (or ?error on refusal).
*/
export const microsoftOAuthCallback = async (req, res) => {
  const { code, state, error: oauthError, error_description: oauthErrorDesc } =
    req.query;

  /* Parse state back out; never let malformed state throw. */
  let parsedState = {};
  try {
    parsedState = state ? JSON.parse(state) : {};
  } catch {
    console.warn('[MicrosoftOAuth] Could not parse state:', state);
  }

  const redirectPath = parsedState.redirect || 'connection';

  try {
    /* The user declined consent, or Azure rejected the request. */
    if (oauthError) {
      console.error('[MicrosoftOAuth] Microsoft returned an error', {
        error: oauthError,
        description: oauthErrorDesc,
      });

      return res.redirect(
        buildRedirect(redirectPath, {
          'outlook-auth-success': 'false',
          reason: oauthError,
        })
      );
    }

    if (!code) {
      console.error('[MicrosoftOAuth] Callback hit without an authorization code');

      return res.redirect(
        buildRedirect(redirectPath, {
          'outlook-auth-success': 'false',
          reason: 'missing_code',
        })
      );
    }

    console.log('[MicrosoftOAuth] Callback received', {
      userId: parsedState.userId || null,
      connectionId: parsedState.connectionId || null,
      codeReceived: true,
    });

    /*
     * Scopes and redirectUri must match the /connect request exactly or
     * Microsoft rejects the exchange.
     */
    const result = await getMsalClient().acquireTokenByCode({
      code,
      scopes: MICROSOFT_OAUTH_SCOPES,
      redirectUri: getRedirectUri(),
      state,
    });

    /*
     * Persist the tokens (encrypted) against the Connection record.
     * userId / connectionId come from the state param, which is how we
     * know whose mailbox this is.
     */
    const connection = await persistMicrosoftOAuthTokens({
      userId: parsedState.userId,
      connectionId: parsedState.connectionId,
      result,
    });

    /*
     * Presence, expiry and account only. Raw access and refresh tokens
     * are never logged — they are live mailbox credentials.
     */
    console.log('[MicrosoftOAuth] Token acquired, expires:', result.expiresOn, {
      connectionId: connection._id.toString(),
      account: result.account?.username,
      tenantId: result.account?.tenantId,
      scopesGranted: (result.scopes || []).join(' '),
      accessTokenIssued: Boolean(result.accessToken),
      refreshTokenStored: Boolean(connection.microsoftOAuth?.refreshToken),
      idTokenIssued: Boolean(result.idToken),
    });

    /*
     * Tokens are now stored encrypted as provider "microsoft-oauth".
     * Still to come: starting a mail listener for OAuth connections —
     * Graph uses webhook subscriptions rather than the IMAP listener
     * the app-password providers share.
     */

    /*
     * The connected mailbox address is passed back so the frontend can
     * name the account in its success message. It is the user's own
     * address — no secret travels in the URL.
     */
    return res.redirect(
      buildRedirect(redirectPath, {
        'outlook-auth-success': 'true',
        email: result.account?.username || undefined,
      })
    );
  } catch (error) {
    console.error('[MicrosoftOAuth] Token exchange failed:', {
      name: error?.name,
      errorCode: error?.errorCode,
      message: error?.message,
    });

    return res.redirect(
      buildRedirect(redirectPath, {
        'outlook-auth-success': 'false',
        reason: 'token_exchange_failed',
      })
    );
  }
};
