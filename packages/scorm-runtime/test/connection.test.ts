// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import type { ScormVersion } from '../src/api.js';
import { connect } from '../src/connection.js';
import { createLmsRecord, createMockLms, createMockScorm12 } from '../src/testing.js';

const versions: ScormVersion[] = ['1.2', '2004'];
const statusKey = (v: ScormVersion) =>
  v === '1.2' ? 'cmi.core.lesson_status' : 'cmi.completion_status';

describe.each(versions)('SCORM %s adapter', (version) => {
  const open = (record = createLmsRecord(), now = () => 0) => {
    const lms = createMockLms(version, record);
    const conn = connect({ version, api: lms.api } as never, now)!;
    return { lms, conn, record };
  };

  test('marks a new attempt incomplete', () => {
    const { lms, conn } = open();
    expect(conn.resumed).toBe(false);
    expect(conn.completed).toBe(false);
    expect(lms.values[statusKey(version)]).toBe('incomplete');
  });

  test('stores bookmark data and resumes it in the next launch', () => {
    const record = createLmsRecord();
    const first = open(record);
    first.conn.saveProgress({ suspendData: '1~1~a~1', location: 'ch2', progress: 0.5 });
    first.conn.terminate();
    expect(first.lms.state).toBe('terminated');
    if (version === '2004') expect(record.data['cmi.progress_measure']).toBe('0.5');

    const second = open(record);
    expect(second.conn.resumed).toBe(true);
    expect(second.conn.getSuspendData()).toBe('1~1~a~1');
    expect(second.conn.getLocation()).toBe('ch2');
  });

  test('completion is sticky and reported as completed', () => {
    const record = createLmsRecord();
    const { conn } = open(record);
    conn.setCompleted();
    conn.terminate();
    expect(record.data[statusKey(version)]).toBe('completed');
    const again = open(record);
    expect(again.conn.completed).toBe(true);
    if (version === '2004') {
      again.conn.saveProgress({ suspendData: 'x', location: 'a', progress: 0.1 });
      expect(again.lms.values['cmi.progress_measure']).toBe('1');
    }
  });

  test('writes session time and suspend on terminate, only once', () => {
    let t = 0;
    const { lms, conn } = open(createLmsRecord(), () => t);
    t = 61_500;
    conn.terminate();
    conn.terminate();
    const sessionKey = version === '1.2' ? 'cmi.core.session_time' : 'cmi.session_time';
    expect(lms.values[sessionKey]).toBe(version === '1.2' ? '00:01:01.50' : 'PT1M1.5S');
    expect(lms.calls.filter((c) => /Finish|Terminate/.test(c.method))).toHaveLength(1);
    expect(conn.diagnostics).toEqual([]);
  });

  test('ignores calls after terminate', () => {
    const { lms, conn } = open();
    conn.terminate();
    const count = lms.calls.length;
    conn.saveProgress({ suspendData: 'x', location: 'y', progress: 1 });
    conn.setCompleted();
    conn.commit();
    expect(lms.calls.length).toBe(count);
  });

  test('refuses oversized suspend data without breaking', () => {
    const { lms, conn } = open();
    conn.saveProgress({ suspendData: 'x'.repeat(70000), location: 'y', progress: 0 });
    expect(lms.values['cmi.suspend_data']).toBe('');
    expect(conn.diagnostics[0]).toMatch(/too long/);
  });
});

test('returns null when the LMS refuses to initialize', () => {
  const lms = createMockScorm12();
  lms.api.LMSInitialize('');
  expect(connect({ version: '1.2', api: lms.api })).toBeNull();
});

test('logs LMS errors as diagnostics', () => {
  const lms = createMockScorm12();
  const conn = connect({ version: '1.2', api: lms.api })!;
  conn.saveProgress({ suspendData: 'ok', location: 'l'.repeat(300), progress: 0 });
  expect(lms.values['cmi.core.lesson_location']).toHaveLength(255);
  // Writing a read-only element through the raw API is reported by the mock:
  expect(lms.api.LMSSetValue('cmi.core.entry', 'x')).toBe('false');
  expect(lms.api.LMSGetLastError()).toBe('403');
});

test.each(['1.2', '2004'] as const)(
  'SCORM %s: exit=suspend is committed even if terminate never arrives',
  (version) => {
    const record = createLmsRecord();
    const lms = createMockLms(version, record);
    const conn = connect({ version, api: lms.api } as never)!;
    conn.saveProgress({ suspendData: '1~0~0~1', location: 'a', progress: 0.5 });
    conn.commit();
    // Window closed without Terminate: the LMS keeps the last commit.
    const next = createMockLms(version, record);
    const again = connect({ version, api: next.api } as never)!;
    expect(again.resumed).toBe(true);
    expect(again.getSuspendData()).toBe('1~0~0~1');
  },
);
