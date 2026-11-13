// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { loadOrCreateToken, startHttpServer, type RunningHttpServer } from '../src/http.js';
import { createServer } from '../src/server.js';
import { Workspace } from '../src/workspace.js';

let root: string;
let http: RunningHttpServer;
const token = 'a'.repeat(64);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'cc-mcp-http-'));
  const workspace = new Workspace({ roots: [root] });
  http = await startHttpServer({
    port: 0,
    token,
    createMcpServer: () => createServer({ workspace, runtime: () => 'x' }),
  });
});

afterAll(async () => {
  await http.close();
  rmSync(root, { recursive: true, force: true });
});

function raw(headers: Record<string, string>, path = '/mcp'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: http.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 't', version: '1' },
        },
      }),
    );
  });
}

describe('HTTP transport', () => {
  test('binds to 127.0.0.1 only', () => {
    expect(http.url).toBe(`http://127.0.0.1:${http.port}/mcp`);
    const address = http.server.address();
    expect(typeof address === 'object' && address?.address).toBe('127.0.0.1');
  });

  test('requires the bearer token', async () => {
    expect(await raw({})).toBe(401);
    expect(await raw({ authorization: `Bearer ${'b'.repeat(64)}` })).toBe(401);
    expect(await raw({ authorization: `Bearer ${token}` })).toBe(200);
  });

  test('rejects foreign Host and Origin headers (DNS rebinding)', async () => {
    const auth = { authorization: `Bearer ${token}` };
    expect(await raw({ ...auth, host: `evil.example:${http.port}` })).toBe(403);
    expect(await raw({ ...auth, origin: 'https://evil.example' })).toBe(403);
    expect(await raw({ ...auth, origin: `http://localhost:5173` })).toBe(200);
    expect(await raw(auth, '/other')).toBe(404);
  });

  test('a real MCP client can use the tools', async () => {
    const client = new Client({ name: 'http-test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(http.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    const result = (await client.callTool({
      name: 'create_project',
      arguments: { path: 'via-http' },
    })) as { content: { text: string }[] };
    expect(JSON.parse(result.content[0]!.text).project).toBe('via-http');
    await client.close();
  });
});

test('the token file is created with mode 0600 and reused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-token-'));
  const file = join(dir, 'sub', 'token');
  const first = loadOrCreateToken(file);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(loadOrCreateToken(file)).toBe(first);
  rmSync(dir, { recursive: true, force: true });
});
