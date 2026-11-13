// SPDX-License-Identifier: MIT
/**
 * SCORM API types and discovery.
 *
 * An LMS exposes `API` (SCORM 1.2) or `API_1484_11` (SCORM 2004) on a parent
 * window or on the window that opened the course. Discovery follows the ADL
 * algorithm: walk up the parent chain, then try the opener's chain.
 */

export interface Scorm12Api {
  LMSInitialize(arg: ''): string;
  LMSFinish(arg: ''): string;
  LMSGetValue(element: string): string;
  LMSSetValue(element: string, value: string): string;
  LMSCommit(arg: ''): string;
  LMSGetLastError(): string;
  LMSGetErrorString(code: string): string;
  LMSGetDiagnostic(code: string): string;
}

export interface Scorm2004Api {
  Initialize(arg: ''): string;
  Terminate(arg: ''): string;
  GetValue(element: string): string;
  SetValue(element: string, value: string): string;
  Commit(arg: ''): string;
  GetLastError(): string;
  GetErrorString(code: string): string;
  GetDiagnostic(code: string): string;
}

export type ScormVersion = '1.2' | '2004';

export type FoundApi = { version: '1.2'; api: Scorm12Api } | { version: '2004'; api: Scorm2004Api };

/** Minimal window shape used for discovery (real windows or test doubles). */
export interface WindowLike {
  parent?: WindowLike | null;
  opener?: WindowLike | null;
  top?: WindowLike | null;
  API?: unknown;
  API_1484_11?: unknown;
}

/** Same limit as the ADL reference implementation. */
const MAX_DEPTH = 500;

function readApi(win: WindowLike, preferred: ScormVersion | 'auto'): FoundApi | null {
  try {
    const api2004 = win.API_1484_11 as Scorm2004Api | undefined;
    const api12 = win.API as Scorm12Api | undefined;
    const has2004 = !!api2004 && typeof api2004.Initialize === 'function';
    const has12 = !!api12 && typeof api12.LMSInitialize === 'function';
    if (preferred !== '1.2' && has2004) return { version: '2004', api: api2004 };
    if (preferred !== '2004' && has12) return { version: '1.2', api: api12 };
  } catch {
    // Cross-origin window: no access, keep searching.
  }
  return null;
}

function searchChain(
  start: WindowLike | null | undefined,
  preferred: ScormVersion | 'auto',
): FoundApi | null {
  let win = start;
  for (let depth = 0; win && depth < MAX_DEPTH; depth++) {
    const found = readApi(win, preferred);
    if (found) return found;
    let parent: WindowLike | null | undefined;
    try {
      parent = win.parent;
    } catch {
      return null;
    }
    if (!parent || parent === win) break;
    win = parent;
  }
  return null;
}

/**
 * Finds the LMS API. With `preferred` set to a version, only that version is
 * accepted (the exported package declares its version in the manifest).
 */
export function findApi(
  win: WindowLike,
  preferred: ScormVersion | 'auto' = 'auto',
): FoundApi | null {
  const own = searchChain(win, preferred);
  if (own) return own;
  let opener: WindowLike | null | undefined;
  try {
    opener = win.top?.opener ?? win.opener;
  } catch {
    opener = null;
  }
  return opener ? searchChain(opener, preferred) : null;
}
