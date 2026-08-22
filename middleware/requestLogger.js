/*
|--------------------------------------------------------------------------
| HTTP Request Logger
|--------------------------------------------------------------------------
|
| morgan('combined') logs the full request URL, query string included.
| For OAuth callbacks that means live authorization codes, client_info
| blobs and session state land in plaintext logs on every sign-in — a
| real credential leak, since anyone with log access could redeem a code
| before the user does.
|
| Rather than skipping these routes entirely (which would hide the fact
| that the callback was ever hit — exactly what you want to see while
| debugging), this logs the PATH and drops the query string.
|
| If you add a route that receives secrets in its URL, add it here too.
|
*/

import morgan from 'morgan';

/*
 * Paths whose query string must never be written to a log.
 * Matched as prefixes so mount points and trailing segments still hit.
 */
const REDACT_QUERY_PATHS = [
  /* Microsoft OAuth: ?code=...&client_info=...&state=...&session_state=... */
  '/auth/outlook/callback',

  /* Google OAuth: ?code=...&scope=... */
  '/auth/google/callback',

  /*
   * Flow initiators. They carry no secret today (userId + redirect), but
   * they are the other half of the same handshake and cost nothing to
   * cover if a signed state or hint is ever added.
   */
  '/auth/outlook/connect',
  '/auth/google',
];

/*
 * Paths where a secret arrives as a PATH segment rather than a query
 * param, so redacting the query alone would not help. The captured group
 * is what gets masked.
 */
const REDACT_PATH_SEGMENTS = [
  /* Magic-link login token: /auth/verify-login/<token> */
  /^(\/auth\/verify-login\/)[^/?]+/,
];

export const redactUrl = (originalUrl = '') => {
  const [path, query] = String(originalUrl).split('?');

  let safePath = path;

  for (const pattern of REDACT_PATH_SEGMENTS) {
    if (pattern.test(safePath)) {
      safePath = safePath.replace(pattern, '$1[REDACTED]');
      break;
    }
  }

  const needsQueryRedaction = REDACT_QUERY_PATHS.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

  if (needsQueryRedaction) {
    /*
     * Keep a marker so it is obvious the request HAD parameters and that
     * they were deliberately withheld, rather than looking like a bare
     * request that arrived without them.
     */
    return query ? `${safePath}?[REDACTED]` : safePath;
  }

  return query ? `${safePath}?${query}` : safePath;
};

morgan.token('url-safe', (req) => redactUrl(req.originalUrl || req.url));

/*
 * Identical to the 'combined' format, except :url is replaced by the
 * redacting :url-safe token.
 */
const SAFE_COMBINED_FORMAT =
  ':remote-addr - :remote-user [:date[clf]] ":method :url-safe HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';

export const requestLogger = morgan(SAFE_COMBINED_FORMAT);

/*
|--------------------------------------------------------------------------
| Sensitive Request Bodies
|--------------------------------------------------------------------------
|
| morgan does not log request bodies, so nothing here is redacting an
| active morgan leak. This exists so that the day someone adds body
| logging — a debug middleware, a verbose error handler that dumps
| req.body, an APM integration — these routes are excluded BY DEFAULT
| rather than silently starting to emit secrets.
|
| What each route carries:
|
|   /outlook/webhook  Microsoft Graph notifications include `clientState`,
|                     which is our shared secret (MS_CLIENT_STATE). Anyone
|                     who reads it can forge notifications that pass the
|                     validity check in middleware/outlookWebhook.js.
|
|   /gmail/webhook    Google Pub/Sub push delivers a base64 `message.data`
|                     payload, and its request HEADERS carry an
|                     `Authorization: Bearer <OIDC token>` used to verify
|                     the push originated from Google.
|
|   /auth/*           The app-password and SMTP endpoints receive live
|                     mailbox credentials in the body; the login and
|                     password-reset endpoints receive account passwords.
|
| Use `redactBody()` / `redactHeaders()` in any code that logs these, and
| check `req.sensitiveBody` in generic middleware that cannot know the
| route it is handling.
|
*/

export const SENSITIVE_BODY_PATHS = [
  '/gmail/webhook',
  '/outlook/webhook',
  '/auth/gmail/app-password',
  '/auth/microsoft/app-password',
  '/auth/saveSmtpConnection',
  '/auth/login',
  '/auth/signUp',
  '/auth/set-password',
  '/auth/forgot-password',
  '/stripe/webhook',
];

export const hasSensitiveBody = (path = '') => {
  const clean = String(path).split('?')[0];
  return SENSITIVE_BODY_PATHS.some(
    (prefix) => clean === prefix || clean.startsWith(`${prefix}/`)
  );
};

/*
 * Returns a safe stand-in for a body that must not be logged, and the
 * body unchanged otherwise. Never mutates the original.
 */
export const redactBody = (path, body) =>
  hasSensitiveBody(path) ? '[REDACTED — sensitive request body]' : body;

/*
 * Headers are redacted for every route, not just sensitive ones:
 * Authorization / Cookie carry credentials wherever they appear.
 */
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'stripe-signature',
];

export const redactHeaders = (headers = {}) => {
  const safe = { ...headers };

  for (const key of Object.keys(safe)) {
    if (SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    }
  }

  return safe;
};

/*
 * Tags the request so generic downstream logging can opt out without
 * needing its own copy of the path list.
 */
export const markSensitiveBodies = (req, _res, next) => {
  if (hasSensitiveBody(req.path)) req.sensitiveBody = true;
  next();
};

export default requestLogger;
