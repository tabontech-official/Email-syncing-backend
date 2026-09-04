/*
|--------------------------------------------------------------------------
| Microsoft Graph — Send & Receive (polling)
|--------------------------------------------------------------------------
|
| Send and receive for provider "microsoft-oauth" over Microsoft Graph.
|
| Receiving is POLLING ONLY in this pass. Graph webhook subscriptions are
| deliberately not wired up — middleware/outlookWebhook.js stays inert.
|
| DESIGN NOTE — why this file is small:
|
| Incoming messages are fetched from Graph as raw MIME and handed to
| processIncomingEmail(), the SAME function the Gmail IMAP listener uses.
| That means dedupe, attachment upload, threading, reply-attachment and
| executeScenarios() all behave identically to Gmail. In particular the
| Subject Filter / branch-condition matching is NOT reimplemented here:
| executeScenarios() remains the single authority on whether a message
| matches a scenario. Anything added at the Graph query level is a
| narrowing optimisation only, never the decision.
|
| SAFETY: no access token and no message body is ever logged.
|
*/

import cron from 'node-cron';
import { ConnectionModel } from '../Models/Connection.js';
import { processIncomingEmail } from './gmailImapListener.js';
import {
  MICROSOFT_OAUTH_PROVIDER,
  MicrosoftReauthRequiredError,
  getValidMicrosoftAccessToken,
} from './microsoftTokenService.js';
import { markConnectionReauthRequired } from '../utils/connectionAlerts.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/* Cap per poll so one backlogged mailbox cannot monopolise a cycle. */
const MAX_MESSAGES_PER_POLL = 25;

/* How far back a first-ever poll looks, so a new connection is not flooded. */
const FIRST_POLL_LOOKBACK_MS = 10 * 60 * 1000;

/*
|--------------------------------------------------------------------------
| Reauth Marking
|--------------------------------------------------------------------------
|
| A 401 AFTER getValidMicrosoftAccessToken() already refreshed means the
| grant itself is no longer usable — the user must sign in again.
*/
const markReauthRequired = async (connectionId, reason) => {
  /*
   * Delegated so the owner is emailed about it. Marking the row without
   * telling anyone is what let a revoked grant sit unnoticed while every
   * scenario on that mailbox quietly refused to run.
   */
  await markConnectionReauthRequired(connectionId, reason);
};

const graphRequest = async (connectionId, path, options = {}) => {
  const accessToken = await getValidMicrosoftAccessToken(connectionId);

  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401) {
    /*
     * The token was freshly refreshed moments ago, so a 401 here is the
     * grant being revoked rather than simple expiry.
     */
    await markReauthRequired(
      connectionId,
      'Microsoft Graph returned 401 with a freshly refreshed token.'
    );

    throw new MicrosoftReauthRequiredError(
      'Microsoft Graph rejected the access token. The user must sign in with Microsoft again.',
      { connectionId }
    );
  }

  return response;
};

/*
|--------------------------------------------------------------------------
| SENDING
|--------------------------------------------------------------------------
|
| POST /me/sendMail
|
| Errors are thrown, never swallowed — the caller decides what a send
| failure means.
*/
export const sendMicrosoftEmail = async (
  connectionId,
  { to, subject, body, cc, bcc, isHtml = true } = {}
) => {
  if (!to) throw new Error('sendMicrosoftEmail: "to" is required.');

  const toRecipients = (Array.isArray(to) ? to : [to])
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

  const ccRecipients = (Array.isArray(cc) ? cc : cc ? [cc] : [])
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

  const bccRecipients = (Array.isArray(bcc) ? bcc : bcc ? [bcc] : [])
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));

  const payload = {
    message: {
      subject: subject || '',
      body: {
        contentType: isHtml ? 'HTML' : 'Text',
        content: body || '',
      },
      toRecipients,
      ...(ccRecipients.length ? { ccRecipients } : {}),
      ...(bccRecipients.length ? { bccRecipients } : {}),
    },
    saveToSentItems: true,
  };

  /* Recipient count and subject presence only — never the body. */
  console.log('[MicrosoftGraph] Sending mail', {
    connectionId: String(connectionId),
    recipients: toRecipients.length,
    hasSubject: Boolean(subject),
  });

  const response = await graphRequest(connectionId, '/me/sendMail', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  /* sendMail returns 202 Accepted with an empty body on success. */
  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    throw new Error(
      `Microsoft Graph sendMail failed (${response.status}): ${detail.slice(0, 300)}`
    );
  }

  console.log('[MicrosoftGraph] Mail accepted by Graph', {
    connectionId: String(connectionId),
    status: response.status,
  });

  return { success: true, status: response.status };
};

/*
|--------------------------------------------------------------------------
| RECEIVING — polling
|--------------------------------------------------------------------------
|
| Fetches messages newer than lastPolledAt, then pushes each through the
| shared incoming pipeline.
*/
export const pollMicrosoftInbox = async (connectionId) => {
  const connection = await ConnectionModel.findById(connectionId);

  if (!connection) throw new Error(`Connection ${connectionId} not found.`);

  if (connection.provider !== MICROSOFT_OAUTH_PROVIDER) {
    throw new Error(`Connection ${connectionId} is not ${MICROSOFT_OAUTH_PROVIDER}.`);
  }

  if (connection.status === 'reauth_required') {
    return { skipped: true, reason: 'reauth_required', fetched: 0, processed: 0 };
  }

  const since =
    connection.microsoftOAuth?.lastPolledAt ||
    new Date(Date.now() - FIRST_POLL_LOOKBACK_MS);

  /*
   * receivedDateTime is the only server-side filter applied. Subject
   * matching intentionally stays with executeScenarios() so there is one
   * source of truth for it.
   */
  const filter = encodeURIComponent(`receivedDateTime gt ${new Date(since).toISOString()}`);
  const path =
    `/me/messages?$filter=${filter}` +
    `&$select=id,subject,receivedDateTime` +
    `&$orderby=receivedDateTime asc` +
    `&$top=${MAX_MESSAGES_PER_POLL}`;

  const response = await graphRequest(connectionId, path);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Microsoft Graph message list failed (${response.status}): ${detail.slice(0, 300)}`
    );
  }

  const data = await response.json();
  const messages = data.value || [];

  let processed = 0;
  let skipped = 0;
  let newest = since ? new Date(since) : null;

  for (const message of messages) {
    try {
      /*
       * Fetch the raw MIME so the shared pipeline can parse it exactly as
       * it parses an IMAP message. uid is null — Graph has no IMAP UID, so
       * dedupe falls back to Message-ID, which is what we want.
       */
      const mimeResponse = await graphRequest(
        connectionId,
        `/me/messages/${message.id}/$value`
      );

      if (!mimeResponse.ok) {
        console.log('[MicrosoftGraph] Could not fetch MIME for a message', {
          connectionId: String(connectionId),
          status: mimeResponse.status,
        });
        continue;
      }

      const mime = Buffer.from(await mimeResponse.arrayBuffer());

      /*
       * The shared pipeline returns true only when a message was actually
       * stored. It legitimately skips self-sent mail and duplicates, so
       * counting handoffs here would overstate what happened.
       */
      const stored = await processIncomingEmail({
        connection,
        source: mime,
        uid: null,
      });

      if (stored) processed++;
      else skipped++;
    } catch (error) {
      if (error instanceof MicrosoftReauthRequiredError) throw error;

      /* Message-level failure must not abort the rest of the batch. */
      console.log('[MicrosoftGraph] Message processing failed', {
        connectionId: String(connectionId),
        error: error.message,
      });
    }

    const received = message.receivedDateTime
      ? new Date(message.receivedDateTime)
      : null;
    if (received && (!newest || received > newest)) newest = received;
  }

  /*
   * Advance the high-water mark even when nothing matched, so the window
   * does not grow without bound. Uses the newest receivedDateTime seen,
   * falling back to now.
   */
  await ConnectionModel.findByIdAndUpdate(connectionId, {
    $set: { 'microsoftOAuth.lastPolledAt': newest || new Date() },
  });

  return { skipped: false, fetched: messages.length, processed, skippedMessages: skipped };
};

/*
|--------------------------------------------------------------------------
| SCHEDULING
|--------------------------------------------------------------------------
|
| One connection failing must never stop the sweep.
*/
export const pollAllMicrosoftInboxes = async () => {
  const connections = await ConnectionModel.find({
    provider: MICROSOFT_OAUTH_PROVIDER,
    status: 'active', // 'reauth_required' is excluded by this filter
  }).select('_id email');

  if (!connections.length) return { polled: 0, newMessages: 0, failed: 0 };

  let newMessages = 0;
  let failed = 0;

  for (const connection of connections) {
    try {
      const result = await pollMicrosoftInbox(connection._id);
      newMessages += result.processed || 0;
    } catch (error) {
      failed++;

      if (error instanceof MicrosoftReauthRequiredError) {
        console.log(
          '[MicrosoftGraph] Connection needs re-authentication:',
          connection.email
        );
      } else {
        console.log(
          '[MicrosoftGraph] Poll failed for',
          connection.email,
          '-',
          error.message
        );
      }
    }
  }

  return { polled: connections.length, newMessages, failed };
};

let schedulerStarted = false;

export const startMicrosoftPollingScheduler = () => {
  if (schedulerStarted) return;
  schedulerStarted = true;

  /* Every 2 minutes. */
  cron.schedule('*/2 * * * *', async () => {
    try {
      const summary = await pollAllMicrosoftInboxes();

      /* Summary only — never per-message content. */
      if (summary.polled) {
        console.log(
          `[MicrosoftGraph] Polled ${summary.polled} Microsoft connection(s), ` +
            `${summary.newMessages} new message(s) processed` +
            (summary.failed ? `, ${summary.failed} failed` : '')
        );
      }
    } catch (error) {
      console.log('[MicrosoftGraph] Poll sweep failed:', error.message);
    }
  });

  console.log('Microsoft Graph inbox poller started (every 2 minutes)');
};
