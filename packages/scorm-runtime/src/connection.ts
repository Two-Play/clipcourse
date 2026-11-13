// SPDX-License-Identifier: MIT
/**
 * A version-independent connection to the LMS. Adapters map our few needs
 * (bookmark, suspend data, progress, completion, session time) to the SCORM
 * 1.2 and 2004 data models. Errors never reach the player; they are logged
 * in `diagnostics` so the course keeps working even with a buggy LMS.
 */
import type { FoundApi, Scorm12Api, Scorm2004Api, ScormVersion } from './api.js';
import { formatIsoDuration, formatScorm12Time } from './time.js';

export interface LmsConnection {
  readonly version: ScormVersion;
  /** True if the LMS says this is a resumed attempt. */
  readonly resumed: boolean;
  /** True if the LMS already has this attempt as completed. */
  readonly completed: boolean;
  getSuspendData(): string;
  getLocation(): string;
  /** Stores bookmark data; `progress` is 0..1 (SCORM 2004 progress_measure). */
  saveProgress(data: { suspendData: string; location: string; progress: number }): void;
  setCompleted(): void;
  commit(): void;
  /** Ends the session; safe to call more than once. */
  terminate(): void;
  readonly diagnostics: string[];
}

/** SCORM 1.2 allows 4096 characters of suspend data, SCORM 2004 at least 64000. */
export const SUSPEND_DATA_LIMIT: Record<ScormVersion, number> = { '1.2': 4096, '2004': 64000 };
const LOCATION_LIMIT: Record<ScormVersion, number> = { '1.2': 255, '2004': 1000 };

interface Calls {
  init(): boolean;
  finish(): boolean;
  get(element: string): string;
  set(element: string, value: string): boolean;
  commit(): boolean;
  lastError(): string;
  describe(code: string): string;
}

function wrap12(api: Scorm12Api): Calls {
  return {
    init: () => String(api.LMSInitialize('')) === 'true',
    finish: () => String(api.LMSFinish('')) === 'true',
    get: (e) => String(api.LMSGetValue(e) ?? ''),
    set: (e, v) => String(api.LMSSetValue(e, v)) === 'true',
    commit: () => String(api.LMSCommit('')) === 'true',
    lastError: () => String(api.LMSGetLastError()),
    describe: (c) => `${api.LMSGetErrorString(c)} ${api.LMSGetDiagnostic(c)}`.trim(),
  };
}

function wrap2004(api: Scorm2004Api): Calls {
  return {
    init: () => String(api.Initialize('')) === 'true',
    finish: () => String(api.Terminate('')) === 'true',
    get: (e) => String(api.GetValue(e) ?? ''),
    set: (e, v) => String(api.SetValue(e, v)) === 'true',
    commit: () => String(api.Commit('')) === 'true',
    lastError: () => String(api.GetLastError()),
    describe: (c) => `${api.GetErrorString(c)} ${api.GetDiagnostic(c)}`.trim(),
  };
}

const ELEMENTS = {
  '1.2': {
    entry: 'cmi.core.entry',
    status: 'cmi.core.lesson_status',
    location: 'cmi.core.lesson_location',
    suspend: 'cmi.suspend_data',
    exit: 'cmi.core.exit',
    sessionTime: 'cmi.core.session_time',
  },
  '2004': {
    entry: 'cmi.entry',
    status: 'cmi.completion_status',
    location: 'cmi.location',
    suspend: 'cmi.suspend_data',
    exit: 'cmi.exit',
    sessionTime: 'cmi.session_time',
  },
} as const;

/**
 * Initializes the LMS session. Returns null if the LMS refuses to
 * initialize; the course then falls back to local progress.
 */
export function connect(found: FoundApi, now: () => number = Date.now): LmsConnection | null {
  const { version } = found;
  const calls = version === '1.2' ? wrap12(found.api) : wrap2004(found.api as Scorm2004Api);
  const el = ELEMENTS[version];
  const diagnostics: string[] = [];

  const check = (action: string, ok: boolean) => {
    if (ok) return true;
    const code = calls.lastError();
    if (code && code !== '0') diagnostics.push(`${action}: error ${code} ${calls.describe(code)}`);
    return false;
  };
  const get = (element: string) => {
    const value = calls.get(element);
    const code = calls.lastError();
    if (code && code !== '0' && code !== '403')
      diagnostics.push(`GetValue(${element}): error ${code}`);
    return value;
  };
  const set = (element: string, value: string) =>
    check(`SetValue(${element})`, calls.set(element, value));

  if (!check('Initialize', calls.init())) return null;

  const startedAt = now();
  const status = get(el.status);
  let completed = status === 'completed' || status === 'passed';
  const resumed = get(el.entry) === 'resume';
  let active = true;

  // Mark the attempt as started.
  if (
    !completed &&
    (status === '' || status === 'not attempted' || status === 'unknown' || status === 'browsed')
  ) {
    set(el.status, 'incomplete');
  }

  return {
    version,
    resumed,
    get completed() {
      return completed;
    },
    diagnostics,
    getSuspendData: () => (active ? get(el.suspend) : ''),
    getLocation: () => (active ? get(el.location) : ''),
    saveProgress({ suspendData, location, progress }) {
      if (!active) return;
      if (suspendData.length > SUSPEND_DATA_LIMIT[version]) {
        diagnostics.push(`suspend data too long (${suspendData.length} characters), not saved`);
      } else {
        set(el.suspend, suspendData);
      }
      set(el.location, location.slice(0, LOCATION_LIMIT[version]));
      if (version === '2004') {
        const measure = Math.min(1, Math.max(0, progress));
        set('cmi.progress_measure', completed ? '1' : String(Math.round(measure * 1e7) / 1e7));
      }
    },
    setCompleted() {
      if (!active || completed) return;
      completed = true;
      set(el.status, 'completed');
      if (version === '2004') set('cmi.progress_measure', '1');
    },
    commit() {
      if (active) check('Commit', calls.commit());
    },
    terminate() {
      if (!active) return;
      const seconds = (now() - startedAt) / 1000;
      set(
        el.sessionTime,
        version === '1.2' ? formatScorm12Time(seconds) : formatIsoDuration(seconds),
      );
      // "suspend" keeps the bookmark for the next launch.
      set(el.exit, 'suspend');
      check('Commit', calls.commit());
      check('Terminate', calls.finish());
      active = false;
    },
  };
}
