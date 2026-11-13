// SPDX-License-Identifier: AGPL-3.0-only
import type { Course } from '@clipcourse/format';
import { describe, expect, test } from 'vitest';
import {
  clipLabel,
  displayTracks,
  formatTimecode,
  hitTest,
  msToPx,
  pointInFrame,
  pxToMs,
  resizeFrame,
} from '../src/geometry.js';

const course: Course = {
  formatVersion: 2,
  id: 'c',
  title: 'C',
  language: 'en',
  stage: { width: 1000, height: 500, background: '#000' },
  assets: { img: { kind: 'image', src: 'assets/photo.png' } },
  chapters: [
    {
      id: 'ch',
      title: 'Ch',
      duration: 5000,
      transition: { mode: 'wait' },
      tracks: [
        {
          id: 'back',
          clips: [
            {
              id: 'big',
              type: 'box',
              start: 0,
              duration: 5000,
              frame: { x: 0, y: 0, width: 1000, height: 500 },
            },
          ],
        },
        {
          id: 'front',
          clips: [
            {
              id: 'small',
              type: 'image',
              assetId: 'img',
              start: 1000,
              duration: 1000,
              frame: { x: 100, y: 100, width: 100, height: 100 },
            },
          ],
        },
      ],
    },
  ],
};

describe('geometry', () => {
  test('time and pixel conversion', () => {
    expect(msToPx(1500, 100)).toBe(150);
    expect(pxToMs(150, 100)).toBe(1500);
    expect(pxToMs(1, 3)).toBe(333);
  });

  test('tracks are displayed front-most first', () => {
    expect(displayTracks(course.chapters[0]!).map((t) => t.id)).toEqual(['front', 'back']);
  });

  test('labels and timecodes', () => {
    expect(clipLabel(course.chapters[0]!.tracks[1]!.clips[0]!, course)).toBe('Image: photo.png');
    expect(formatTimecode(61_250)).toBe('1:01.2');
  });

  test('hit test picks the topmost active clip', () => {
    expect(hitTest(course, 0, 1500, 150, 150)?.id).toBe('small');
    expect(hitTest(course, 0, 500, 150, 150)?.id).toBe('big');
    expect(hitTest(course, 0, 500, 2000, 150)).toBeNull();
  });

  test('point in rotated frame', () => {
    const frame = { x: 0, y: 0, width: 100, height: 10, rotation: 90 };
    expect(pointInFrame(frame, 50, 40)).toBe(true);
    expect(pointInFrame(frame, 5, 5)).toBe(false);
  });

  test('corner resize keeps a minimum size', () => {
    const f = { x: 10, y: 10, width: 100, height: 50 };
    expect(resizeFrame(f, 'se', 20, 10)).toEqual({ x: 10, y: 10, width: 120, height: 60 });
    expect(resizeFrame(f, 'nw', 20, 10)).toEqual({ x: 30, y: 20, width: 80, height: 40 });
    expect(resizeFrame(f, 'nw', 500, 500)).toEqual({ x: 100, y: 50, width: 10, height: 10 });
  });
});
