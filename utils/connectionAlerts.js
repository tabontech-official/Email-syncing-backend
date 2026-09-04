import { ConnectionModel } from '../Models/Connection.js';
import { authModel } from '../Models/auth.js';
import { sendPlatformMail } from './platformMailer.js';

/*
|--------------------------------------------------------------------------
| Connection alerts — telling the owner their mailbox stopped working
|--------------------------------------------------------------------------
|
| A revoked OAuth grant is silent by nature. The refresh fails inside a
| background poll nobody is watching, the connection is marked
| "reauth_required", and from then on every scenario using it refuses to
| activate — while the user sees a mailbox they connected weeks ago and
| assume it still works.
|
| So the transition itself has to reach them. This is the one place that
| marks a connection as needing re-authentication, and it emails the owner
| the first time it happens.
|
| ONCE PER INCIDENT
|
| Mail polling runs on a schedule, so the same dead connection is
| rediscovered continuously. reauthNotifiedAt records that the owner has
| already been told; a hook on the Connection model wipes it when the
| connection goes back to active, so the next genuine failure is reported
| again.
|
| NEVER THROWS
|
| Marking the connection is the important half — the scenario must stop
| using a mailbox that cannot send whether or not the warning email gets
| through. A mail failure is logged and swallowed.
*/

/*
 * Where to send the user to fix it.
 *
 * FRONTEND_URL is what password reset already relies on; CORS_ORIGINS is
 * accepted as a second source because a deployment that serves a frontend
 * has to list it there anyway. Returns "" when neither is configured —
 * a relative path in an email is a dead link, so the caller drops the
 * button rather than shipping one that goes nowhere.
 */
const reconnectUrl = () => {
  const configured =
    process.env.FRONTEND_URL ||
    (process.env.CORS_ORIGINS || '').split(',')[0].trim();

  const base = configured.replace(/\/$/, '');
  return base ? `${base}/connection` : '';
};

const providerName = (connection) => {
  const provider = String(connection?.provider || '').toLowerCase();
  if (provider.includes('microsoft') || provider.includes('outlook'))
    return 'Microsoft';
  if (provider.includes('google') || provider.includes('gmail'))
    return 'Google';
  return 'Email';
};

const buildReauthEmailHtml = ({ name, email, provider, connectionsUrl }) => `
  <div style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;box-shadow:0 10px 25px rgba(15,23,42,0.08);">

        <div style="background:#b91c1c;padding:24px 28px;color:#ffffff;">
          <h1 style="margin:0;font-size:22px;font-weight:700;">Replex Engine</h1>
          <p style="margin:6px 0 0;font-size:14px;opacity:0.9;">Action required</p>
        </div>

        <div style="padding:28px;">
          <h2 style="margin:0 0 12px;font-size:24px;color:#0f172a;">
            Reconnect ${email}
          </h2>

          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#475569;">
            Hi ${name}, ${provider} has stopped accepting the sign-in for
            <strong>${email}</strong>. This usually means the password changed,
            access was withdrawn, or the sign-in simply expired.
          </p>

          <div style="border:1px solid #fecaca;border-radius:14px;background:#fef2f2;padding:18px;margin:22px 0;">
            <p style="margin:0;font-size:14px;line-height:1.7;color:#991b1b;">
              <strong>Your scenarios using this mailbox are not running.</strong>
              They will not send replies, and they cannot be switched on again,
              until the account is reconnected.
            </p>
          </div>

          <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#475569;">
            Reconnecting takes a few seconds — open your connections and sign in
            to ${provider} again. Nothing else in your setup changes, and your
            scenarios pick up where they left off.
          </p>

          ${
            connectionsUrl
              ? `<a href="${connectionsUrl}"
             style="display:inline-block;background:#b91c1c;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-size:15px;font-weight:700;">
            Reconnect ${email}
          </a>`
              : `<p style="margin:0;font-size:15px;font-weight:700;color:#0f172a;">
            Open Replex Engine and go to Connections to reconnect it.
          </p>`
          }

          <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#94a3b8;">
            Leads arriving while the mailbox is disconnected are still captured
            in your inbox — only the automatic replies are paused.
          </p>
        </div>
      </div>
    </div>
  </div>
`;

const buildReauthEmailText = ({ name, email, provider, connectionsUrl }) =>
  [
    `Hi ${name},`,
    '',
    `${provider} has stopped accepting the sign-in for ${email}.`,
    '',
    'Your scenarios using this mailbox are not running. They will not send',
    'replies, and they cannot be switched on again, until it is reconnected.',
    '',
    connectionsUrl
      ? `Reconnect it here: ${connectionsUrl}`
      : 'Open Replex Engine and go to Connections to reconnect it.',
    '',
    'Leads arriving meanwhile are still captured in your inbox — only the',
    'automatic replies are paused.',
    '',
    '— Replex Engine',
  ].join('\n');

/*
 * Email the owner that a connection needs re-authentication.
 *
 * Returns whether a message was actually sent, so callers can log it.
 * Silent when the owner cannot be resolved or has no address — there is
 * nobody to tell, and that must not break the poll that found the problem.
 */
export const sendReauthRequiredEmail = async (connection) => {
  try {
    const owner = await authModel
      .findById(connection.userId)
      .select('email fullName');

    if (!owner?.email) return false;

    const provider = providerName(connection);

    const view = {
      name: owner.fullName || 'there',
      email: connection.email || 'your mailbox',
      provider,
      connectionsUrl: reconnectUrl(),
    };

    await sendPlatformMail({
      to: owner.email,
      subject: `Action required: reconnect ${view.email}`,
      text: buildReauthEmailText(view),
      html: buildReauthEmailHtml(view),
    });

    return true;
  } catch (error) {
    console.error(
      '[connectionAlerts] Could not send reauth email:',
      error.message
    );
    return false;
  }
};

/*
 * Mark a connection as needing re-authentication, and tell its owner.
 *
 * Accepts either a loaded document or an id. Marking always happens;
 * the email is sent only on the transition into the broken state.
 */
export const markConnectionReauthRequired = async (
  connectionOrId,
  reason = 'Sign-in expired.'
) => {
  const connection =
    connectionOrId && typeof connectionOrId === 'object' && connectionOrId._id
      ? connectionOrId
      : await ConnectionModel.findById(connectionOrId);

  if (!connection) return false;

  const alreadyNotified = Boolean(connection.reauthNotifiedAt);

  connection.status = 'reauth_required';
  connection.lastConnectionError = reason;

  /*
   * Stamped BEFORE sending. Two pollers can find the same dead mailbox at
   * the same moment; whoever saves first owns the notification, and the
   * other sees a stamp already set and stays quiet. A lost email is better
   * than mailing the user on every poll cycle.
   */
  if (!alreadyNotified) connection.reauthNotifiedAt = new Date();

  await connection.save();

  if (alreadyNotified) return false;

  const sent = await sendReauthRequiredEmail(connection);

  console.log('[connectionAlerts] Connection needs re-authentication', {
    connectionId: String(connection._id),
    email: connection.email,
    reason,
    ownerNotified: sent,
  });

  return sent;
};

/*
 * Recovery is handled by the Connection model: a hook clears
 * reauthNotifiedAt whenever a connection is written back to "active", so
 * the next genuine failure is reported again. Nothing to call here.
 */
