/*
|--------------------------------------------------------------------------
| Microsoft Token Refresh (scheduled)
|--------------------------------------------------------------------------
|
| REWRITTEN for the MSAL OAuth flow.
|
| This file previously used simple-oauth2 and expected the old
| `connection.tokens = { access_token, refresh_token, expires_at }`
| shape written by the retired /auth/outlook handlers. That flow produced
| zero records and no longer exists, so nothing depends on that shape.
|
| It now works against provider "microsoft-oauth" and the encrypted
| `connection.microsoftOAuth` subdocument, and delegates all token
| handling to microsoftTokenService so there is exactly one place that
| decrypts, refreshes and re-encrypts.
|
| Refreshing here is an optimisation, not a correctness requirement:
| getValidMicrosoftAccessToken() refreshes on demand anyway. This keeps
| tokens warm and surfaces revoked consent before a user hits it.
|
*/

import cron from 'node-cron';
import { ConnectionModel } from '../Models/Connection.js';
import {
  MICROSOFT_OAUTH_PROVIDER,
  MicrosoftReauthRequiredError,
  getValidMicrosoftAccessToken,
} from './microsoftTokenService.js';

/*
 * Refresh anything expiring inside this window on each sweep.
 * Wider than the service's own 5-minute window so the scheduled pass
 * usually gets there first.
 */
const CRON_REFRESH_WINDOW_MS = 10 * 60 * 1000;

/*
 * Refreshes one connection.
 *
 * Returns { refreshed, reauthRequired }. The access token itself is
 * deliberately NOT returned or logged — callers that need one should ask
 * getValidMicrosoftAccessToken() directly.
 */
export const refreshMicrosoftToken = async (connection) => {
  const connectionId = connection?._id;

  if (!connectionId) {
    console.log('[MicrosoftRefresh] Called without a connection');
    return { refreshed: false, reauthRequired: false };
  }

  try {
    await getValidMicrosoftAccessToken(connectionId);

    console.log('[MicrosoftRefresh] Token valid/refreshed:', connection.email);

    return { refreshed: true, reauthRequired: false };
  } catch (error) {
    if (error instanceof MicrosoftReauthRequiredError) {
      /*
       * getValidMicrosoftAccessToken has already set status to
       * "reauth_required" — do not overwrite it with "disconnected",
       * which would lose the distinction between "needs a new sign-in"
       * and "switched off".
       */
      console.log(
        '[MicrosoftRefresh] Re-authentication required:',
        connection.email
      );

      return { refreshed: false, reauthRequired: true };
    }

    console.log(
      '[MicrosoftRefresh] Refresh error for',
      connection.email,
      '-',
      error.message
    );

    return { refreshed: false, reauthRequired: false };
  }
};

/*
 * Sweeps every active microsoft-oauth connection whose token is close to
 * expiry. expiresOn is stored unencrypted precisely so this comparison
 * needs no decryption.
 */
export const refreshExpiringMicrosoftTokens = async () => {
  const cutoff = new Date(Date.now() + CRON_REFRESH_WINDOW_MS);

  const connections = await ConnectionModel.find({
    provider: MICROSOFT_OAUTH_PROVIDER,
    status: 'active',
    $or: [
      { 'microsoftOAuth.expiresOn': { $lte: cutoff } },
      { 'microsoftOAuth.expiresOn': null },
    ],
  }).select('_id email microsoftOAuth.expiresOn');

  if (!connections.length) return { checked: 0, refreshed: 0, reauth: 0 };

  console.log(
    `[MicrosoftRefresh] ${connections.length} connection(s) due for refresh`
  );

  let refreshed = 0;
  let reauth = 0;

  for (const connection of connections) {
    const result = await refreshMicrosoftToken(connection);
    if (result.refreshed) refreshed++;
    if (result.reauthRequired) reauth++;
  }

  return { checked: connections.length, refreshed, reauth };
};

/*
 * Registers the schedule. This is exported and called explicitly rather
 * than running as an import side effect — the previous version scheduled
 * itself at import time, and since nothing imported the file, the cron
 * never actually ran.
 */
export const startMicrosoftTokenRefreshScheduler = () => {
  cron.schedule('*/30 * * * *', async () => {
    try {
      const summary = await refreshExpiringMicrosoftTokens();

      if (summary.checked) {
        console.log('[MicrosoftRefresh] Sweep complete', summary);
      }
    } catch (error) {
      console.log('[MicrosoftRefresh] Sweep failed:', error.message);
    }
  });

  console.log('Microsoft token refresh scheduler started');
};

export default refreshMicrosoftToken;
