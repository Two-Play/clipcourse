// SPDX-License-Identifier: MIT
import { describe, expect, test, vi } from 'vitest';
import { Controller, type ControllerEvent } from '../src/core/controller.js';
import { box, chapter, course } from './fixtures.js';

const threeChapters = () =>
  course([
    chapter('a', 1000, [box('a1', 0, 1000)]),
    chapter('b', 2000, [box('b1', 0, 2000)], 'auto'),
    chapter('c', 1000, [box('c1', 0, 1000)]),
  ]);

function collect(controller: Controller) {
  const events: ControllerEvent[] = [];
  controller.subscribe((_, e) => events.push(...e));
  return events;
}

describe('Controller', () => {
  test('starts paused at the beginning', () => {
    const c = new Controller(threeChapters());
    expect(c.state).toMatchObject({ chapterIndex: 0, time: 0, status: 'paused', complete: false });
  });

  test('advances only while playing', () => {
    const c = new Controller(threeChapters());
    c.advance(500);
    expect(c.state.time).toBe(0);
    c.play();
    c.advance(500);
    expect(c.state.time).toBe(500);
  });

  test('waits at the end of a "wait" chapter and marks it seen', () => {
    const c = new Controller(threeChapters());
    const events = collect(c);
    c.play();
    c.advance(5000);
    expect(c.state).toMatchObject({ chapterIndex: 0, time: 1000, status: 'waiting' });
    expect(c.state.seen).toEqual([true, false, false]);
    expect(events).toContainEqual({ type: 'chapterseen', chapterIndex: 0 });
  });

  test('play() while waiting continues with the next chapter', () => {
    const c = new Controller(threeChapters());
    c.play();
    c.advance(1000);
    c.play();
    expect(c.state).toMatchObject({ chapterIndex: 1, time: 0, status: 'playing' });
  });

  test('"auto" chapters continue by themselves, overflow is discarded', () => {
    const c = new Controller(threeChapters());
    c.goToChapter(1);
    c.play();
    c.advance(2500);
    expect(c.state).toMatchObject({ chapterIndex: 2, time: 0, status: 'playing' });
  });

  test('completes when all chapters are seen, and only once', () => {
    const c = new Controller(threeChapters());
    const events = collect(c);
    c.play();
    c.advance(1000);
    c.play();
    c.advance(2000);
    c.advance(1000);
    expect(c.state).toMatchObject({ chapterIndex: 2, status: 'ended', complete: true });
    c.play();
    c.advance(1000);
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(1);
  });

  test('seeking does not mark chapters seen', () => {
    const c = new Controller(threeChapters());
    c.seek(1000);
    expect(c.state.seen[0]).toBe(false);
    expect(c.state.status).toBe('paused');
  });

  test('play() at the end of a chapter restarts it', () => {
    const c = new Controller(threeChapters());
    c.seek(1000);
    c.play();
    expect(c.state.time).toBe(0);
  });

  test('seek clamps and leaves waiting state', () => {
    const c = new Controller(threeChapters());
    c.play();
    c.advance(1000);
    c.seek(-10);
    expect(c.state).toMatchObject({ time: 0, status: 'paused' });
  });

  test('chapter jumps keep playing state and emit chapterchange', () => {
    const c = new Controller(threeChapters());
    const events = collect(c);
    c.play();
    c.next();
    expect(c.state).toMatchObject({ chapterIndex: 1, time: 0, status: 'playing' });
    expect(events).toContainEqual({ type: 'chapterchange', chapterIndex: 1, previousIndex: 0 });
    c.pause();
    c.previous();
    expect(c.state).toMatchObject({ chapterIndex: 0, status: 'paused' });
    c.previous();
    expect(c.state.chapterIndex).toBe(0);
  });

  test('restores progress', () => {
    const c = new Controller(threeChapters(), { chapterIndex: 1, time: 99999, seen: [true] });
    expect(c.state).toMatchObject({ chapterIndex: 1, time: 2000, seen: [true, false, false] });
  });

  test('same sequence of inputs gives the same state (determinism)', () => {
    const run = () => {
      const c = new Controller(threeChapters());
      c.play();
      for (let i = 0; i < 90; i++) c.advance(16.7);
      c.seek(400);
      c.advance(100);
      return c.state;
    };
    expect(run()).toEqual(run());
  });

  test('notifies listeners and supports unsubscribe', () => {
    const c = new Controller(threeChapters());
    const listener = vi.fn();
    const off = c.subscribe(listener);
    c.play();
    off();
    c.pause();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
