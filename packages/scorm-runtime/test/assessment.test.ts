// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import type { Course, Question } from '@clipcourse/format';
import { createManualClock } from '@clipcourse/player';
import { afterEach, describe, expect, test } from 'vitest';
import { connect, formatResponse } from '../src/connection.js';
import { runCourse, type RunningCourse } from '../src/course.js';
import { toInteraction } from '../src/interactions.js';
import {
  createLmsRecord,
  createMockLms,
  createMockScorm12,
  createMockScorm2004,
} from '../src/testing.js';

const frame = { x: 0, y: 0, width: 10, height: 10 };
const q1: Question = {
  id: 'q1',
  kind: 'single',
  prompt: 'One?',
  choices: [
    { id: 'yes', text: 'Yes' },
    { id: 'no', text: 'No' },
  ],
  correct: 'yes',
};
const q2: Question = {
  id: 'q2',
  kind: 'match',
  prompt: 'Match',
  pairs: [
    { id: 'p1', left: 'a', right: 'b' },
    { id: 'p2', left: 'c', right: 'd' },
  ],
};

const course: Course = {
  formatVersion: 3,
  id: 'c',
  title: 'C',
  language: 'en',
  stage: { width: 100, height: 100, background: '#000' },
  assets: {},
  assessment: { passingScore: 75 },
  chapters: [
    {
      id: 'a',
      title: 'A',
      duration: 1000,
      transition: { mode: 'auto' },
      tracks: [
        {
          id: 't',
          clips: [{ id: 'qc', type: 'question', start: 0, duration: 1000, frame, question: q1 }],
        },
      ],
    },
    {
      id: 'b',
      title: 'B',
      duration: 1000,
      transition: { mode: 'wait' },
      tracks: [],
      quiz: { questions: [q2] },
    },
  ],
};

let running: RunningCourse | null = null;
afterEach(() => {
  running?.destroy();
  running = null;
  document.body.innerHTML = '';
});

function launch(version: '1.2' | '2004', record = createLmsRecord()) {
  const lms = createMockLms(version, record);
  const host = document.createElement('div');
  document.body.append(host);
  running = runCourse(host, course, {
    scormVersion: version,
    api: { version, api: lms.api } as never,
    player: { clock: createManualClock() },
  });
  return lms;
}

describe.each(['1.2', '2004'] as const)('SCORM %s assessment', (version) => {
  test('passing: score, interactions and passed status', () => {
    const lms = launch(version);
    const p = running!.player;
    p.answer('q1', { kind: 'single', choice: 'yes' });
    p.play();
    p.goToChapter(1);
    p.answer('q2', { kind: 'match', pairs: { p1: 'p1', p2: 'p2' } });
    // finish quiz via the controller path the UI uses
    (p.element.querySelector('.ccp-q-continue') as HTMLButtonElement | null)?.click();
    const data = lms.record.data;
    const score = version === '1.2' ? 'cmi.core.score.raw' : 'cmi.score.raw';
    expect(data[score]).toBe('100');
    if (version === '2004') {
      expect(data['cmi.score.scaled']).toBe('1');
      expect(data['cmi.success_status']).toBe('passed');
    }
    expect(lms.values['cmi.interactions.0.id']).toBe('q1');
    expect(lms.values['cmi.interactions.0.type']).toBe('choice');
    expect(lms.values['cmi.interactions.0.result']).toBe('correct');
    expect(lms.values['cmi.interactions.1.type']).toBe('matching');
    if (version === '1.2') {
      expect(lms.values['cmi.interactions.0.student_response']).toBe('a');
      expect(lms.values['cmi.interactions.1.student_response']).toBe('a.a,b.b');
    } else {
      expect(lms.values['cmi.interactions.0.learner_response']).toBe('yes');
      expect(lms.values['cmi.interactions.1.learner_response']).toBe('p1[.]p1[,]p2[.]p2');
    }
    // Chapter A was skipped by jumping, so the course is not complete yet.
    expect(data[version === '1.2' ? 'cmi.core.lesson_status' : 'cmi.completion_status']).toBe(
      'incomplete',
    );
  });

  test('failing is reported once all scored questions are answered', () => {
    const lms = launch(version);
    running!.player.answer('q1', { kind: 'single', choice: 'no' });
    running!.player.goToChapter(1);
    running!.player.answer('q2', { kind: 'match', pairs: { p1: 'p1', p2: 'p2' } });
    const score = version === '1.2' ? 'cmi.core.score.raw' : 'cmi.score.raw';
    expect(lms.record.data[score]).toBe('50');
    if (version === '2004') expect(lms.record.data['cmi.success_status']).toBe('failed');
    expect(lms.values['cmi.interactions.0.result']).toBe(version === '1.2' ? 'wrong' : 'incorrect');
  });
});

test('SCORM 1.2: completing the course with an assessment reports passed/failed', () => {
  const record = createLmsRecord();
  const lms = createMockScorm12(record);
  const conn = connect({ version: '1.2', api: lms.api })!;
  conn.setScore({ earned: 3, possible: 4 });
  conn.setSuccess(true);
  conn.setCompleted();
  expect(lms.values['cmi.core.lesson_status']).toBe('passed');
  const lms2 = createMockScorm12(createLmsRecord());
  const conn2 = connect({ version: '1.2', api: lms2.api })!;
  conn2.setCompleted(false);
  expect(lms2.values['cmi.core.lesson_status']).toBe('failed');
  const lms3 = createMockScorm2004();
  const conn3 = connect({ version: '2004', api: lms3.api })!;
  conn3.setCompleted(true);
  expect(lms3.values).toMatchObject({
    'cmi.completion_status': 'completed',
    'cmi.success_status': 'passed',
  });
  expect(conn.diagnostics).toEqual([]);
});

test('the mock LMS enforces SCORM 1.2 single-character choice responses', () => {
  const lms = createMockScorm12();
  lms.api.LMSInitialize('');
  lms.api.LMSSetValue('cmi.interactions.0.id', 'x');
  lms.api.LMSSetValue('cmi.interactions.0.type', 'choice');
  expect(lms.api.LMSSetValue('cmi.interactions.0.student_response', 'longid')).toBe('false');
  expect(lms.api.LMSSetValue('cmi.interactions.0.student_response', 'a,c')).toBe('true');
});

test('toInteraction covers every question kind', () => {
  const kinds: Question[] = [
    q1,
    {
      id: 'm',
      kind: 'multiple',
      prompt: 'p',
      choices: [
        { id: 'a', text: 'a' },
        { id: 'b', text: 'b' },
      ],
      correct: ['a'],
    },
    { id: 't', kind: 'text', prompt: 'p', answers: ['x'] },
    {
      id: 'o',
      kind: 'order',
      prompt: 'p',
      items: [
        { id: 'i', text: 'i' },
        { id: 'j', text: 'j' },
      ],
    },
    q2,
    {
      id: 'h',
      kind: 'hotspot',
      prompt: 'p',
      assetId: 'img',
      areas: [{ id: 'z', label: 'z', x: 0, y: 0, width: 1, height: 1 }],
      correct: ['z'],
    },
  ];
  const types = kinds.map(
    (q) => toInteraction(q, { kind: 'text', text: 'x' } as never, false).type,
  );
  expect(types).toEqual(['choice', 'choice', 'fill-in', 'sequencing', 'matching', 'other']);
  expect(formatResponse('1.2', 'sequencing', ['j', 'i'], ['i', 'j'])).toBe('b,a');
  expect(formatResponse('2004', 'sequencing', ['j', 'i'])).toBe('j[,]i');
});
