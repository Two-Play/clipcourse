// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import { findApi, type WindowLike } from '../src/api.js';
import { formatIsoDuration, formatScorm12Time } from '../src/time.js';
import { createMockScorm12, createMockScorm2004 } from '../src/testing.js';

function chain(depth: number, top: WindowLike): WindowLike {
  let win: WindowLike = top;
  for (let i = 0; i < depth; i++) win = { parent: win };
  return win;
}

describe('findApi', () => {
  test('finds SCORM 1.2 in a parent frame', () => {
    const top: WindowLike = { API: createMockScorm12().api };
    top.parent = top;
    expect(findApi(chain(3, top))?.version).toBe('1.2');
  });

  test('prefers 2004 when both exist, unless 1.2 is required', () => {
    const top: WindowLike = {
      API: createMockScorm12().api,
      API_1484_11: createMockScorm2004().api,
    };
    expect(findApi(top)?.version).toBe('2004');
    expect(findApi(top, '1.2')?.version).toBe('1.2');
  });

  test('searches the opener chain', () => {
    const opener: WindowLike = { API_1484_11: createMockScorm2004().api };
    const popup: WindowLike = { opener };
    popup.top = popup;
    expect(findApi(popup)?.version).toBe('2004');
  });

  test('survives cross-origin parents', () => {
    const blocked = new Proxy({} as WindowLike, {
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(findApi({ parent: blocked })).toBeNull();
  });

  test('returns null without an LMS and ignores non-API objects', () => {
    expect(findApi({ API: { foo: 1 } })).toBeNull();
  });
});

describe('time formats', () => {
  test.each([
    [0, '00:00:00.00', 'PT0S'],
    [61.5, '00:01:01.50', 'PT1M1.5S'],
    [3723.456, '01:02:03.46', 'PT1H2M3.46S'],
    [400000, '111:06:40.00', 'PT111H6M40S'],
  ])('%s s → %s / %s', (seconds, scorm12, iso) => {
    expect(formatScorm12Time(seconds)).toBe(scorm12);
    expect(formatIsoDuration(seconds)).toBe(iso);
  });
});
