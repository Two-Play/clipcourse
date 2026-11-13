// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import type { Course } from '@clipcourse/format';
import { createManualClock } from '@clipcourse/player';
import { afterEach, expect, test } from 'vitest';
import { runCourse, type RunningCourse } from '../src/course.js';
import { createLmsRecord, createMockScorm12, createMockScorm2004 } from '../src/testing.js';

const frame = { x: 0, y: 0, width: 10, height: 10 };
const course: Course = {
  formatVersion: 3,
  id: 'c',
  title: 'C',
  language: 'en',
  stage: { width: 100, height: 100, background: '#000' },
  assets: {},
  chapters: ['a', 'b'].map((id) => ({
    id,
    title: id.toUpperCase(),
    duration: 1000,
    transition: { mode: 'auto' as const },
    tracks: [
      {
        id: `${id}_t`,
        clips: [{ id: `${id}_c`, type: 'box' as const, start: 0, duration: 1000, frame }],
      },
    ],
  })),
};

let running: RunningCourse | null = null;
afterEach(() => {
  running?.player.destroy();
  running = null;
  document.body.innerHTML = '';
});

function launch(api: Record<string, unknown>, version: '1.2' | '2004') {
  const host = document.createElement('div');
  document.body.append(host);
  const fakeWindow = Object.assign(window, api);
  const clock = createManualClock();
  running = runCourse(host, course, {
    scormVersion: version,
    window: fakeWindow,
    player: { clock },
  });
  return clock;
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).API;
  delete (window as unknown as Record<string, unknown>).API_1484_11;
});

test('SCORM 1.2: plays through, completes, and resumes the bookmark', () => {
  const record = createLmsRecord();
  const lms = createMockScorm12(record);
  const clock = launch({ API: lms.api }, '1.2');
  running!.player.play();
  for (let i = 0; i < 6; i++) clock.step(250); // chapter a done, b started
  running!.player.pause();
  running!.finish();
  expect(record.data['cmi.core.lesson_status']).toBe('incomplete');
  expect(record.data['cmi.core.lesson_location']).toBe('b');
  expect(record.data['cmi.core.exit']).toBe('suspend');
  running!.player.destroy();

  const lms2 = createMockScorm12(record);
  const clock2 = launch({ API: lms2.api }, '1.2');
  expect(running!.player.getState()).toMatchObject({ chapterIndex: 1, seen: [true, false] });
  running!.player.play();
  for (let i = 0; i < 6; i++) clock2.step(250);
  expect(lms2.values['cmi.core.lesson_status']).toBe('completed');
  // Completion is committed immediately, not only at the end of the session.
  expect(record.data['cmi.core.lesson_status']).toBe('completed');
});

test('SCORM 2004: reports progress_measure per seen chapter', () => {
  const lms = createMockScorm2004();
  const clock = launch({ API_1484_11: lms.api }, '2004');
  running!.player.play();
  for (let i = 0; i < 5; i++) clock.step(250);
  expect(lms.record.data['cmi.progress_measure']).toBe('0.5');
  for (let i = 0; i < 5; i++) clock.step(250);
  expect(lms.record.data['cmi.completion_status']).toBe('completed');
  expect(lms.record.data['cmi.progress_measure']).toBe('1');
});

test('the version declared by the package is respected', () => {
  const lms = createMockScorm12();
  launch({ API: lms.api }, '2004');
  expect(running!.lms).toBeNull();
});

test('without an LMS, progress goes to localStorage', () => {
  launch({}, '1.2');
  expect(running!.lms).toBeNull();
  running!.player.seek(500);
  running!.player.saveProgress();
  expect(localStorage.getItem('clipcourse:c')).toMatch(/^1~/);
});
