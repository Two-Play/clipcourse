// SPDX-License-Identifier: AGPL-3.0-only
/**
 * clipcourse-mcp: MCP server for Clipcourse.
 *
 *   clipcourse-mcp --root ~/Courses [--root …]            stdio (default)
 *   clipcourse-mcp --root ~/Courses --http [--port 4319]   Streamable HTTP on 127.0.0.1
 *
 * Only files inside the --root folders are read or written.
 */
import { parseArgs } from 'node:util';
import runtime from '@clipcourse/scorm-runtime/dist/clipcourse-runtime.iife.js?raw';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DEFAULT_BRIDGE_PORT } from '@clipcourse/editor-core';
import { DEFAULT_EDITOR_ORIGINS, startBridge } from './bridge.js';
import { downloadMedia } from './download.js';
import { DEFAULT_HTTP_PORT, defaultTokenFile, loadOrCreateToken, startHttpServer } from './http.js';
import { createServer, type ServerOptions } from './server.js';
import { Workspace } from './workspace.js';

const HELP = `Usage: clipcourse-mcp --root <folder> [options]

Options:
  --root <folder>      Folder with course projects (repeatable). Required.
  --http               Serve MCP over HTTP on 127.0.0.1 instead of stdio.
  --port <number>      HTTP port (default ${DEFAULT_HTTP_PORT}).
  --token-file <path>  File with the HTTP bearer token (default ${defaultTokenFile()}).
                       Created with a random token if missing.
  --no-downloads       Do not allow import_media to download from URLs.
  --bridge             Allow live editing of the course open in the editor
                       (WebSocket on 127.0.0.1, pairing with a code).
  --bridge-port <n>    Bridge port (default ${DEFAULT_BRIDGE_PORT}).
  --editor-origin <o>  Additional allowed editor origin (repeatable).
  --help               Show this help.
`;

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', multiple: true },
      http: { type: 'boolean' },
      port: { type: 'string' },
      'token-file': { type: 'string' },
      'no-downloads': { type: 'boolean' },
      bridge: { type: 'boolean' },
      'bridge-port': { type: 'string' },
      'editor-origin': { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  const workspace = new Workspace({ roots: values.root ?? [] });
  const bridge = values.bridge
    ? await startBridge({
        workspace,
        port: values['bridge-port'] ? Number(values['bridge-port']) : DEFAULT_BRIDGE_PORT,
        allowedOrigins: [...DEFAULT_EDITOR_ORIGINS, ...(values['editor-origin'] ?? [])],
      })
    : undefined;
  if (bridge) console.error(`Live bridge on ${bridge.url}`);
  const serverOptions: ServerOptions = {
    workspace,
    runtime: () => runtime,
    ...(values['no-downloads'] ? {} : { download: (url: string) => downloadMedia(url) }),
    ...(bridge ? { bridge } : {}),
  };

  if (values.http) {
    const port = values.port ? Number(values.port) : DEFAULT_HTTP_PORT;
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error(`Invalid port: ${values.port}`);
    const tokenFile = values['token-file'] ?? defaultTokenFile();
    const token = loadOrCreateToken(tokenFile);
    const http = await startHttpServer({
      port,
      token,
      createMcpServer: () => createServer(serverOptions),
    });
    console.error(`clipcourse-mcp listening on ${http.url}`);
    console.error(`Bearer token: see ${tokenFile}`);
    console.error(`Roots: ${workspace.roots.join(', ')}`);
    const stop = () => void http.close().then(() => process.exit(0));
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  await createServer(serverOptions).connect(new StdioServerTransport());
  // Logs go to stderr; stdout belongs to the protocol.
  console.error(`clipcourse-mcp ready (roots: ${workspace.roots.join(', ')})`);
}

main().catch((error: unknown) => {
  console.error(`clipcourse-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
