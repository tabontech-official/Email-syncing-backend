import express from 'express';
import { handleMcpRequest, handleMcpInfo } from '../mcp/httpRoute.js';
import {
  createMcpToken,
  listMcpTokens,
  revokeMcpToken,
} from '../controller/mcpToken.js';
import {
  registerClient,
  authorize,
  describeAuthorizationRequest,
  approveAuthorization,
  denyAuthorization,
  token as oauthToken,
  revoke as oauthRevoke,
} from '../mcp/oauth.js';
import { adminMiddleware } from '../middleware/authmiddleware.js';

const mcpRouter = express.Router();

/*
|--------------------------------------------------------------------------
| /mcp — the Model Context Protocol connector
|--------------------------------------------------------------------------
|
| Two different audiences on one prefix:
|
|   /mcp            an MCP client (Claude, ChatGPT, …) speaking JSON-RPC,
|                   authenticated by an MCP access token.
|   /mcp/tokens     the web app managing those tokens, authenticated by
|                   the normal admin session.
|
| The token routes are declared BEFORE the protocol route so that
| "/mcp/tokens" is never swallowed by it.
*/

/* Token management — master admin session. */
mcpRouter.post('/tokens', adminMiddleware, createMcpToken);
mcpRouter.get('/tokens', adminMiddleware, listMcpTokens);
mcpRouter.delete('/tokens/:id', adminMiddleware, revokeMcpToken);

/*
|--------------------------------------------------------------------------
| OAuth — what Claude's "custom connector" flow walks through
|--------------------------------------------------------------------------
|
| Three different audiences again, and the distinction is the security
| model rather than a filing convention:
|
|   register / authorize / token / revoke   the MCP client. Unauthenticated
|                                           by necessity — it has no
|                                           credential yet. None of them
|                                           grant anything on their own.
|
|   request/:requestId                      the consent screen, before we
|                                           know who is looking. Returns
|                                           only what that screen shows.
|
|   approve / deny                          the signed-in master admin.
|                                           This is the one that grants.
*/
mcpRouter.post('/oauth/register', registerClient);
mcpRouter.get('/oauth/authorize', authorize);
mcpRouter.post('/oauth/token', oauthToken);
mcpRouter.post('/oauth/revoke', oauthRevoke);

mcpRouter.get('/oauth/request/:requestId', describeAuthorizationRequest);

mcpRouter.post('/oauth/approve', adminMiddleware, approveAuthorization);
mcpRouter.post('/oauth/deny', adminMiddleware, denyAuthorization);

/* Unauthenticated: confirms the URL is right, reveals nothing. */
mcpRouter.get('/info', handleMcpInfo);

/*
 * The protocol endpoint. Authentication happens inside the handler rather
 * than in middleware, because a rejection has to be returned as JSON-RPC
 * for the client to render it — an HTML error page reaches the user as
 * "connection failed" with no reason.
 */
mcpRouter.post('/', handleMcpRequest);

/*
 * Streamable HTTP also defines GET (server-initiated stream) and DELETE
 * (end session). This server is stateless and pushes nothing, so both are
 * answered honestly rather than left to 404 as "wrong URL".
 */
mcpRouter.get('/', (req, res) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message:
        'This MCP server is stateless and does not support server-initiated streams. Use POST.',
    },
    id: null,
  })
);

mcpRouter.delete('/', (req, res) => res.status(204).end());

export default mcpRouter;
