// SPDX-License-Identifier: MIT
/**
 * A simulated LMS for tests and for the editor's preview. It implements the
 * parts of the SCORM 1.2 and 2004 run-time API that Clipcourse uses, with
 * the same state rules as a real LMS (initialize before use, read-only and
 * write-only elements, vocabularies, size limits, resume after "suspend").
 */
import type { Scorm12Api, Scorm2004Api, ScormVersion } from './api.js';

export interface LmsCall {
  method: string;
  args: string[];
  result: string;
}

/** What the LMS stores between launches (one learner, one attempt). */
export interface LmsRecord {
  data: Record<string, string>;
  launches: number;
}

export interface MockLms<A> {
  api: A;
  calls: LmsCall[];
  /** Current values, including uncommitted ones. */
  readonly values: Record<string, string>;
  /** Values as last committed (what a real LMS would have stored). */
  readonly record: LmsRecord;
  readonly state: 'not-initialized' | 'running' | 'terminated';
  /** Notified after every call (used by the editor's LMS panel). */
  onChange?: () => void;
}

const VOCAB_12 = ['passed', 'completed', 'failed', 'incomplete', 'browsed', 'not attempted'];
const VOCAB_2004 = ['completed', 'incomplete', 'not attempted', 'unknown'];

interface Spec {
  readOnly: string[];
  writeOnly: string[];
  limits: Record<string, number>;
  vocab: Record<string, string[]>;
  status: string;
  entry: string;
  exit: string;
  errors: Record<string, string>;
  codes: {
    notInitialized: string;
    afterTerminate: string;
    readOnly: string;
    writeOnly: string;
    badValue: string;
    unknown: string;
  };
}

const SPECS: Record<ScormVersion, Spec> = {
  '1.2': {
    readOnly: ['cmi.core.entry', 'cmi.core.student_id', 'cmi.core.student_name', 'cmi.core.credit'],
    writeOnly: ['cmi.core.exit', 'cmi.core.session_time'],
    limits: { 'cmi.suspend_data': 4096, 'cmi.core.lesson_location': 255 },
    vocab: {
      'cmi.core.lesson_status': VOCAB_12,
      'cmi.core.exit': ['time-out', 'suspend', 'logout', ''],
    },
    status: 'cmi.core.lesson_status',
    entry: 'cmi.core.entry',
    exit: 'cmi.core.exit',
    errors: {
      '0': 'No error',
      '101': 'General exception',
      '201': 'Invalid argument error',
      '301': 'Not initialized',
      '403': 'Element is read only',
      '404': 'Element is write only',
      '405': 'Incorrect data type',
    },
    codes: {
      notInitialized: '301',
      afterTerminate: '301',
      readOnly: '403',
      writeOnly: '404',
      badValue: '405',
      unknown: '201',
    },
  },
  '2004': {
    readOnly: ['cmi.entry', 'cmi.learner_id', 'cmi.learner_name', 'cmi.credit', 'cmi.mode'],
    writeOnly: ['cmi.exit', 'cmi.session_time'],
    limits: { 'cmi.suspend_data': 64000, 'cmi.location': 1000 },
    vocab: {
      'cmi.completion_status': VOCAB_2004,
      'cmi.exit': ['time-out', 'suspend', 'logout', 'normal', ''],
    },
    status: 'cmi.completion_status',
    entry: 'cmi.entry',
    exit: 'cmi.exit',
    errors: {
      '0': 'No error',
      '101': 'General exception',
      '122': 'Retrieve data before initialization',
      '123': 'Retrieve data after termination',
      '132': 'Store data before initialization',
      '133': 'Store data after termination',
      '401': 'Undefined data model element',
      '404': 'Data model element is read only',
      '405': 'Data model element is write only',
      '406': 'Data model element type mismatch',
      '407': 'Data model element value out of range',
    },
    codes: {
      notInitialized: '122',
      afterTerminate: '123',
      readOnly: '404',
      writeOnly: '405',
      badValue: '406',
      unknown: '401',
    },
  },
};

const KNOWN_PREFIXES = [
  'cmi.interactions',
  'cmi.core.',
  'cmi.suspend_data',
  'cmi.location',
  'cmi.completion_status',
  'cmi.success_status',
  'cmi.progress_measure',
  'cmi.entry',
  'cmi.exit',
  'cmi.session_time',
  'cmi.learner_',
  'cmi.credit',
  'cmi.mode',
  'cmi.score',
  'cmi.launch_data',
];

/** Creates a fresh, empty LMS record (first launch). */
export function createLmsRecord(): LmsRecord {
  return { data: {}, launches: 0 };
}

function createCore(version: ScormVersion, record: LmsRecord) {
  const spec = SPECS[version];
  let state: 'not-initialized' | 'running' | 'terminated' = 'not-initialized';
  let lastError = '0';
  let values: Record<string, string> = {};
  const calls: LmsCall[] = [];
  const mock = { calls, onChange: undefined as (() => void) | undefined };

  const fail = (code: string) => {
    lastError = code;
    return code;
  };

  const initialize = () => {
    if (state !== 'not-initialized') {
      lastError = '101';
      return 'false';
    }
    state = 'running';
    lastError = '0';
    record.launches++;
    const resume = record.data[spec.exit] === 'suspend';
    values = resume
      ? { ...record.data }
      : { 'cmi.suspend_data': '', [spec.status]: version === '1.2' ? 'not attempted' : 'unknown' };
    if (
      !resume &&
      record.data[spec.status] &&
      ['completed', 'passed'].includes(record.data[spec.status]!)
    ) {
      values[spec.status] = record.data[spec.status]!;
    }
    values[spec.entry] = resume ? 'resume' : 'ab-initio';
    delete values[spec.exit];
    return 'true';
  };

  const getValue = (element: string) => {
    if (state !== 'running')
      return (
        fail(state === 'terminated' ? spec.codes.afterTerminate : spec.codes.notInitialized),
        ''
      );
    if (spec.writeOnly.includes(element)) return (fail(spec.codes.writeOnly), '');
    if (!KNOWN_PREFIXES.some((p) => element.startsWith(p))) return (fail(spec.codes.unknown), '');
    lastError = '0';
    if (element === 'cmi.interactions._count') {
      const indexes = new Set(
        Object.keys(values)
          .map((k) => /^cmi\.interactions\.(\d+)\./.exec(k)?.[1])
          .filter(Boolean),
      );
      return String(indexes.size);
    }
    return values[element] ?? '';
  };

  const setValue = (element: string, value: string) => {
    if (state !== 'running') {
      fail(version === '1.2' ? '301' : state === 'terminated' ? '133' : '132');
      return 'false';
    }
    if (spec.readOnly.includes(element)) return (fail(spec.codes.readOnly), 'false');
    if (!KNOWN_PREFIXES.some((p) => element.startsWith(p)))
      return (fail(spec.codes.unknown), 'false');
    const limit = spec.limits[element];
    if (limit !== undefined && value.length > limit) return (fail(spec.codes.badValue), 'false');
    const vocab = spec.vocab[element];
    if (vocab && !vocab.includes(value)) return (fail(spec.codes.badValue), 'false');
    const interaction = /^cmi\.interactions\.(\d+)\.(\w+)/.exec(element);
    if (interaction) {
      const [, index, field] = interaction;
      const count = new Set(
        Object.keys(values)
          .map((k) => /^cmi\.interactions\.(\d+)\./.exec(k)?.[1])
          .filter(Boolean),
      ).size;
      if (Number(index) > count) return (fail(version === '1.2' ? '201' : '351'), 'false');
      const type = values[`cmi.interactions.${index}.type`];
      if (
        version === '1.2' &&
        (field === 'student_response' || field === 'correct_responses') &&
        (type === 'choice' || type === 'sequencing')
      ) {
        // CMIFeedback for choice/sequencing: single characters a-z, 0-9.
        if (value !== '' && !/^[a-z0-9](,[a-z0-9])*$/.test(value)) return (fail('405'), 'false');
      }
    }
    for (const scoreKey of ['cmi.core.score.raw', 'cmi.score.raw', 'cmi.score.scaled']) {
      if (element === scoreKey && Number.isNaN(Number(value)))
        return (fail(spec.codes.badValue), 'false');
    }
    if (element === 'cmi.progress_measure') {
      const n = Number(value);
      if (!(n >= 0 && n <= 1)) return (fail('407'), 'false');
    }
    values[element] = value;
    lastError = '0';
    return 'true';
  };

  const commit = () => {
    if (state !== 'running') return (fail(version === '1.2' ? '301' : '142'), 'false');
    record.data = { ...values };
    lastError = '0';
    return 'true';
  };

  const terminate = () => {
    if (state !== 'running') return (fail('101'), 'false');
    record.data = { ...values };
    state = 'terminated';
    lastError = '0';
    return 'true';
  };

  return {
    mock,
    spec,
    initialize,
    getValue,
    setValue,
    commit,
    terminate,
    lastError: () => lastError,
    errorString: (code: string) => spec.errors[code] ?? 'Unknown error',
    get state() {
      return state;
    },
    get values() {
      return values;
    },
  };
}

function finish<A>(core: ReturnType<typeof createCore>, api: A, record: LmsRecord): MockLms<A> {
  // defineProperties (not Object.assign) keeps the getters live.
  return Object.defineProperties(core.mock, {
    api: { value: api, enumerable: true },
    values: { get: () => core.values, enumerable: true },
    record: { get: () => record, enumerable: true },
    state: { get: () => core.state, enumerable: true },
  }) as unknown as MockLms<A>;
}

export function createMockScorm12(record: LmsRecord = createLmsRecord()): MockLms<Scorm12Api> {
  const core = createCore('1.2', record);
  const l = (m: string, args: string[], r: string) => {
    core.mock.calls.push({ method: m, args, result: r });
    core.mock.onChange?.();
    return r;
  };
  const api: Scorm12Api = {
    LMSInitialize: () => l('LMSInitialize', [], core.initialize()),
    LMSFinish: () => l('LMSFinish', [], core.terminate()),
    LMSGetValue: (e) => l('LMSGetValue', [e], core.getValue(e)),
    LMSSetValue: (e, v) => l('LMSSetValue', [e, v], core.setValue(e, v)),
    LMSCommit: () => l('LMSCommit', [], core.commit()),
    LMSGetLastError: () => core.lastError(),
    LMSGetErrorString: (c) => core.errorString(c),
    LMSGetDiagnostic: (c) => core.errorString(c),
  };
  return finish(core, api, record);
}

export function createMockScorm2004(record: LmsRecord = createLmsRecord()): MockLms<Scorm2004Api> {
  const core = createCore('2004', record);
  const l = (m: string, args: string[], r: string) => {
    core.mock.calls.push({ method: m, args, result: r });
    core.mock.onChange?.();
    return r;
  };
  const api: Scorm2004Api = {
    Initialize: () => l('Initialize', [], core.initialize()),
    Terminate: () => l('Terminate', [], core.terminate()),
    GetValue: (e) => l('GetValue', [e], core.getValue(e)),
    SetValue: (e, v) => l('SetValue', [e, v], core.setValue(e, v)),
    Commit: () => l('Commit', [], core.commit()),
    GetLastError: () => core.lastError(),
    GetErrorString: (c) => core.errorString(c),
    GetDiagnostic: (c) => core.errorString(c),
  };
  return finish(core, api, record);
}

export function createMockLms(version: ScormVersion, record?: LmsRecord) {
  return version === '1.2' ? createMockScorm12(record) : createMockScorm2004(record);
}
