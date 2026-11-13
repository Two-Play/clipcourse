// SPDX-License-Identifier: AGPL-3.0-only
import type { Track } from '@clipcourse/format';
import { describe, expect, test } from 'vitest';
import { fits, freeGaps, nearestFreeStart, resizeLimits } from '../src/placement.js';
import { gridStep, snapBlock, snapPoints, snapTime } from '../src/snap.js';
import { boxClip, testCourse } from './helpers.js';

const track: Track = { id: 't', clips: [boxClip('a', 1000, 1000), boxClip('b', 3000, 1000)] };

describe('placement', () => {
  test('free gaps', () => {
    expect(freeGaps(track)).toEqual([
      { start: 0, end: 1000 },
      { start: 2000, end: 3000 },
      { start: 4000, end: Infinity },
    ]);
  });

  test('fits', () => {
    expect(fits(track, 2000, 1000)).toBe(true);
    expect(fits(track, 1500, 1000)).toBe(false);
    expect(fits(track, -1, 10)).toBe(false);
    expect(fits(track, 1500, 1000, new Set(['a']))).toBe(true);
  });

  test('nearest free start snaps into or next to gaps', () => {
    expect(nearestFreeStart(track, 2200, 500)).toBe(2200);
    expect(nearestFreeStart(track, 2700, 500)).toBe(2500);
    expect(nearestFreeStart(track, 2400, 1500)).toBe(4000);
    expect(nearestFreeStart(track, 1200, 1000)).toBe(2000);
    expect(nearestFreeStart(track, 600, 1000)).toBe(0);
    expect(nearestFreeStart(track, -500, 100)).toBe(0);
  });

  test('resize limits stop at neighbours', () => {
    expect(resizeLimits(track, track.clips[1]!, 100)).toEqual({ minStart: 2000, maxEnd: Infinity });
    expect(resizeLimits(track, track.clips[0]!, 100)).toEqual({ minStart: 0, maxEnd: 3000 });
  });
});

describe('snap', () => {
  const chapter = testCourse().chapters[0]!;

  test('collects edges, playhead, chapter bounds', () => {
    expect(snapPoints(chapter, 7500)).toEqual([0, 1000, 2000, 4000, 6000, 7500, 10000]);
    expect(snapPoints(chapter, null, new Set(['a', 'v']))).toEqual([0, 4000, 6000, 10000]);
  });

  test('snaps within threshold only', () => {
    expect(snapTime(1950, [0, 2000], 100)).toEqual({ time: 2000, target: 2000 });
    expect(snapTime(1850, [0, 2000], 100)).toEqual({ time: 1850, target: null });
  });

  test('snaps a block by its closer edge', () => {
    expect(snapBlock(1030, 1000, [1000, 2000], 100).time).toBe(1000);
    expect(snapBlock(970, 1000, [2000], 100)).toEqual({ time: 1000, target: 2000 });
    expect(snapBlock(500, 100, [2000], 100).target).toBeNull();
  });

  test('grid step grows when zoomed out', () => {
    expect(gridStep(400)).toBe(250);
    expect(gridStep(100)).toBe(1000);
    expect(gridStep(10)).toBe(10000);
  });
});
