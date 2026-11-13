// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import type { Course } from '@clipcourse/format';
import { createManualClock } from '@clipcourse/player';
import { afterEach, expect, test } from 'vitest';
import { runCourse, type RunningCourse } from '../src/course.js';
import { createMockScorm12, createMockScorm2004 } from '../src/testing.js';

const frame = { x: 0, y: 0, width: 10, height: 10 };
const chapter = (
  id: string,
  extra: object = {},
  clips: Course['chapters'][0]['tracks'][0]['clips'] = [],
) => ({
  id,
  title: id,
  duration: 1000,
  transition: { mode: 'wait' as const },
  tracks: [{ id: `${id}_t`, clips }],
  ...extra,
});

const branching = (mode: 'required' | 'goal'): Course => ({
  formatVersion: 4,
  id: 'b',
  title: 'Branching',
  language: 'en',
  stage: { width: 100, height: 100, background: '#000' },
  assets: {},
  completion: { mode },
  chapters: [
    chapter('intro', {}, [
      {
        id: 'skip',
        type: 'button',
        text: 'Skip to the end',
        start: 0,
        duration: 1000,
        frame,
        action: { type: 'goToChapter', chapterId: 'end' },
      },
      {
        id: 'reveal',
        type: 'button',
        text: 'Show',
        start: 0,
        duration: 1000,
        frame,
        action: { type: 'setClipVisibility', clipId: 'secret', visible: 'show' },
      },
      { id: 'secret', type: 'box', start: 0, duration: 1000, frame, startsHidden: true },
    ]),
    chapter('extra', { optional: true }),
    chapter('end', { goal: true }),
  ],
});

let running: RunningCourse | null = null;
afterEach(() => {
  running?.destroy();
  running = null;
  document.body.innerHTML = '';
  delete (window as unknown as Record<string, unknown>).API;
  delete (window as unknown as Record<string, unknown>).API_1484_11;
});

function launch(course: Course, api: Record<string, unknown>, version: '1.2' | '2004') {
  const host = document.createElement('div');
  document.body.append(host);
  const clock = createManualClock();
  running = runCourse(host, course, {
    scormVersion: version,
    window: Object.assign(window, api),
    player: { clock },
  });
  return { host, clock };
}

const click = (host: HTMLElement, clipId: string) =>
  host.querySelector<HTMLButtonElement>(`[data-clip-id="${clipId}"] button`)!.click();

test('goal rule: jumping to the goal chapter and finishing it completes the course', () => {
  const lms = createMockScorm2004();
  const { host, clock } = launch(branching('goal'), { API_1484_11: lms.api }, '2004');
  click(host, 'reveal');
  click(host, 'skip');
  for (let i = 0; i < 5; i++) clock.step(250);
  expect(lms.record.data['cmi.completion_status']).toBe('completed');
  expect(lms.record.data['cmi.progress_measure']).toBe('1');
  // The revealed clip is part of the bookmark (format 3).
  expect(lms.record.data['cmi.suspend_data']).toMatch(/^3~2~/);
});

test('required rule: optional chapters are not needed and do not count for progress', () => {
  const lms = createMockScorm2004();
  const { clock } = launch(branching('required'), { API_1484_11: lms.api }, '2004');
  running!.player.play();
  for (let i = 0; i < 5; i++) clock.step(250); // intro seen
  expect(lms.record.data['cmi.progress_measure']).toBe('0.5');
  running!.player.goToChapter(2);
  running!.player.play();
  for (let i = 0; i < 5; i++) clock.step(250); // end seen, extra skipped
  expect(lms.record.data['cmi.completion_status']).toBe('completed');
});

test('SCORM 1.2 resumes a revealed clip', () => {
  const lms = createMockScorm12();
  let { host } = launch(branching('required'), { API: lms.api }, '1.2');
  click(host, 'reveal');
  running!.destroy();
  const again = createMockScorm12(lms.record);
  ({ host } = launch(branching('required'), { API: again.api }, '1.2'));
  expect(host.querySelector<HTMLElement>('[data-clip-id="secret"]')!.style.display).toBe('');
});
