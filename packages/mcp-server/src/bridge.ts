// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Live bridge: lets the AI edit the project that is open in the editor.
 *
 * Security model:
 * - WebSocket server on 127.0.0.1 only
 * - the editor must connect from a known editor origin (browser editor on
 *   localhost, or the desktop app); other web pages are refused
 * - consent: the AI asks for a pairing code (pair_editor), tells the user,
 *   and the user types it into the editor. Codes are random, one-time,
 *   expire after 5 minutes and are burnt after 5 wrong attempts
 * - the editor applies operations through its own store, so every change
 *   is visible immediately and undoable there
 */
import { randomInt } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  base64ToBytes,
  BRIDGE_PROTOCOL,
  DEFAULT_BRIDGE_PORT,
  toWire,
  type EditorToServer,
  type Operation,
  type OperationResult,
  type ServerToEditor,
  type WireOperation,
} from '@clipcourse/editor-core';
import type { Course } from '@clipcourse/format';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ProjectTarget, Workspace } from './workspace.js';

export const DEFAULT_EDITOR_ORIGINS = [
  'http://localhost:4318',
  'http://127.0.0.1:4318',
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];
export const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_MESSAGE_BYTES = 600 * 1024 * 1024;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** The open editor as a project the tools can work on. */
class EditorTarget implements ProjectTarget {
  readonly kind = 'editor';
  private latest: Course;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    readonly id: string,
    private readonly socket: WebSocket,
    course: Course,
  ) {
    this.latest = course;
  }

  course() {
    return this.latest;
  }

  /** Media files live in the editor; use fetchFiles(). */
  files(): Map<string, Uint8Array> {
    throw new Error('Files of a live editor must be fetched (fetchFiles)');
  }

  async fetchFiles(): Promise<Map<string, Uint8Array>> {
    const files = (await this.request({ type: 'get-files' })) as [string, string][];
    return new Map(files.map(([path, data]) => [path, base64ToBytes(data)]));
  }

  async execute(operation: Operation): Promise<OperationResult> {
    return (await this.request({
      type: 'operation',
      operation: toWire(operation),
    })) as OperationResult;
  }

  private request(
    message: { type: 'operation'; operation: WireOperation } | { type: 'get-files' },
  ) {
    const requestId = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('The editor did not answer in time'));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ ...message, requestId } satisfies ServerToEditor));
    });
  }

  handle(message: EditorToServer) {
    if (message.type === 'course') {
      this.latest = message.course;
      return;
    }
    if (message.type !== 'result' && message.type !== 'files') return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.type === 'files') pending.resolve(message.files);
    else if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error));
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('The editor disconnected'));
    }
    this.pending.clear();
  }
}

export interface BridgeOptions {
  workspace: Workspace;
  port?: number;
  /** Origins allowed to connect (default: local browser editor and desktop app). */
  allowedOrigins?: string[];
  now?: () => number;
}

export interface Bridge {
  port: number;
  url: string;
  /** Creates a new pairing code (invalidates the previous one). */
  createPairingCode(): { code: string; expiresAt: number };
  close(): Promise<void>;
}

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const now = options.now ?? Date.now;
  const origins = new Set(options.allowedOrigins ?? DEFAULT_EDITOR_ORIGINS);
  let pairing: { code: string; expiresAt: number; attempts: number } | null = null;
  let counter = 0;

  const wss = new WebSocketServer({
    host: '127.0.0.1',
    port: options.port ?? DEFAULT_BRIDGE_PORT,
    path: '/bridge',
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info: { origin: string; req: IncomingMessage }) => origins.has(info.origin),
  });
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });

  wss.on('connection', (socket) => {
    let target: EditorTarget | null = null;
    const send = (message: ServerToEditor) => socket.send(JSON.stringify(message));
    const helloTimer = setTimeout(() => socket.close(4000, 'Pairing timed out'), 30_000);

    socket.on('message', (raw) => {
      let message: EditorToServer;
      try {
        message = JSON.parse(String(raw)) as EditorToServer;
      } catch {
        socket.close(4001, 'Invalid message');
        return;
      }
      if (target) {
        target.handle(message);
        return;
      }
      if (message.type !== 'hello' || message.protocol !== BRIDGE_PROTOCOL) {
        send({ type: 'rejected', reason: 'Unsupported protocol' });
        socket.close(4002, 'Unsupported protocol');
        return;
      }
      const valid = pairing && now() < pairing.expiresAt && pairing.attempts < MAX_ATTEMPTS;
      if (!valid || message.code !== pairing!.code) {
        if (pairing) pairing.attempts++;
        send({
          type: 'rejected',
          reason: valid
            ? 'Wrong pairing code'
            : 'No valid pairing code; ask the AI assistant for a new one',
        });
        socket.close(4003, 'Pairing failed');
        return;
      }
      pairing = null; // one-time
      clearTimeout(helloTimer);
      target = new EditorTarget(`editor:${++counter}`, socket, message.course);
      options.workspace.addTarget(target);
      send({ type: 'paired', id: target.id });
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (target) {
        target.close();
        options.workspace.removeTarget(target.id);
      }
    });
  });

  const address = wss.address();
  const port =
    typeof address === 'object' && address ? address.port : (options.port ?? DEFAULT_BRIDGE_PORT);
  return {
    port,
    url: `ws://127.0.0.1:${port}/bridge`,
    createPairingCode() {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      pairing = { code, expiresAt: now() + PAIRING_TTL_MS, attempts: 0 };
      return { code, expiresAt: pairing.expiresAt };
    },
    close() {
      for (const client of wss.clients) client.terminate();
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };
}
