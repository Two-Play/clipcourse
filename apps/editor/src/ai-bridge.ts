// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Editor side of the live bridge: connects to a local Clipcourse MCP
 * server, proves consent with the pairing code the user typed, then runs
 * the AI's operations through the editor store (visible and undoable) and
 * keeps the server's copy of the course up to date.
 */
import {
  BRIDGE_PROTOCOL,
  bytesToBase64,
  DEFAULT_BRIDGE_PORT,
  executeOperation,
  fromWire,
  type EditorToServer,
  type ServerToEditor,
} from '@clipcourse/editor-core';
import type { EditorSession } from './session.js';

export const DEFAULT_BRIDGE_URL = `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}/bridge`;

export type BridgeStatus =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; id: string; lastAction?: string }
  | { state: 'error'; message: string };

/** Only local bridges are allowed: the AI's server runs on this computer. */
export function isLocalBridgeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'ws:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export class AiBridge {
  private socket: WebSocket | null = null;
  private unsubscribe: (() => void) | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(status: BridgeStatus) => void>();
  status: BridgeStatus = { state: 'idle' };

  constructor(private readonly session: EditorSession) {}

  onStatus(listener: (status: BridgeStatus) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: BridgeStatus) {
    this.status = status;
    for (const l of this.listeners) l(status);
  }

  connect(code: string, url = DEFAULT_BRIDGE_URL) {
    if (!/^\d{6}$/.test(code)) {
      this.setStatus({ state: 'error', message: 'The code has 6 digits.' });
      return;
    }
    if (!isLocalBridgeUrl(url)) {
      this.setStatus({
        state: 'error',
        message: 'Only a local assistant (ws://127.0.0.1) can connect.',
      });
      return;
    }
    this.disconnect();
    this.setStatus({ state: 'connecting' });
    const socket = new WebSocket(url);
    this.socket = socket;
    const send = (message: EditorToServer) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    socket.onopen = () => {
      send({
        type: 'hello',
        protocol: BRIDGE_PROTOCOL,
        code,
        course: this.session.store.getState().course,
      });
    };
    socket.onerror = () => {
      if (this.status.state === 'connecting') {
        this.setStatus({
          state: 'error',
          message: 'No AI assistant found. Is clipcourse-mcp running with --bridge?',
        });
      }
    };
    socket.onclose = () => {
      this.cleanup();
      if (this.status.state === 'connected') this.setStatus({ state: 'idle' });
      else if (this.status.state === 'connecting')
        this.setStatus({ state: 'error', message: 'The connection was refused.' });
    };
    socket.onmessage = (event) => {
      let message: ServerToEditor;
      try {
        message = JSON.parse(String(event.data)) as ServerToEditor;
      } catch {
        return;
      }
      switch (message.type) {
        case 'paired':
          this.setStatus({ state: 'connected', id: message.id });
          this.unsubscribe = this.session.store.subscribe((s, prev) => {
            if (s.course !== prev.course && !s.transaction) this.schedulePush(send);
          });
          break;
        case 'rejected':
          this.setStatus({ state: 'error', message: message.reason });
          break;
        case 'operation': {
          const operation = fromWire(message.operation);
          try {
            const result = executeOperation(
              { store: this.session.store, files: this.session.files },
              operation,
            );
            if (operation.op === 'add_asset' || operation.op === 'add_chapter')
              this.session.notifyFilesChanged();
            if (operation.op === 'add_chapter' && result.created?.chapterId) {
              this.session.store.getState().setChapter(result.created.chapterId);
            }
            send({ type: 'result', requestId: message.requestId, ok: true, result });
            send({ type: 'course', course: this.session.store.getState().course });
            if (this.status.state === 'connected')
              this.setStatus({ ...this.status, lastAction: result.message });
          } catch (error) {
            send({
              type: 'result',
              requestId: message.requestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          break;
        }
        case 'get-files': {
          const course = this.session.store.getState().course;
          const used = new Set(Object.values(course.assets).map((a) => a.src));
          const files: [string, string][] = [...this.session.files]
            .filter(([path]) => used.has(path))
            .map(([path, data]) => [path, bytesToBase64(data)]);
          send({ type: 'files', requestId: message.requestId, files });
          break;
        }
      }
    };
  }

  /** The user's own edits are sent too, so the AI always sees the current course. */
  private schedulePush(send: (message: EditorToServer) => void) {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(
      () => send({ type: 'course', course: this.session.store.getState().course }),
      150,
    );
  }

  private cleanup() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.socket = null;
  }

  disconnect() {
    const socket = this.socket;
    this.cleanup();
    if (socket && socket.readyState <= WebSocket.OPEN)
      socket.close(1000, 'Disconnected by the user');
    this.setStatus({ state: 'idle' });
  }
}
