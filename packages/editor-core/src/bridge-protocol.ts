// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Messages between the MCP server's live bridge and an open editor
 * (WebSocket, JSON). The editor connects and proves the user's consent
 * with the pairing code; after that the server sends operations and the
 * editor answers with results and pushes its course after every change.
 */
import type { Course } from '@clipcourse/format';
import type { Operation, OperationResult } from './operations.js';

export const BRIDGE_PROTOCOL = 'clipcourse-bridge-1';
export const DEFAULT_BRIDGE_PORT = 4320;

/** Operation as sent over the wire: binary data base64-encoded. */
export type WireOperation =
  | Exclude<Operation, { op: 'add_asset' }>
  | (Omit<Extract<Operation, { op: 'add_asset' }>, 'data'> & { data: string });

export type EditorToServer =
  | { type: 'hello'; protocol: string; code: string; course: Course }
  | { type: 'result'; requestId: number; ok: true; result: OperationResult }
  | { type: 'result'; requestId: number; ok: false; error: string }
  | { type: 'files'; requestId: number; files: [string, string][] }
  | { type: 'course'; course: Course };

export type ServerToEditor =
  | { type: 'paired'; id: string }
  | { type: 'rejected'; reason: string }
  | { type: 'operation'; requestId: number; operation: WireOperation }
  | { type: 'get-files'; requestId: number };

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function toWire(operation: Operation): WireOperation {
  return operation.op === 'add_asset'
    ? { ...operation, data: bytesToBase64(operation.data) }
    : operation;
}

export function fromWire(operation: WireOperation): Operation {
  return operation.op === 'add_asset'
    ? { ...operation, data: base64ToBytes(operation.data) }
    : operation;
}
