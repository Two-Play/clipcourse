// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import * as cmd from '../src/commands.js';
import { createEditorStore, selectCanRedo, selectCanUndo, selectDirty } from '../src/store.js';
import { clipById, expectValid, testCourse } from './helpers.js';

describe('history', () => {
  test('execute, undo, redo', () => {
    const store = createEditorStore(testCourse());
    const original = store.getState().course;
    store.getState().execute('Move', cmd.moveClip('a', 7000));
    expect(clipById(store.getState().course, 'a').start).toBe(7000);
    store.getState().undo();
    expect(store.getState().course).toEqual(original);
    expect(selectCanRedo(store.getState())).toBe(true);
    store.getState().redo();
    expect(clipById(store.getState().course, 'a').start).toBe(7000);
  });

  test('no-op commands do not create history', () => {
    const store = createEditorStore(testCourse());
    expect(store.getState().execute('Nothing', cmd.moveClip('a', 0))).toBe(false);
    expect(selectCanUndo(store.getState())).toBe(false);
  });

  test('new command clears redo', () => {
    const store = createEditorStore(testCourse());
    store.getState().execute('1', cmd.moveClip('a', 7000));
    store.getState().undo();
    store.getState().execute('2', cmd.moveClip('b', 8000));
    expect(store.getState().future).toHaveLength(0);
  });

  test('merges consecutive edits with the same key (typing)', () => {
    let now = 0;
    const store = createEditorStore(testCourse(), () => now);
    for (const text of ['H', 'He', 'Hel']) {
      now += 200;
      store.getState().execute('Text', cmd.updateClip('a', (c) => c.type === 'box' && (c.text = text)), { mergeKey: 'text:a' });
    }
    expect(store.getState().past).toHaveLength(1);
    now += 5000;
    store.getState().execute('Text', cmd.updateClip('a', (c) => c.type === 'box' && (c.text = 'Hello')), { mergeKey: 'text:a' });
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    store.getState().undo();
    expect(clipById(store.getState().course, 'a')).not.toHaveProperty('text');
  });

  test('restores selection with undo and drops deleted clips from it', () => {
    const store = createEditorStore(testCourse());
    store.getState().select(['a', 'b']);
    store.getState().execute('Delete', cmd.removeClips(['a']));
    expect(store.getState().selection).toEqual(['b']);
    store.getState().undo();
    expect(store.getState().selection).toEqual(['a', 'b']);
  });

  test('history limit', () => {
    const store = createEditorStore(testCourse());
    for (let i = 0; i < 320; i++) store.getState().execute('m', cmd.moveClip('b', 4000 + (i % 2 ? 0 : 100)));
    expect(store.getState().past.length).toBe(300);
  });
});

describe('transactions', () => {
  test('many previews become one undo step', () => {
    const store = createEditorStore(testCourse());
    const s = store.getState;
    s().begin('Drag');
    for (const t of [6100, 6500, 7000]) s().preview(cmd.moveClip('a', t));
    expect(clipById(s().course, 'a').start).toBe(7000);
    expect(selectCanUndo(s())).toBe(false);
    s().commit();
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(clipById(s().course, 'a').start).toBe(0);
  });

  test('cancel restores the start state', () => {
    const store = createEditorStore(testCourse());
    const s = store.getState;
    const before = s().course;
    s().begin('Drag');
    s().preview(cmd.moveClip('a', 7000));
    s().cancel();
    expect(s().course).toBe(before);
    expect(s().past).toHaveLength(0);
  });

  test('commit without change adds nothing', () => {
    const store = createEditorStore(testCourse());
    store.getState().begin('Click');
    store.getState().commit();
    expect(store.getState().past).toHaveLength(0);
  });
});

describe('view state', () => {
  test('playhead is clamped to the chapter, chapter switch resets view', () => {
    const store = createEditorStore(testCourse());
    store.getState().setPlayhead(99999);
    expect(store.getState().playhead).toBe(10000);
    store.getState().select(['a']);
    store.getState().setChapter('ch2');
    expect(store.getState()).toMatchObject({ chapterId: 'ch2', playhead: 0, selection: [] });
    expect(() => store.getState().setChapter('nope')).toThrow();
  });

  test('dirty tracking', () => {
    const store = createEditorStore(testCourse());
    expect(selectDirty(store.getState())).toBe(false);
    store.getState().execute('m', cmd.moveClip('a', 7000));
    expect(selectDirty(store.getState())).toBe(true);
    store.getState().markSaved();
    expect(selectDirty(store.getState())).toBe(false);
  });

  test('zoom is clamped', () => {
    const store = createEditorStore(testCourse());
    store.getState().setZoom(1e9);
    expect(store.getState().zoom).toBe(1000);
  });
});

test('random edit sequences stay valid and fully undo (fuzz)', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const store = createEditorStore(testCourse());
  const s = store.getState;
  const original = s().course;
  const ids = ['a', 'b', 'v'];
  for (let i = 0; i < 300; i++) {
    const id = ids[Math.floor(rand() * ids.length)]!;
    const t = Math.floor(rand() * 15000);
    const op = Math.floor(rand() * 4);
    if (op === 0) s().execute('move', cmd.moveClip(id, t));
    else if (op === 1) s().execute('resize', cmd.resizeClip(id, rand() < 0.5 ? 'start' : 'end', t));
    else if (op === 2) s().execute('move track', cmd.moveClip(id, t, rand() < 0.5 ? 't1' : 't2'));
    else s().execute('split', cmd.splitClip(id, t, `s${i}`));
    expectValid(s().course);
    for (const track of s().course.chapters[0]!.tracks) {
      const sorted = [...track.clips].sort((x, y) => x.start - y.start);
      for (let k = 1; k < sorted.length; k++) {
        expect(sorted[k]!.start).toBeGreaterThanOrEqual(sorted[k - 1]!.start + sorted[k - 1]!.duration);
      }
    }
  }
  while (s().past.length > 0) s().undo();
  expect(s().course).toEqual(original);
});
