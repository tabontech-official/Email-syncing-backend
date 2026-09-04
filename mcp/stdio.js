#!/usr/bin/env node
import 'dotenv/config';
import mongoose from 'mongoose';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './server.js';
import { resolveMcpToken } from './auth.js';

/*
|--------------------------------------------------------------------------
| MCP over stdio — for clients that launch a local process
|--------------------------------------------------------------------------
|
| Claude Desktop and some editors do not speak HTTP to an MCP server; they
| spawn a command and talk JSON-RPC over its stdin/stdout. This is that
| command.
|
| It serves the SAME tools as the HTTP transport and authenticates with
| the SAME token, so a token works in either place and revoking it kills
| both.
|
| Configure it with two environment variables:
|
|   DB_URL             the Mongo connection string
|   REPLEX_MCP_TOKEN   a token from POST /mcp/tokens
|
| STDOUT IS THE PROTOCOL
|
| Every diagnostic goes to stderr. A stray console.log here is not a
| harmless log line — it is injected into the JSON-RPC stream and breaks
| the session with a parse error that looks like a client bug.
*/

const log = (...args) => console.error('[replex-mcp]', ...args);

const main = async () => {
  const token = process.env.REPLEX_MCP_TOKEN;

  if (!token) {
    log('REPLEX_MCP_TOKEN is not set. Create one with POST /mcp/tokens.');
    process.exit(1);
  }

  if (!process.env.DB_URL) {
    log('DB_URL is not set.');
    process.exit(1);
  }

  await mongoose.connect(process.env.DB_URL);
  log('Connected to the database.');

  let session;
  try {
    session = await resolveMcpToken(token);
  } catch (error) {
    log(`Authentication failed: ${error.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  log(`Authenticated as ${session.user.email} (scope: ${session.scope}).`);

  const server = buildMcpServer({
    user: session.user,
    scope: session.scope,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log('Ready.');

  /*
   * The client closing the pipe is a normal shutdown, not a crash — leave
   * the database connection closed cleanly so the process exits promptly.
   */
  const shutdown = async () => {
    try {
      await server.close();
    } catch {
      /* already closing */
    }
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('close', shutdown);
};

main().catch(async (error) => {
  log('Fatal:', error?.message || error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
