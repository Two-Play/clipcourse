// SPDX-License-Identifier: AGPL-3.0-only
import { produce } from 'immer';
import { describe, expect, test } from 'vitest';
import * as cmd from '../src/commands.js';
import { createClip, createEmptyCourse, uniqueIdFactory } from '../src/document.js';
import { boxClip, clipById, expectValid, testCourse, trackOf } from './helpers.js';

const run = (recipe: cmd.Recipe, course = testCourse()) => {
  const next = produce(course, recipe);
  expectValid(next);
  return next;
};

describe('clip commands', () => {
  test('moveClip within a track resolves overlaps', () => {
    const c = run(cmd.moveClip('a', 3500));
    expect(clipById(c, 'a').start).toBe(2000); // gap 2000–4000 is exactly 2000 long
    expect(run(cmd.moveClip('a', 4500)).chapters[0]!.tracks[0]!.clips.map((x) => x.id)).toEqual([
      'b',
      'a',
    ]);
  });

  test('moveClip to another track in the same chapter', () => {
    const c = run(cmd.moveClip('a', 7000, 't2'));
    expect(trackOf(c, 'a')).toBe('t2');
    expect(clipById(c, 'a').start).toBe(7000);
  });

  test('moveClip refuses to leave the chapter', () => {
    expect(() => produce(testCourse(), cmd.moveClip('a', 0, 't3'))).toThrow(/within a chapter/);
  });

  test('moving past the end grows the chapter', () => {
    const c = run(cmd.moveClip('b', 9500));
    expect(c.chapters[0]!.duration).toBe(11500);
  });

  test('resize end stops at the next clip and at the minimum', () => {
    expect(clipById(run(cmd.resizeClip('a', 'end', 9000)), 'a').duration).toBe(4000);
    expect(clipById(run(cmd.resizeClip('a', 'end', 0)), 'a').duration).toBe(cmd.MIN_CLIP_DURATION);
  });

  test('resize start keeps the end and stops at the previous clip', () => {
    const b = clipById(run(cmd.resizeClip('b', 'start', 500)), 'b');
    expect(b).toMatchObject({ start: 2000, duration: 4000 });
  });

  test('trimming a video head adjusts trimStart, never below 0', () => {
    const later = clipById(run(cmd.resizeClip('v', 'start', 2500)), 'v');
    expect(later).toMatchObject({ start: 2500, duration: 3500, trimStart: 1500 });
    const earlier = clipById(run(cmd.resizeClip('v', 'start', 0)), 'v');
    expect(earlier).toMatchObject({ start: 1000, duration: 5000 });
    expect('trimStart' in earlier).toBe(false);
  });

  test('splitClip creates two adjacent clips', () => {
    const c = run(cmd.splitClip('v', 3000, 'v2'));
    expect(clipById(c, 'v')).toMatchObject({ start: 1000, duration: 2000 });
    expect(clipById(c, 'v2')).toMatchObject({ start: 3000, duration: 3000, trimStart: 2000 });
  });

  test('splitClip ignores cuts too close to an edge', () => {
    const c = produce(testCourse(), cmd.splitClip('a', 50, 'x'));
    expect(c).toEqual(testCourse());
  });

  test('duplicateClip places the copy after the original', () => {
    const c = run(cmd.duplicateClip('a', 'a2'));
    expect(clipById(c, 'a2').start).toBe(2000);
  });

  test('addClip places at the nearest free position', () => {
    const c = run(cmd.addClip('t1', boxClip('n', 1500, 1000)));
    expect(clipById(c, 'n').start).toBe(2000);
  });

  test('updateClip rounds times and cannot change identity', () => {
    const c = run(cmd.updateClip('a', (clip) => void (clip.start = 12.4)));
    expect(clipById(c, 'a').start).toBe(12);
    expect(() =>
      produce(
        testCourse(),
        cmd.updateClip('a', (clip) => void (clip.id = 'zz')),
      ),
    ).toThrow();
  });

  test('removeClips', () => {
    const c = run(cmd.removeClips(['a', 'v']));
    expect(c.chapters[0]!.tracks.flatMap((t) => t.clips.map((x) => x.id))).toEqual(['b']);
  });
});

describe('track and chapter commands', () => {
  test('add, move, update and remove tracks', () => {
    let c = run(cmd.addTrack('ch1', { id: 'tn', name: 'New' }, 0));
    expect(c.chapters[0]!.tracks.map((t) => t.id)).toEqual(['tn', 't1', 't2']);
    c = run(cmd.moveTrack('tn', 5), c);
    expect(c.chapters[0]!.tracks.map((t) => t.id)).toEqual(['t1', 't2', 'tn']);
    c = run(cmd.updateTrack('tn', { hidden: true, muted: true, name: 'X' }), c);
    expect(c.chapters[0]!.tracks[2]).toMatchObject({ hidden: true, muted: true, name: 'X' });
    c = run(cmd.updateTrack('tn', { hidden: false }), c);
    expect('hidden' in c.chapters[0]!.tracks[2]!).toBe(false);
    c = run(cmd.removeTrack('tn'), c);
    expect(c.chapters[0]!.tracks).toHaveLength(2);
  });

  test('chapter props and fit to content', () => {
    let c = run(
      cmd.setChapterProps('ch1', {
        title: 'Intro',
        transition: { mode: 'auto' },
        background: '#123',
      }),
    );
    expect(c.chapters[0]).toMatchObject({
      title: 'Intro',
      transition: { mode: 'auto' },
      background: '#123',
    });
    c = run(cmd.setChapterProps('ch1', { background: null }), c);
    expect('background' in c.chapters[0]!).toBe(false);
    c = run(cmd.fitChapterToContent('ch1'), c);
    expect(c.chapters[0]!.duration).toBe(6000);
  });
});

describe('assets', () => {
  test('cannot remove an asset in use', () => {
    expect(() => produce(testCourse(), cmd.removeAsset('vid'))).toThrow(/used by v/);
    const c = run(cmd.removeAsset('img'));
    expect(c.assets.img).toBeUndefined();
  });

  test('addAsset refuses duplicates', () => {
    expect(() =>
      produce(testCourse(), cmd.addAsset('img', { kind: 'image', src: 'assets/x.png' })),
    ).toThrow();
  });
});

describe('factories', () => {
  test('empty course and default clips are valid', () => {
    const course = createEmptyCourse();
    expectValid(course);
    const newId = uniqueIdFactory(course);
    let next = course;
    const trackId = course.chapters[0]!.tracks[0]!.id;
    for (const type of ['text', 'box', 'shape'] as const) {
      next = run(
        cmd.addClip(trackId, createClip(next, type, { id: newId('clip'), start: 0 })),
        next,
      );
    }
    next = run(cmd.addAsset('pic', { kind: 'image', src: 'assets/p.png' }), next);
    next = run(
      cmd.addClip(
        trackId,
        createClip(next, 'image', { id: newId('clip'), start: 0, assetId: 'pic' }),
      ),
      next,
    );
    expect(next.chapters[0]!.tracks[0]!.clips.map((c) => c.start)).toEqual([0, 3000, 6000, 9000]);
  });

  test('uniqueIdFactory never repeats', () => {
    let n = 0;
    const newId = uniqueIdFactory(testCourse(), () => ['a', 'b', 'x1', 'x2'][n++]!);
    expect(newId('clip')).toBe('x1');
  });
});
