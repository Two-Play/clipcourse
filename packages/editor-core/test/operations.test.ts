// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import { createEmptyCourse, findClip } from '../src/document.js';
import { describeTimeline } from '../src/describe.js';
import {
  executeOperation,
  OperationError,
  patchClip,
  SOURCES_EXTENSION,
  type Operation,
} from '../src/operations.js';
import { contrastRatio, parseColor, readingTime, reviewCourse } from '../src/review.js';
import { createEditorStore } from '../src/store.js';
import { expectValid, testCourse } from './helpers.js';

function setup(course = testCourse()) {
  const store = createEditorStore(course);
  const files = new Map<string, Uint8Array>();
  const run = (op: Operation) => executeOperation({ store, files }, op);
  return { store, files, run, course: () => store.getState().course };
}

describe('executeOperation', () => {
  test('add_clip with props, then update, move, trim — each one undo step', () => {
    const { run, course, store } = setup();
    const result = run({
      op: 'add_clip',
      type: 'text',
      chapterId: 'ch1',
      start: 7000,
      duration: 2000,
      props: {
        text: 'Hi',
        style: { fontSize: 72 },
        animations: { in: { type: 'fade', duration: 400 } },
      },
    });
    const clipId = result.created!.clipId!;
    let clip = findClip(course(), clipId)!.clip;
    expect(clip).toMatchObject({ type: 'text', text: 'Hi', start: 7000, duration: 2000 });
    expect(clip.type === 'text' && clip.style).toMatchObject({ fontSize: 72, color: '#ffffff' });

    run({
      op: 'update_clip',
      clipId,
      props: {
        text: 'Hello',
        style: { color: '#ffd166', fontSize: null },
        start: 8000,
        duration: 1500,
      },
    });
    clip = findClip(course(), clipId)!.clip;
    expect(clip).toMatchObject({ text: 'Hello', start: 8000, duration: 1500 });
    expect(clip.type === 'text' && clip.style).toEqual({
      color: '#ffd166',
      align: 'center',
      verticalAlign: 'middle',
    });

    run({ op: 'trim_clip', clipId, edge: 'end', time: 9000 });
    expect(findClip(course(), clipId)!.clip.duration).toBe(1000);
    expect(store.getState().past).toHaveLength(3);
    run({ op: 'undo' });
    run({ op: 'undo' });
    expect(findClip(course(), clipId)!.clip).toMatchObject({ text: 'Hi', start: 7000 });
    expectValid(course());
  });

  test('add_clip creates a track when no track has room', () => {
    const { run, course } = setup();
    const result = run({ op: 'add_clip', type: 'box', chapterId: 'ch1', start: 0 });
    expect(result.created!.trackId).toBeDefined();
    expect(course().chapters[0]!.tracks).toHaveLength(3);
  });

  test('invalid changes are rolled back with a readable error', () => {
    const { run, course, store } = setup();
    const before = course();
    expect(() => run({ op: 'update_clip', clipId: 'a', props: { fill: 'url(evil)' } })).toThrow(
      /invalid.*fill/i,
    );
    expect(course()).toBe(before);
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().future).toHaveLength(0);
    expect(() => run({ op: 'update_clip', clipId: 'a', props: { type: 'text' } })).toThrow(
      OperationError,
    );
    expect(() => run({ op: 'update_clip', clipId: 'nope', props: {} })).toThrow(/Unknown clip/);
    expect(() =>
      run({ op: 'add_clip', type: 'image', chapterId: 'ch1', assetId: 'missing' }),
    ).toThrow(/Unknown asset/);
  });

  test('chapter operations, templates and markers', () => {
    const { run, course } = setup();
    const { created } = run({
      op: 'add_chapter',
      title: 'Intro',
      template: 'title and bullet points',
      index: 0,
      transition: 'auto',
    });
    expect(course().chapters[0]).toMatchObject({
      id: created!.chapterId,
      title: 'Intro',
      transition: { mode: 'auto' },
    });
    expect(course().chapters[0]!.tracks).toHaveLength(4);
    expect(() => run({ op: 'add_chapter', template: 'nope' })).toThrow(/Available: Blank chapter/);
    run({ op: 'add_marker', chapterId: 'ch1', time: 1000, title: 'Part' });
    expect(course().chapters[1]!.markers).toHaveLength(1);
    run({ op: 'move_chapter', chapterId: 'ch1', index: 0 });
    expect(course().chapters[0]!.id).toBe('ch1');
    expect(run({ op: 'update_chapter', chapterId: 'ch1', title: 'One' }).changed).toBe(false);
  });

  test('requires chapterId when there are several chapters', () => {
    const { run } = setup();
    expect(() => run({ op: 'add_track' })).toThrow(/chapterId is required/);
    expect(
      run({ op: 'add_track', layer: 'foreground', name: 'Logo' }).created!.trackId,
    ).toBeDefined();
  });

  test('add_asset stores the file and the source URL', () => {
    const { run, course, files } = setup(createEmptyCourse());
    const { created } = run({
      op: 'add_asset',
      fileName: 'Photo.PNG',
      data: new Uint8Array([1]),
      alt: 'A cat',
      sourceUrl: 'https://example.com/cat.png',
    });
    expect(course().assets[created!.assetId!]).toMatchObject({
      kind: 'image',
      alt: 'A cat',
      src: 'assets/photo.png',
    });
    expect(files.get('assets/photo.png')).toEqual(new Uint8Array([1]));
    expect(course().extensions?.[SOURCES_EXTENSION]).toEqual({
      photo: 'https://example.com/cat.png',
    });
    expect(() => run({ op: 'add_asset', fileName: 'x.exe', data: new Uint8Array() })).toThrow(
      /Unsupported/,
    );
  });

  test('patchClip merges nested objects and deletes with null', () => {
    const clip = {
      id: 'x',
      type: 'box',
      start: 0,
      duration: 1,
      frame: { x: 1, y: 2, width: 3, height: 4 },
      fill: '#000',
    };
    patchClip(clip as never, { frame: { x: 9 }, fill: null });
    expect(clip).toEqual({
      id: 'x',
      type: 'box',
      start: 0,
      duration: 1,
      frame: { x: 9, y: 2, width: 3, height: 4 },
    });
  });
});

describe('reviewCourse', () => {
  test('finds accessibility and quality problems', () => {
    const { run, course } = setup(createEmptyCourse());
    const chapterId = course().chapters[0]!.id;
    run({ op: 'add_asset', fileName: 'p.png', data: new Uint8Array([1]) });
    run({ op: 'add_asset', fileName: 'v.mp4', data: new Uint8Array([1]) });
    run({ op: 'add_clip', type: 'image', chapterId, assetId: 'p', start: 0 });
    run({ op: 'add_clip', type: 'video', chapterId, assetId: 'v', start: 3000 });
    run({
      op: 'add_clip',
      type: 'text',
      chapterId,
      start: 6000,
      duration: 1000,
      props: {
        text: 'A long sentence that takes a while to read for most people',
        style: { fontSize: 20, color: '#222222' },
      },
    });
    run({ op: 'add_chapter', title: 'Empty' });
    const codes = reviewCourse(course())
      .map((i) => i.code)
      .sort();
    expect(codes).toEqual([
      'empty-chapter',
      'low-contrast',
      'missing-alt',
      'missing-captions',
      'short-text',
      'small-text',
    ]);
  });

  test('a clean course has no issues', () => {
    const { run, course } = setup(createEmptyCourse());
    run({ op: 'add_clip', type: 'text', start: 0, duration: 5000, props: { text: 'Welcome' } });
    expect(reviewCourse(course())).toEqual([]);
  });

  test('contrast and colors', () => {
    expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBeCloseTo(21);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgba(0,0,0,0.5)')).toBeNull();
    expect(parseColor('hsl(0, 0%, 0%)')).toBeNull();
    expect(readingTime('one two three four five')).toBe(3000);
  });
});

test('describeTimeline lists chapters, tracks and clips', () => {
  const text = describeTimeline(testCourse());
  expect(text).toContain('Chapter 1 "One" {ch1}, 10.0s, at the end: wait for Continue');
  expect(text).toContain('0.0s–2.0s box {a}');
  expect(text).toContain('video vid (assets/v.mp4)');
  expect(describeTimeline(testCourse(), 'ch2')).not.toContain('{ch1}');
});
