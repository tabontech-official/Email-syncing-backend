import crypto from 'crypto';
import {
  McpOAuthClientModel,
  generateClientId,
  generateClientSecret,
  hashClientSecret,
  isAllowedRedirectUri,
} from '../Models/McpOAuthClient.js';
import {
  McpAuthRequestModel,
  generateRequestId,
  generateAuthCode,
  hashAuthCode,
  verifyPkce,
} from '../Models/McpAuthRequest.js';
import {
  McpTokenModel,
  generateMcpToken,
  hashMcpToken,
} from '../Models/McpToken.js';
import { getAuthUserId } from '../middleware/authmiddleware.js';

/*
|--------------------------------------------------------------------------
| OAuth 2.1 for the MCP connector
|--------------------------------------------------------------------------
|
| What this exists for: Claude's "add a custom connector" flow takes a URL
| and nothing else. It cannot be handed a bearer token — there is no field
| for one — so the only way it can reach this server is to discover an
| authorization server, register itself, and walk a user through consent.
| That is what this file provides.
|
| The shape is fixed by the MCP authorization spec (2025-06-18), which
| composes four RFCs:
|
|   RFC 9728  protected resource metadata — "where is my auth server"
|   RFC 8414  authorization server metadata — "here are my endpoints"
|   RFC 7591  dynamic client registration — Claude introduces itself
|   RFC 8707  resource indicators — tokens are bound to THIS server
|
| plus OAuth 2.1 proper: authorization code, PKCE mandatory, exact
| redirect URI matching, rotating refresh tokens for public clients.
|
| WHERE THE HUMAN FITS
|
| Registration is open (it has to be — see McpOAuthClient), so the security
| boundary is the consent screen. /authorize does not grant anything; it
| parks the request and sends the browser to the admin panel, where the
| master admin, already signed in, sees who is asking and approves or
| refuses. Only that approval mints a code.
|
| This server is both the authorization server and the resource server.
| Issuing and validating in one place is why the tokens can stay opaque
| random strings rather than signed JWTs: there is no third party that
| needs to verify them without asking us.
*/

/* Access tokens outlive a browser session but not a forgotten laptop. */
const ACCESS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/* Long enough for a human to read the consent screen and decide. */
const AUTH_REQUEST_TTL_MS = 15 * 60 * 1000;

/* Short: the code goes straight from the redirect into a token call. */
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;

const SUPPORTED_SCOPES = ['read', 'read_write'];

/*
 * Derived from the request rather than hardcoded, so the same code serves
 * localhost in development and the deployed host in production. An env
 * override exists for deployments behind a proxy that rewrites the host.
 */
export const baseUrlFrom = (req) => {
  const configured = process.env.MCP_PUBLIC_URL;
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
};

/*
 * Where the consent screen lives — a page in the admin panel.
 *
 * FRONTEND_URL is the variable the rest of the app already uses to build
 * links into the web app (password resets, mailbox alerts), so the
 * connector reads the same one rather than adding a second source of
 * truth that can disagree with it. MCP_APP_URL exists only for the case
 * where the admin panel is served somewhere other than the main app.
 *
 * If neither is set the flow completes right up to the consent redirect
 * and then lands on nothing, so this is worth getting right before
 * anyone tries to add the connector.
 */
const appUrlFor = () =>
  (process.env.MCP_APP_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');

export const canonicalResource = (req) => `${baseUrlFrom(req)}/mcp`;

const normalizeResource = (value) =>
  String(value || '')
    .trim()
    .replace(/\/+$/, '')
    .toLowerCase();

/*
 * RFC 8707: the client says which resource the token is for, and we refuse
 * to mint one for anybody else. Both canonical forms the spec gives as
 * examples are accepted — with the /mcp path and without.
 */
const resourceMatches = (req, value) => {
  if (!value) return true; /* absent is tolerated; wrong is not */

  const given = normalizeResource(value);
  return (
    given === normalizeResource(canonicalResource(req)) ||
    given === normalizeResource(baseUrlFrom(req))
  );
};

const noStore = (res) =>
  res.set('Cache-Control', 'no-store').set('Pragma', 'no-cache');

const oauthError = (res, status, error, description) =>
  noStore(res).status(status).json({ error, error_description: description });

/*
 * Errors that cannot be sent back to the client, because we do not trust
 * where "back" is. An unknown client or an unregistered redirect URI is
 * exactly the case where redirecting would be the attack.
 */
const errorPage = (res, status, title, detail) =>
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#0f172a}` +
        `h1{font-size:1.05rem;margin:0 0 .5rem}p{color:#64748b;font-size:.85rem;line-height:1.6;margin:0}</style>` +
        `<h1>${title}</h1><p>${detail}</p>`
    );

const buildRedirect = (redirectUri, params) => {
  const url = new URL(redirectUri);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

/*
|--------------------------------------------------------------------------
| Discovery
|--------------------------------------------------------------------------
|
| Both documents are unauthenticated by design: a client has to be able to
| read them before it has any credential at all. They describe endpoints,
| never data.
*/

export const protectedResourceMetadata = (req, res) =>
  res.json({
    resource: canonicalResource(req),
    authorization_servers: [baseUrlFrom(req)],
    scopes_supported: SUPPORTED_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${baseUrlFrom(req)}/mcp/info`,
  });

export const authorizationServerMetadata = (req, res) => {
  const base = baseUrlFrom(req);

  res.json({
    issuer: base,
    authorization_endpoint: `${base}/mcp/oauth/authorize`,
    token_endpoint: `${base}/mcp/oauth/token`,
    registration_endpoint: `${base}/mcp/oauth/register`,
    revocation_endpoint: `${base}/mcp/oauth/revoke`,

    scopes_supported: SUPPORTED_SCOPES,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],

    /* PKCE is mandatory: "plain" is deliberately not offered. */
    code_challenge_methods_supported: ['S256'],

    token_endpoint_auth_methods_supported: [
      'none',
      'client_secret_post',
      'client_secret_basic',
    ],

    resource_indicators_supported: true,
    service_documentation: `${base}/mcp/info`,
  });
};

/*
|--------------------------------------------------------------------------
| Dynamic client registration (RFC 7591)
|--------------------------------------------------------------------------
*/

export const registerClient = async (req, res) => {
  try {
    const body = req.body || {};

    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

    if (redirectUris.length === 0) {
      return oauthError(
        res,
        400,
        'invalid_redirect_uri',
        'At least one redirect_uri is required.'
      );
    }

    const bad = redirectUris.find((uri) => !isAllowedRedirectUri(uri));

    if (bad) {
      return oauthError(
        res,
        400,
        'invalid_redirect_uri',
        `"${bad}" is not usable: redirect URIs must be HTTPS (or http on localhost) and carry no fragment.`
      );
    }

    const authMethod =
      body.token_endpoint_auth_method === 'client_secret_post' ||
      body.token_endpoint_auth_method === 'client_secret_basic'
        ? body.token_endpoint_auth_method
        : 'none';

    const clientId = generateClientId();
    const secret = authMethod === 'none' ? null : generateClientSecret();

    const client = await McpOAuthClientModel.create({
      clientId,
      clientName: String(body.client_name || 'MCP client').slice(0, 120),
      redirectUris,
      grantTypes:
        Array.isArray(body.grant_types) && body.grant_types.length
          ? body.grant_types
          : ['authorization_code', 'refresh_token'],
      responseTypes: Array.isArray(body.response_types) ? body.response_types : ['code'],
      scope: SUPPORTED_SCOPES.includes(body.scope) ? body.scope : 'read',
      tokenEndpointAuthMethod: authMethod,
      clientSecretHash: secret ? hashClientSecret(secret) : null,
      softwareId: String(body.software_id || ''),
      softwareVersion: String(body.software_version || ''),
    });

    return noStore(res)
      .status(201)
      .json({
        client_id: client.clientId,
        ...(secret ? { client_secret: secret } : {}),
        client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
        ...(secret ? { client_secret_expires_at: 0 } : {}),
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        response_types: client.responseTypes,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        scope: client.scope,
      });
  } catch (error) {
    console.error('[mcp oauth] register failed:', error);
    return oauthError(res, 500, 'server_error', 'Could not register the client.');
  }
};

/*
|--------------------------------------------------------------------------
| Authorization request
|--------------------------------------------------------------------------
|
| Grants nothing. Validates what was asked, records it, and hands the
| browser to the consent screen.
*/

export const authorize = async (req, res) => {
  try {
    const {
      response_type: responseType,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      state,
      scope,
      resource,
    } = req.query;

    const client = clientId
      ? await McpOAuthClientModel.findOne({ clientId: String(clientId) })
      : null;

    /*
     * Everything below this line may be reported to the client by
     * redirect. Everything above it may NOT — an unknown client or an
     * unregistered redirect URI means we have no trusted place to send
     * the user, and redirecting anyway is the open-redirect attack.
     */
    if (!client) {
      return errorPage(
        res,
        400,
        'Unknown client',
        'This application is not registered with Replex Engine. Remove the connector and add it again so it can register itself.'
      );
    }

    if (!redirectUri || !client.redirectUris.includes(String(redirectUri))) {
      return errorPage(
        res,
        400,
        'Redirect address not recognised',
        'The address this application asked us to return to is not one it registered. Nothing has been approved.'
      );
    }

    const fail = (error, description) =>
      res.redirect(buildRedirect(String(redirectUri), { error, error_description: description, state }));

    if (responseType !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported.');
    }

    if (!codeChallenge) {
      return fail('invalid_request', 'PKCE is required: send code_challenge.');
    }

    if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
      return fail('invalid_request', 'Only code_challenge_method=S256 is supported.');
    }

    if (!resourceMatches(req, resource)) {
      return fail(
        'invalid_target',
        `Tokens are only issued for ${canonicalResource(req)}.`
      );
    }

    /*
     * Checked before anything is recorded. With no app URL the redirect
     * below would be a bare path, which resolves against THIS host and
     * lands on a 404 — the flow would appear to work and then die on a
     * blank page. Better to say exactly what is missing.
     */
    if (!appUrlFor()) {
      console.error('[mcp oauth] FRONTEND_URL (or MCP_APP_URL) is not set — cannot show the consent screen.');

      return errorPage(
        res,
        500,
        'Connector not configured',
        'This server does not know where its admin panel is hosted, so it cannot show the approval screen. Set FRONTEND_URL on the backend and try again.'
      );
    }

    const requestedScope = SUPPORTED_SCOPES.includes(String(scope)) ? String(scope) : 'read';

    const request = await McpAuthRequestModel.create({
      requestId: generateRequestId(),
      clientId: client.clientId,
      redirectUri: String(redirectUri),
      state: state ? String(state) : '',
      scope: requestedScope,
      resource: resource ? String(resource) : canonicalResource(req),
      codeChallenge: String(codeChallenge),
      codeChallengeMethod: 'S256',
      expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS),
    });

    /*
     * Off to the app, which knows who is signed in. This server never sees
     * the admin's password and does not render a login form of its own.
     */
    return res.redirect(
      `${appUrlFor()}/admin/mcp-connector/authorize?request=${encodeURIComponent(request.requestId)}`
    );
  } catch (error) {
    console.error('[mcp oauth] authorize failed:', error);
    return errorPage(
      res,
      500,
      'Something went wrong',
      'The authorization request could not be started. Please try again.'
    );
  }
};

/*
 * What the consent screen renders. Reachable without a session because the
 * page is shown before we know whether anyone is signed in; the requestId
 * is unguessable and this returns only what the screen has to display.
 */
export const describeAuthorizationRequest = async (req, res) => {
  try {
    const request = await McpAuthRequestModel.findOne({
      requestId: String(req.params.requestId || ''),
    });

    if (!request || !request.isPending()) {
      return res.status(404).json({
        success: false,
        message: 'This authorization request has expired or was already used. Start again from your MCP client.',
      });
    }

    const client = await McpOAuthClientModel.findOne({ clientId: request.clientId });

    return res.json({
      success: true,
      request: {
        requestId: request.requestId,
        clientName: client?.clientName || 'Unknown application',
        /* Host only: the full callback URL is noise on a consent screen. */
        redirectHost: (() => {
          try {
            return new URL(request.redirectUri).host;
          } catch {
            return request.redirectUri;
          }
        })(),
        scope: request.scope,
        resource: request.resource,
        expiresAt: request.expiresAt,
      },
    });
  } catch (error) {
    console.error('[mcp oauth] describe request failed:', error);
    return res.status(500).json({ success: false, message: 'Could not load the request.' });
  }
};

/*
 * The moment access is actually granted. Behind adminMiddleware — the
 * signed-in master admin, in their own browser, deciding.
 */
export const approveAuthorization = async (req, res) => {
  try {
    const userId = getAuthUserId(req);

    const request = await McpAuthRequestModel.findOne({
      requestId: String(req.body?.request || ''),
    });

    if (!request || !request.isPending()) {
      return res.status(400).json({
        success: false,
        message: 'This authorization request has expired or was already used.',
      });
    }

    /* The admin may narrow what the client asked for, never widen it. */
    const grantedScope = SUPPORTED_SCOPES.includes(req.body?.scope)
      ? req.body.scope
      : request.scope;

    const code = generateAuthCode();

    request.userId = userId;
    request.scope = grantedScope;
    request.codeHash = hashAuthCode(code);
    request.approvedAt = new Date();
    request.expiresAt = new Date(Date.now() + AUTH_CODE_TTL_MS);
    await request.save();

    return res.json({
      success: true,
      redirectTo: buildRedirect(request.redirectUri, {
        code,
        state: request.state,
      }),
    });
  } catch (error) {
    console.error('[mcp oauth] approve failed:', error);
    return res.status(500).json({ success: false, message: 'Could not approve the request.' });
  }
};

export const denyAuthorization = async (req, res) => {
  try {
    const request = await McpAuthRequestModel.findOne({
      requestId: String(req.body?.request || ''),
    });

    if (!request || !request.isPending()) {
      return res.status(400).json({
        success: false,
        message: 'This authorization request has expired or was already used.',
      });
    }

    request.usedAt = new Date();
    await request.save();

    return res.json({
      success: true,
      redirectTo: buildRedirect(request.redirectUri, {
        error: 'access_denied',
        error_description: 'The account owner refused the request.',
        state: request.state,
      }),
    });
  } catch (error) {
    console.error('[mcp oauth] deny failed:', error);
    return res.status(500).json({ success: false, message: 'Could not refuse the request.' });
  }
};

/*
|--------------------------------------------------------------------------
| Token endpoint
|--------------------------------------------------------------------------
*/

/* Credentials may arrive in the body or as HTTP Basic, per OAuth 2.1. */
const clientCredentialsFrom = (req) => {
  const header = String(req.headers.authorization || '');

  if (header.toLowerCase().startsWith('basic ')) {
    try {
      const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');

      if (idx > -1) {
        return {
          clientId: decodeURIComponent(decoded.slice(0, idx)),
          clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
        };
      }
    } catch {
      /* fall through to body */
    }
  }

  return {
    clientId: req.body?.client_id ? String(req.body.client_id) : '',
    clientSecret: req.body?.client_secret ? String(req.body.client_secret) : '',
  };
};

const authenticateClient = async (req) => {
  const { clientId, clientSecret } = clientCredentialsFrom(req);

  if (!clientId) return { error: 'invalid_client', message: 'client_id is required.' };

  const client = await McpOAuthClientModel.findOne({ clientId });

  if (!client) return { error: 'invalid_client', message: 'Unknown client.' };

  if (!client.isPublic()) {
    if (!clientSecret) {
      return { error: 'invalid_client', message: 'This client must authenticate with its secret.' };
    }

    const given = Buffer.from(hashClientSecret(clientSecret));
    const known = Buffer.from(client.clientSecretHash);

    if (given.length !== known.length || !crypto.timingSafeEqual(given, known)) {
      return { error: 'invalid_client', message: 'The client secret is wrong.' };
    }
  }

  return { client };
};

/* One place that mints the pair, so code exchange and refresh cannot drift. */
const issueTokens = async ({ tokenDoc, userId, client, scope, audience, label }) => {
  const accessToken = generateMcpToken();
  const refreshToken = generateMcpToken();

  const fields = {
    userId,
    label,
    scope,
    grantedVia: 'oauth',
    clientId: client.clientId,
    audience,
    tokenHash: hashMcpToken(accessToken),
    tokenHint: accessToken.slice(-6),
    refreshTokenHash: hashMcpToken(refreshToken),
    expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    revokedAt: null,
  };

  if (tokenDoc) {
    /*
     * Rotation in place: the old access and refresh values stop working
     * the moment this saves, and the panel still shows one row for this
     * connection rather than a new one per refresh.
     */
    Object.assign(tokenDoc, fields);
    await tokenDoc.save();
  } else {
    await McpTokenModel.create(fields);
  }

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope,
  };
};

export const token = async (req, res) => {
  try {
    const grantType = String(req.body?.grant_type || '');

    const auth = await authenticateClient(req);

    if (auth.error) return oauthError(res, 401, auth.error, auth.message);

    const { client } = auth;

    /* ---------------- authorization_code ---------------- */
    if (grantType === 'authorization_code') {
      const code = String(req.body?.code || '');
      const verifier = String(req.body?.code_verifier || '');
      const redirectUri = String(req.body?.redirect_uri || '');

      if (!code) return oauthError(res, 400, 'invalid_request', 'code is required.');
      if (!verifier) return oauthError(res, 400, 'invalid_request', 'code_verifier is required.');

      const request = await McpAuthRequestModel.findOne({ codeHash: hashAuthCode(code) });

      if (!request || !request.isRedeemable()) {
        return oauthError(res, 400, 'invalid_grant', 'This authorization code is expired, already used, or unknown.');
      }

      if (request.clientId !== client.clientId) {
        return oauthError(res, 400, 'invalid_grant', 'This code was issued to a different client.');
      }

      /*
       * Exact match, as registered. OAuth 2.1 requires it: a code issued
       * for one callback must not be redeemable against another.
       */
      if (redirectUri && redirectUri !== request.redirectUri) {
        return oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the authorization request.');
      }

      if (!verifyPkce(verifier, request.codeChallenge)) {
        return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed.');
      }

      if (!resourceMatches(req, req.body?.resource)) {
        return oauthError(res, 400, 'invalid_target', `Tokens are only issued for ${canonicalResource(req)}.`);
      }

      /* Single use — burned before the tokens are handed out. */
      request.usedAt = new Date();
      await request.save();

      McpOAuthClientModel.updateOne(
        { _id: client._id },
        { $set: { lastUsedAt: new Date() } }
      ).catch(() => {});

      const issued = await issueTokens({
        tokenDoc: null,
        userId: request.userId,
        client,
        scope: request.scope,
        audience: request.resource || canonicalResource(req),
        label: `${client.clientName} (connector)`,
      });

      return noStore(res).json(issued);
    }

    /* ---------------- refresh_token ---------------- */
    if (grantType === 'refresh_token') {
      const refreshToken = String(req.body?.refresh_token || '');

      if (!refreshToken) {
        return oauthError(res, 400, 'invalid_request', 'refresh_token is required.');
      }

      const tokenDoc = await McpTokenModel.findOne({
        refreshTokenHash: hashMcpToken(refreshToken),
      });

      if (
        !tokenDoc ||
        tokenDoc.revokedAt ||
        !tokenDoc.refreshExpiresAt ||
        tokenDoc.refreshExpiresAt.getTime() <= Date.now()
      ) {
        return oauthError(res, 400, 'invalid_grant', 'This refresh token is expired, revoked, or unknown.');
      }

      if (tokenDoc.clientId !== client.clientId) {
        return oauthError(res, 400, 'invalid_grant', 'This refresh token belongs to a different client.');
      }

      const issued = await issueTokens({
        tokenDoc,
        userId: tokenDoc.userId,
        client,
        scope: tokenDoc.scope,
        audience: tokenDoc.audience,
        label: tokenDoc.label,
      });

      return noStore(res).json(issued);
    }

    return oauthError(
      res,
      400,
      'unsupported_grant_type',
      'Supported grants: authorization_code, refresh_token.'
    );
  } catch (error) {
    console.error('[mcp oauth] token failed:', error);
    return oauthError(res, 500, 'server_error', 'Could not issue a token.');
  }
};

/*
 * RFC 7009 token revocation — a client signing out should be able to throw
 * its own credential away. Always answers 200, as the RFC requires: an
 * unknown token is not an error, and saying so would be an oracle.
 */
export const revoke = async (req, res) => {
  try {
    const value = String(req.body?.token || '');

    if (value) {
      const hash = hashMcpToken(value);

      await McpTokenModel.updateOne(
        { $or: [{ tokenHash: hash }, { refreshTokenHash: hash }], revokedAt: null },
        { $set: { revokedAt: new Date() } }
      );
    }

    return noStore(res).status(200).json({});
  } catch (error) {
    console.error('[mcp oauth] revoke failed:', error);
    return noStore(res).status(200).json({});
  }
};
