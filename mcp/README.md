# Replex Engine MCP connector

Exposes this account's scenarios, leads, mailbox connections, templates and
run history to any MCP client — Claude, ChatGPT, Cursor, or anything else
that speaks the Model Context Protocol.

**Currently private: only accounts with `role: "admin"` may use it.** The
check runs on every call, not just when a token is issued, so removing
admin from an account disables its existing tokens immediately. To open it
up later, relax `MCP_REQUIRES_ADMIN` in `mcp/auth.js` — nothing else in
this directory assumes an admin.

---

## 1. Issue a token

Signed in as the master account:

```bash
curl -X POST https://<your-backend>/mcp/tokens \
  -H "Authorization: Bearer <your admin session JWT>" \
  -H "Content-Type: application/json" \
  -d '{"label":"Claude Desktop","scope":"read"}'
```

```jsonc
{
  "success": true,
  "token": "rxe_mcp_…",       // shown ONCE — it is stored hashed
  "tokenRecord": { "id": "…", "label": "Claude Desktop", "scope": "read" }
}
```

| Field           | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `label`         | Which client holds it, so you can tell entries apart later.           |
| `scope`         | `read` (default) or `read_write`. See below.                         |
| `expiresInDays` | Optional. Omit for a token that does not expire.                     |

`GET /mcp/tokens` lists them (never the secret). `DELETE /mcp/tokens/:id`
revokes one immediately.

### Scope

`read` tokens cannot change anything — write tools are not even advertised
to the client, so the model never plans around a capability it cannot use.
Only `set_scenario_active` is a write tool today.

Prefer `read` unless you specifically want the model able to switch
scenarios on and off.

---

## 2. Connect a client

### Claude Code

```bash
claude mcp add --transport http replex https://<your-backend>/mcp \
  --header "Authorization: Bearer rxe_mcp_…"
```

### Claude Desktop / ChatGPT — remote connector

Add a custom connector pointing at `https://<your-backend>/mcp` with the
header `Authorization: Bearer rxe_mcp_…`.

`GET /mcp/info` is unauthenticated and returns the server descriptor — use
it to confirm the URL is right before debugging credentials.

### Clients that only launch a local process (stdio)

```jsonc
{
  "mcpServers": {
    "replex-engine": {
      "command": "node",
      "args": ["D:/SoftwareDevelopment/replexengine/Email-syncing-backend/mcp/stdio.js"],
      "env": {
        "DB_URL": "<mongodb connection string>",
        "REPLEX_MCP_TOKEN": "rxe_mcp_…"
      }
    }
  }
}
```

Same tools, same token, same permissions — revoking the token kills both
transports. Locally, `npm run mcp` starts it with the values from `.env`.

---

## Connecting Claude (OAuth — no token needed)

Claude's connector dialog takes a URL and nothing else; there is no field
for a bearer token. So the server also acts as an OAuth 2.1 authorization
server, which is what makes "add custom connector" work.

**In the app:** Admin -> MCP Connector -> **Connect to Claude**. That copies
the connector URL and opens Claude's add-connector dialog. Paste, press Add,
and Claude bounces you to an approval page in the admin panel. Approve, and
the connector is live.

Nothing is issued by hand: Claude registers itself, and the approval screen
is the only place access is granted.

### Required configuration

`FRONTEND_URL` **must** be set on the backend. The OAuth flow redirects the
browser to `<FRONTEND_URL>/admin/mcp-connector/authorize`; without it,
`/mcp/oauth/authorize` returns a configuration error rather than sending the
user to a dead path. `MCP_PUBLIC_URL` is only needed behind a proxy that
rewrites the Host header.

### The connector must be served from the public domain

Claude derives the connector's identity, and the OAuth issuer it trusts,
from the origin you hand it. So the address must be
`https://replexengine.com/mcp` — not the backend's `*.vercel.app` host.

`replexengine.com` is the frontend deployment, so `vercel.json` in the
frontend project rewrites the connector paths onto the backend:

    /mcp/*                                  -> backend
    /.well-known/oauth-protected-resource*  -> backend
    /.well-known/oauth-authorization-server* -> backend

and the backend must set:

    MCP_PUBLIC_URL=https://replexengine.com
    FRONTEND_URL=https://replexengine.com

`MCP_PUBLIC_URL` matters because a Vercel rewrite reaches the backend with
the backend's own Host header. Without it the metadata documents would
advertise the `.vercel.app` origin to a client that connected to
`replexengine.com`, and RFC 8707 audience validation is entitled to reject
that mismatch.

### Cold starts used to kill the request

`initializeApplication()` in `app.js` called `process.exit(1)` on any
startup failure. That is correct on a long-running server and fatal on
Vercel, where the module initialises inside the invocation already serving
a request — a single Gmail IMAP listener failing to open would take the
HTTP response down with it as `FUNCTION_INVOCATION_FAILED`.

Adding a connector was the request most likely to hit it, being the first
POST to reach a cold instance. It now logs and continues when running
serverless, and still exits on a real server.

### What the flow does

| Step | Endpoint |
| --- | --- |
| Client calls `/mcp` with no token | `401` + `WWW-Authenticate: ... resource_metadata=...` |
| Discovers the auth server | `/.well-known/oauth-protected-resource` (RFC 9728) |
| Reads its endpoints | `/.well-known/oauth-authorization-server` (RFC 8414) |
| Registers itself | `POST /mcp/oauth/register` (RFC 7591) |
| Sends the user to approve | `GET /mcp/oauth/authorize` -> consent screen |
| Admin approves | `POST /mcp/oauth/approve` -> authorization code |
| Exchanges for a token | `POST /mcp/oauth/token` (PKCE S256, RFC 8707 audience) |
| Later | `refresh_token` grant, rotated in place |

Access tokens last 30 days, refresh tokens 180 with rotation on every use.
An OAuth-granted connection appears in the same token table as a manually
issued one, so revoking it is the same single action.

### Why registration being open is not a hole

Anyone can register a client — the protocol requires it, and a registration
is only a name plus a callback URL. It grants nothing. Access exists solely
after the master admin approves on the consent screen, and the callback URL
is stored exactly as registered, matched byte-for-byte, and required to be
HTTPS or loopback, so a registration cannot be used to redirect a code
somewhere else.

---

## 3. Tools

| Tool                        | Scope | What it does                                                     |
| --------------------------- | ----- | ---------------------------------------------------------------- |
| `get_account_overview`      | read  | Plan, scenario counts, mailbox health. Start here.                |
| `list_scenarios`            | read  | Scenarios + whether a paused one **can** be activated, and why not. |
| `get_scenario`              | read  | One scenario in full, with blockers.                              |
| `set_scenario_active`       | write | Switch a scenario on or off. Refuses with reasons.                |
| `list_connections`          | read  | Mailboxes and whether each still works.                           |
| `list_leads`                | read  | Recent leads, searchable by subject/sender/service.               |
| `get_lead`                  | read  | One lead including its body.                                      |
| `list_templates`            | read  | Reply templates.                                                  |
| `list_scenario_runs`        | read  | Execution history — why a lead did or did not get a reply.        |
| `get_platform_trigger_rules`| read  | Subject filters and service routing.                              |
| `search` / `fetch`          | read  | ChatGPT connector compatibility, over the same data.              |

---

## Design notes

**Activation is not decided here.** `set_scenario_active` calls
`utils/scenarioActivation.js`, the same module `controller/Scenario.js`
uses when the web app saves a scenario. A second copy of "is this mailbox
usable" is exactly how the UI once came to show a scenario as running
while the server had stored it as off.

**Account scoping is structural.** Tool handlers close over the account
resolved from the verified token and query by its id. No tool reads a
`userId` from its own arguments, so a model cannot be steered into another
account's data by an instruction hidden in a lead it was asked to
summarise.

**HTTP is stateless.** A server and transport are built per request and
disposed with the response. The backend runs on Vercel, where consecutive
requests may hit different instances — an in-memory session map would work
in development and fail intermittently in production.

**Tokens are stored as SHA-256 hashes.** The plaintext exists only in the
response that created it. SHA-256 rather than bcrypt is deliberate: these
are 256 random bits, not passwords, and the lookup runs on every call.

**Bodies are truncated** before reaching the model — 300 characters in a
lead list, 8000 in a single fetch. A 40KB HTML email spends context
without adding information.
