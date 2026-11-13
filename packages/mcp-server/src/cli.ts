// SPDX-License-Identifier: AGPL-3.0-only
/**
 * clipcourse-mcp: MCP server for Clipcourse.
 *
 *   clipcourse-mcp --root ~/Courses [--root …]
 *
 * Speaks MCP over stdio (for Claude Desktop, Claude Code and other local
 * clients). Only files inside the --root folders are read or written.
 */
import { parseArgs } from 'node:util';
import runtime from '@clipcourse/scorm-runtime/dist/clipcourse-runtime.iife.js?raw';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { Workspace } from './workspace.js';

const HELP = `Usage: clipcourse-mcp --root <folder> [--root <folder> …]

Options:
  --root <folder>   Folder with course projects (repeatable). Required.
  --help            Show this help.
`;

async function main() {
  const { values } = parseArgs({
    options: {
      root: { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  const workspace = new Workspace({ roots: values.root ?? [] });
  const server = createServer({ workspace, runtime: () => runtime });
  await server.connect(new StdioServerTransport());
  // Logs go to stderr; stdout belongs to the protocol.
  console.error(`clipcourse-mcp ready (roots: ${workspace.roots.join(', ')})`);
}

main().catch((error: unknown) => {
  console.error(`clipcourse-mcp: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
