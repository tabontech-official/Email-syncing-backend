import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS } from './tools.js';

/*
|--------------------------------------------------------------------------
| Building an MCP server for one account
|--------------------------------------------------------------------------
|
| A server instance is bound to the account it serves. Tool handlers close
| over that account and query by its id, so the identity comes from the
| verified token and never from tool arguments — a model cannot be talked
| into reading another account's data by an instruction hidden in a lead
| it was asked to summarise.
|
| Instances are cheap and created per request on HTTP (see httpRoute.js),
| which keeps the account binding impossible to get wrong.
*/

export const SERVER_INFO = {
  name: 'replex-engine',
  version: '1.0.0',
};

const SERVER_INSTRUCTIONS = `Replex Engine automates replies to Shopify Partner Directory lead inquiries.

Key ideas:
- A SCENARIO is a workflow: a trigger mailbox, a router, and email steps.
- A scenario only runs when every mailbox it uses is healthy. A CONNECTION
  with status "reauth_required" has had its sign-in revoked and must be
  reconnected by hand in the web app — no tool here can fix it.
- When a scenario will not activate, list_scenarios and get_scenario report
  the reason in "blockedBy". Read that before speculating.

Start with get_account_overview to see the shape of the account.`;

/*
 * Wrap a handler's return value in the content shape MCP expects.
 *
 * Both forms are supplied: `content` as JSON text for clients that only
 * read text, and `structuredContent` for those that can consume objects.
 * An `error` key from a handler is surfaced as isError so the client can
 * tell "no such record" from a successful empty result.
 */
const toolResult = (value) => {
  const isError = Boolean(value && typeof value === 'object' && value.error);

  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent:
      value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : { value },
    isError,
  };
};

/*
 * Build a server for one account.
 *
 * `scope` decides whether write tools are registered at all. Hiding them
 * from a read-only token is better than refusing them at call time: the
 * model never sees a capability it cannot use, so it does not plan around
 * one and then fail.
 */
export const buildMcpServer = ({ user, scope = 'read' }) => {
  const server = new McpServer(SERVER_INFO, {
    instructions: SERVER_INSTRUCTIONS,
  });

  const allowWrites = scope === 'read_write';

  TOOLS.forEach((tool) => {
    if (tool.write && !allowWrites) return;

    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: !tool.write,
        },
      },
      async (args) => {
        try {
          const value = await tool.handler({ user, args: args || {} });
          return toolResult(value);
        } catch (error) {
          /*
           * A thrown handler must not take the transport down with it —
           * the client should see a failed tool call and be able to try
           * something else. Internals stay in the server log.
           */
          console.error(`[mcp] Tool "${tool.name}" failed:`, error);

          return toolResult({
            error: `The "${tool.name}" tool failed: ${error.message}`,
          });
        }
      }
    );
  });

  return server;
};
