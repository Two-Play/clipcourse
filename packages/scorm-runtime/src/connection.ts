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
  /**
   * Marks the attempt complete. With `passed` (an assessment was taken),
   * SCORM 1.2 reports "passed"/"failed" instead of "completed".
   */
  setCompleted(passed?: boolean | null): void;
  /** Score in percent of the scored points (0–100). */
  setScore(score: { earned: number; possible: number }): void;
  /** SCORM 2004 success_status; SCORM 1.2 keeps it for setCompleted. */
  setSuccess(passed: boolean): void;
  /** Journals one answer (cmi.interactions). */
  recordInteraction(interaction: Interaction): void;
  commit(): void;
  /** Ends the session; safe to call more than once. */
  terminate(): void;
  readonly diagnostics: string[];
}

export type InteractionType = 'choice' | 'fill-in' | 'sequencing' | 'matching' | 'other';

export interface Interaction {
  id: string;
  type: InteractionType;
  /** Response as a list of identifiers (choice, sequencing), pairs (matching) or text. */
  response: string[] | [string, string][] | string;
  correct: string[] | [string, string][] | string;
  result: boolean;
  weighting: number;
  description?: string;
  /** Short ids for SCORM 1.2 choice/sequencing vocabularies (index → single character). */
  ids?: string[];
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
  let success: boolean | null = null;
  let interactionCount = 0;

  // Ask for a resumable exit right away, so every commit carries it. Some
  // LMS players save asynchronously and lose the last call when the page
  // unloads; the bookmark then still works on the next launch.
  set(el.exit, 'suspend');

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
    setCompleted(passed?: boolean | null) {
      if (!active || completed) return;
      completed = true;
      const outcome = passed ?? success;
      if (version === '1.2') {
        set(el.status, outcome === true ? 'passed' : outcome === false ? 'failed' : 'completed');
      } else {
        set(el.status, 'completed');
        set('cmi.progress_measure', '1');
        if (outcome !== null && outcome !== undefined)
          set('cmi.success_status', outcome ? 'passed' : 'failed');
      }
    },
    setScore({ earned, possible }) {
      if (!active || possible <= 0) return;
      const percent = Math.round((earned / possible) * 10000) / 100;
      const prefix = version === '1.2' ? 'cmi.core.score' : 'cmi.score';
      set(`${prefix}.min`, '0');
      set(`${prefix}.max`, '100');
      set(`${prefix}.raw`, String(percent));
      if (version === '2004')
        set('cmi.score.scaled', String(Math.round((percent / 100) * 10000) / 10000));
    },
    setSuccess(passed: boolean) {
      if (!active) return;
      success = passed;
      if (version === '2004') set('cmi.success_status', passed ? 'passed' : 'failed');
    },
    recordInteraction(interaction: Interaction) {
      if (!active) return;
      const countText = get('cmi.interactions._count');
      const n = /^\d+$/.test(countText) ? Number(countText) : interactionCount;
      interactionCount = n + 1;
      const base = `cmi.interactions.${n}`;
      const format = (value: Interaction['response']) =>
        formatResponse(version, interaction.type, value, interaction.ids);
      set(`${base}.id`, interaction.id.slice(0, version === '1.2' ? 255 : 4000));
      set(
        `${base}.type`,
        version === '1.2' && interaction.type === 'other' ? 'performance' : interaction.type,
      );
      set(`${base}.weighting`, String(interaction.weighting));
      set(
        `${base}.${version === '1.2' ? 'student_response' : 'learner_response'}`,
        format(interaction.response),
      );
      set(`${base}.correct_responses.0.pattern`, format(interaction.correct));
      set(
        `${base}.result`,
        interaction.result ? 'correct' : version === '1.2' ? 'wrong' : 'incorrect',
      );
      if (version === '2004') {
        set(`${base}.timestamp`, new Date(now()).toISOString().replace(/\.\d{3}Z$/, ''));
        if (interaction.description)
          set(`${base}.description`, interaction.description.slice(0, 250));
      } else {
        const d = new Date(now());
        set(
          `${base}.time`,
          [d.getHours(), d.getMinutes(), d.getSeconds()]
            .map((x) => String(x).padStart(2, '0'))
            .join(':'),
        );
      }
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

/**
 * Formats a response for the data model. SCORM 1.2 choice and sequencing
 * responses must use single characters, so ids are mapped to a, b, c …
 * by their position in `ids`.
 */
export function formatResponse(
  version: ScormVersion,
  type: InteractionType,
  value: Interaction['response'],
  ids: string[] = [],
): string {
  if (typeof value === 'string')
    return version === '1.2' ? value.slice(0, 255) : value.slice(0, 4000);
  const short = (id: string) => {
    if (version === '2004') return id;
    const index = ids.indexOf(id);
    return index >= 0 && index < 26 ? String.fromCharCode(97 + index) : id;
  };
  if (type === 'matching') {
    const pairs = value as [string, string][];
    return version === '1.2'
      ? pairs.map(([a, b]) => `${short(a)}.${short(b)}`).join(',')
      : pairs.map(([a, b]) => `${a}[.]${b}`).join('[,]');
  }
  const list = value as string[];
  return version === '1.2' ? list.map(short).join(',') : list.join('[,]');
}
