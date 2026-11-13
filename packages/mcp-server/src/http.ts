// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Streamable HTTP transport, for local clients only.
 *
 * - binds to 127.0.0.1 (never to all interfaces)
 * - every request needs `Authorization: Bearer <token>`; the token is
 *   random per installation and stored in a file only the user can read
 * - Host and Origin headers must be localhost, which blocks DNS rebinding
 *   attacks from web pages
 * - only the /mcp path exists
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export const DEFAULT_HTTP_PORT = 4319;
const HOST = '127.0.0.1';

export function defaultTokenFile(): string {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(base, 'clipcourse', 'mcp-token');
}

/** Reads the token from `file`, creating a new random one (mode 0600) if needed. */
export function loadOrCreateToken(file: string): string {
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (token.length >= 32) return token;
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function deny(res: ServerResponse, status: number, message: string) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }));
}

export interface HttpServerOptions {
  port?: number;
  token: string;
  /** Creates a fresh MCP server for each session (they share the workspace). */
  createMcpServer: () => McpServer;
}

export interface RunningHttpServer {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startHttpServer(options: HttpServerOptions): Promise<RunningHttpServer> {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  let port = options.port ?? DEFAULT_HTTP_PORT;

  const allowedHost = (host: string | undefined) =>
    !!host &&
    [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`].includes(host.toLowerCase());
  const allowedOrigin = (origin: string | undefined) => {
    if (!origin) return true; // non-browser clients send no Origin
    try {
      const url = new URL(origin);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    if (!allowedHost(req.headers.host)) return deny(res, 403, 'Forbidden host');
    if (!allowedOrigin(req.headers.origin)) return deny(res, 403, 'Forbidden origin');
    if (url.pathname !== '/mcp') return deny(res, 404, 'Not found');
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token || !sameSecret(token, options.token)) {
      res.setHeader('www-authenticate', 'Bearer');
      return deny(res, 401, 'Missing or invalid token');
    }

    const sessionId = req.headers['mcp-session-id'];
    let transport = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
    if (!transport) {
      if (sessionId) return deny(res, 404, 'Unknown session');
      if (req.method !== 'POST') return deny(res, 400, 'Session required');
      const created = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, created);
        },
        onsessionclosed: (id) => {
          sessions.delete(id);
        },
        enableDnsRebindingProtection: true,
        allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`],
      });
      created.onclose = () => {
        if (created.sessionId) sessions.delete(created.sessionId);
      };
      await options.createMcpServer().connect(created);
      transport = created;
    }
    await transport.handleRequest(req, res);
  };

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (!res.headersSent)
        deny(res, 500, error instanceof Error ? error.message : 'Internal error');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });
  const address = server.address();
  if (address && typeof address === 'object') port = address.port;

  return {
    server,
    port,
    url: `http://${HOST}:${port}/mcp`,
    async close() {
      for (const transport of sessions.values()) await transport.close().catch(() => {});
      sessions.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
