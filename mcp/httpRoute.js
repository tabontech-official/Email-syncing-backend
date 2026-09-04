import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildMcpServer } from './server.js';
import { bearerFrom, resolveMcpToken, McpAuthError } from './auth.js';
import { baseUrlFrom } from './oauth.js';

/*
|--------------------------------------------------------------------------
| MCP over Streamable HTTP
|--------------------------------------------------------------------------
|
| The remote transport — what ChatGPT connectors, Claude custom connectors
| and `claude mcp add --transport http` talk to.
|
| STATELESS ON PURPOSE
|
| A fresh server and transport are created per request and disposed when
| it ends, with no session id retained. The backend runs on Vercel, where
| consecutive requests may land on different instances: an in-memory
| session map would work locally and fail intermittently in production,
| which is the worst way for it to fail. Stateless costs one object per
| call and is correct everywhere.
|
| It also makes the account binding airtight — the server instance handling
| a request was built from the token on that same request, so there is no
| window in which a cached session could serve the wrong account.
*/

/* JSON-RPC error, shaped so a client shows the message rather than "fetch failed". */
const rpcError = (res, status, message, id = null) => {
  if (res.headersSent) return;

  res.status(status).json({
    jsonrpc: '2.0',
    error: { code: status === 401 || status === 403 ? -32001 : -32603, message },
    id,
  });
};

export const handleMcpRequest = async (req, res) => {
  let transport;
  let server;

  try {
    const { user, scope } = await resolveMcpToken(
      bearerFrom(req.headers.authorization)
    );

    server = buildMcpServer({ user, scope });

    transport = new StreamableHTTPServerTransport({
      /* undefined = stateless: no session is created or expected. */
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    /*
     * Disposal is tied to the response, not to the end of this function:
     * the transport outlives the handler while streaming.
     */
    res.on('close', () => {
      transport?.close?.().catch(() => {});
      server?.close?.().catch(() => {});
    });

    await server.connect(transport);

    /*
     * req.body is already parsed by express.json() upstream. Passing it
     * explicitly is required — the transport cannot re-read a consumed
     * stream, and without this every call hangs.
     */
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (error instanceof McpAuthError) {
      /*
       * RFC 9728 §5.1. This header is the entire entry point to the OAuth
       * flow: a client with no credential calls /mcp, gets 401, and reads
       * resource_metadata to find out where to go next. Without it Claude
       * has no way to discover the authorization server and the connector
       * simply reports that it cannot connect.
       */
      res.setHeader(
        'WWW-Authenticate',
        `Bearer realm="replex-engine-mcp", ` +
          `resource_metadata="${baseUrlFrom(req)}/.well-known/oauth-protected-resource"`
      );
      return rpcError(res, error.status, error.message, req.body?.id ?? null);
    }

    console.error('[mcp] Request failed:', error);
    return rpcError(
      res,
      500,
      'The MCP server could not handle that request.',
      req.body?.id ?? null
    );
  }
};

/*
 * A plain, unauthenticated liveness probe.
 *
 * Deliberately says nothing about the account or whether a token is
 * valid — it exists so someone setting a connector up can confirm the URL
 * is right before worrying about credentials.
 */
export const handleMcpInfo = (req, res) => {
  const base = baseUrlFrom(req);

  res.json({
    name: 'replex-engine',
    protocol: 'mcp',
    transport: 'streamable-http',
    endpoint: `${base}/mcp`,
    authentication: {
      /* Add-a-connector clients: discovery starts here. */
      oauth2: `${base}/.well-known/oauth-protected-resource`,
      /* Clients that can set a header: a token issued in the admin panel. */
      bearer: 'Authorization: Bearer <MCP access token>',
    },
    note: 'Access is currently limited to the master admin account, and is checked on every call.',
  });
};
