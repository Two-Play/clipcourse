// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import { evaluate, isClipActive } from '../src/core/evaluate.js';
import { box, chapter, course } from './fixtures.js';

const ids = (c: ReturnType<typeof evaluate>) => c.clips.map((a) => a.clip.id);

describe('isClipActive', () => {
  test('uses half-open interval [start, end)', () => {
    const clip = box('a', 1000, 1000);
    expect(isClipActive(clip, 999, 5000)).toBe(false);
    expect(isClipActive(clip, 1000, 5000)).toBe(true);
    expect(isClipActive(clip, 1999, 5000)).toBe(true);
    expect(isClipActive(clip, 2000, 5000)).toBe(false);
  });

  test('holds the last frame at the chapter end', () => {
    expect(isClipActive(box('a', 4000, 1000), 5000, 5000)).toBe(true);
    expect(isClipActive(box('a', 4000, 3000), 5000, 5000)).toBe(true);
    expect(isClipActive(box('a', 3000, 1000), 5000, 5000)).toBe(false);
  });

  test('never shows clips that start after the chapter', () => {
    expect(isClipActive(box('a', 5000, 1000), 5000, 5000)).toBe(false);
  });
});

describe('evaluate', () => {
  const c = course([
    {
      ...chapter('one', 6000, []),
      tracks: [
        { id: 'bottom', clips: [box('b1', 0, 3000), box('b2', 3000, 3000)] },
        { id: 'top', clips: [box('t1', 1000, 1000)] },
        { id: 'hidden', hidden: true, clips: [box('h1', 0, 6000)] },
      ],
    },
  ]);

  test('returns active clips in stacking order', () => {
    expect(ids(evaluate(c, 0, 1500))).toEqual(['b1', 't1']);
    expect(ids(evaluate(c, 0, 3000))).toEqual(['b2']);
  });

  test('is deterministic regardless of evaluation history', () => {
    const direct = evaluate(c, 0, 2500);
    evaluate(c, 0, 100);
    evaluate(c, 0, 5900);
    expect(evaluate(c, 0, 2500)).toEqual(direct);
  });

  test('skips hidden tracks', () => {
    expect(ids(evaluate(c, 0, 0))).not.toContain('h1');
  });

  test('clamps and rounds time', () => {
    expect(evaluate(c, 0, -50).time).toBe(0);
    expect(evaluate(c, 0, 99999).time).toBe(6000);
    expect(evaluate(c, 0, 10.6).time).toBe(11);
    expect(evaluate(c, 0, Number.NaN).time).toBe(0);
  });

  test('computes local and media time', () => {
    const withMedia = course([
      {
        ...chapter('m', 10000, []),
        tracks: [
          {
            id: 'v',
            muted: true,
            clips: [
              {
                id: 'vid',
                type: 'video',
                assetId: 'x',
                trimStart: 2000,
                start: 1000,
                duration: 5000,
                frame: { x: 0, y: 0, width: 1, height: 1 },
              },
            ],
          },
        ],
      },
    ]);
    const [active] = evaluate(withMedia, 0, 3500).clips;
    expect(active).toMatchObject({ localTime: 2500, mediaTime: 4500, trackMuted: true });
  });

  test('places course layer behind and in front of chapter tracks', () => {
    const layered = course([chapter('one', 1000, [box('mid', 0, 1000)])], {
      courseLayer: {
        background: [{ id: 'bg', clips: [box('back', 0, 999999)] }],
        foreground: [{ id: 'fg', clips: [box('front', 0, 999999)] }],
      },
    });
    const scene = evaluate(layered, 0, 500);
    expect(ids(scene)).toEqual(['back', 'mid', 'front']);
    expect(scene.clips.map((a) => a.layer)).toEqual(['background', 'chapter', 'foreground']);
  });

  test('throws for unknown chapters', () => {
    expect(() => evaluate(c, 3, 0)).toThrow(RangeError);
  });
});
