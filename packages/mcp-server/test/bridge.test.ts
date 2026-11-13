// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BRIDGE_PROTOCOL,
  createEditorStore,
  createEmptyCourse,
  executeOperation,
  fromWire,
  type EditorToServer,
  type ServerToEditor,
} from '@clipcourse/editor-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { WebSocket } from 'ws';
import { startBridge, type Bridge } from '../src/bridge.js';
import { createServer } from '../src/server.js';
import { Workspace } from '../src/workspace.js';

const ORIGIN = 'http://localhost:4318';
let root: string;
let workspace: Workspace;
let bridge: Bridge;
let client: Client;
let now = 1_000_000;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cc-bridge-'));
  workspace = new Workspace({ roots: [root] });
  bridge = await startBridge({ workspace, port: 0, now: () => now });
  const server = createServer({ workspace, runtime: () => 'x', bridge });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  client = new Client({ name: 't', version: '1' });
  await client.connect(a);
});

afterEach(async () => {
  await client.close();
  await bridge.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  if (result.isError) throw new Error(result.content[0]!.text);
  return JSON.parse(result.content[0]!.text);
}

/** A minimal editor: real store and operations, speaking the bridge protocol. */
function fakeEditor(code: string, origin = ORIGIN) {
  const store = createEditorStore(createEmptyCourse());
  const files = new Map<string, Uint8Array>();
  const socket = new WebSocket(bridge.url, { origin });
  const messages: ServerToEditor[] = [];
  const send = (m: EditorToServer) => socket.send(JSON.stringify(m));
  socket.on('open', () =>
    send({ type: 'hello', protocol: BRIDGE_PROTOCOL, code, course: store.getState().course }),
  );
  socket.on('message', (raw) => {
    const message = JSON.parse(String(raw)) as ServerToEditor;
    messages.push(message);
    if (message.type === 'operation') {
      try {
        const result = executeOperation({ store, files }, fromWire(message.operation));
        send({ type: 'result', requestId: message.requestId, ok: true, result });
        send({ type: 'course', course: store.getState().course });
      } catch (error) {
        send({
          type: 'result',
          requestId: message.requestId,
          ok: false,
          error: (error as Error).message,
        });
      }
    }
    if (message.type === 'get-files')
      send({ type: 'files', requestId: message.requestId, files: [] });
  });
  const closed = new Promise<number>((resolve) => socket.on('close', (c) => resolve(c)));
  const first = () =>
    new Promise<ServerToEditor>((resolve) => {
      const check = () => (messages[0] ? resolve(messages[0]) : setTimeout(check, 5));
      check();
    });
  return { store, socket, first, closed };
}

test('pairing with the code connects the editor as a project', async () => {
  const { code } = await call('pair_editor');
  expect(code).toMatch(/^\d{6}$/);
  const editor = fakeEditor(code);
  expect(await editor.first()).toEqual({ type: 'paired', id: 'editor:1' });

  const listed = await call('list_projects');
  expect(listed.editors).toEqual([{ project: 'editor:1', title: 'Untitled course' }]);

  const added = await call('add_clip', {
    project: 'editor:1',
    type: 'text',
    start: 0,
    props: { text: 'Live!' },
  });
  const clips = editor.store.getState().course.chapters[0]!.tracks.flatMap((t) => t.clips);
  expect(clips.map((c) => c.id)).toEqual([added.created.clipId]);
  expect(editor.store.getState().past).toHaveLength(1); // undoable in the editor

  // Errors come back as tool errors.
  await expect(
    call('update_clip', { project: 'editor:1', clipId: 'nope', props: {} }),
  ).rejects.toThrow(/Unknown clip/);
  // The server sees the editor's course.
  const json = await call('get_course', { project: 'editor:1', format: 'json' });
  expect(JSON.stringify(json)).toContain('Live!');

  editor.socket.close();
  await editor.closed;
  await new Promise((r) => setTimeout(r, 20));
  expect((await call('list_projects')).editors).toEqual([]);
});

test('wrong codes, reused codes and expired codes are rejected', async () => {
  const { code } = await call('pair_editor');
  const wrong = fakeEditor(code === '000000' ? '111111' : '000000');
  expect(await wrong.first()).toEqual({ type: 'rejected', reason: 'Wrong pairing code' });
  expect(await wrong.closed).toBe(4003);

  const good = fakeEditor(code);
  expect((await good.first()).type).toBe('paired');
  const reused = fakeEditor(code);
  expect((await reused.first()).type).toBe('rejected');
  good.socket.close();

  const { code: later } = await call('pair_editor');
  now += 6 * 60 * 1000;
  const expired = fakeEditor(later);
  expect(await expired.first()).toMatchObject({
    type: 'rejected',
    reason: expect.stringMatching(/No valid pairing code/),
  });
});

test('the code is burnt after five wrong attempts', async () => {
  const { code } = await call('pair_editor');
  const other = code === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await fakeEditor(other).closed;
  const right = fakeEditor(code);
  expect((await right.first()).type).toBe('rejected');
});

test('connections from other origins are refused', async () => {
  const { code } = await call('pair_editor');
  const evil = new WebSocket(bridge.url, { origin: 'https://evil.example' });
  const error = await new Promise<Error>((resolve) => evil.on('error', resolve));
  expect(error.message).toMatch(/401/);
  void code;
});

test('the bridge listens on 127.0.0.1', () => {
  expect(bridge.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/bridge$/);
});
