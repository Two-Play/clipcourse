// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import { decodeProgress, encodeProgress } from '../src/core/progress.js';

describe('progress codec', () => {
  test('round-trips', () => {
    const progress = {
      chapterIndex: 5,
      time: 123400,
      seen: [true, false, true, true, false, true, false],
    };
    const encoded = encodeProgress(progress);
    expect(decodeProgress(encoded, 7)).toEqual(progress);
  });

  test('stores time in tenths of a second', () => {
    const encoded = encodeProgress({ chapterIndex: 0, time: 1999, seen: [false] });
    expect(decodeProgress(encoded, 1)?.time).toBe(1900);
  });

  test('stays small for large courses', () => {
    const seen = Array.from({ length: 200 }, (_, i) => i % 3 === 0);
    const encoded = encodeProgress({ chapterIndex: 199, time: 3_600_000, seen });
    expect(encoded.length).toBeLessThan(100);
    expect(decodeProgress(encoded, 200)?.seen).toEqual(seen);
  });

  test.each([null, '', 'garbage', '2~0~0~0', '1~zz~0~0', '1~0~0~xyz', '1~0~-1~0'])(
    'rejects invalid input %s',
    (value) => {
      expect(decodeProgress(value, 3)).toBeNull();
    },
  );

  test('tolerates added chapters', () => {
    const encoded = encodeProgress({ chapterIndex: 1, time: 0, seen: [true, true] });
    expect(decodeProgress(encoded, 4)?.seen).toEqual([true, true, false, false]);
  });
});
