// SPDX-License-Identifier: MIT
import type { Course, Question } from '@clipcourse/format';
import { describe, expect, test } from 'vitest';
import { Controller } from '../src/core/controller.js';
import { decodeProgress, encodeProgress } from '../src/core/progress.js';
import { answer, collectQuestions, computeScore, isCorrect, shuffled } from '../src/core/quiz.js';
import { box, chapter, course } from './fixtures.js';

const single: Question = {
  id: 'q1',
  kind: 'single',
  prompt: '?',
  choices: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
  correct: 'b',
};
const multiple: Question = {
  id: 'q2',
  kind: 'multiple',
  prompt: '?',
  choices: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
    { id: 'c', text: 'C' },
  ],
  correct: ['a', 'c'],
};
const text: Question = { id: 'q3', kind: 'text', prompt: '?', answers: ['New  York', 'NYC'] };
const order: Question = {
  id: 'q4',
  kind: 'order',
  prompt: '?',
  items: [
    { id: '1', text: '1' },
    { id: '2', text: '2' },
    { id: '3', text: '3' },
  ],
};
const match: Question = {
  id: 'q5',
  kind: 'match',
  prompt: '?',
  pairs: [
    { id: 'p', left: 'a', right: 'b' },
    { id: 'r', left: 'c', right: 'd' },
  ],
};
const hotspot: Question = {
  id: 'q6',
  kind: 'hotspot',
  prompt: '?',
  assetId: 'img',
  areas: [
    { id: 'h', label: 'H', x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
    { id: 'w', label: 'W', x: 0, y: 0, width: 0.2, height: 0.2 },
  ],
  correct: ['h'],
};

describe('isCorrect', () => {
  test.each([
    [single, { kind: 'single', choice: 'b' }, true],
    [single, { kind: 'single', choice: 'a' }, false],
    [multiple, { kind: 'multiple', choices: ['c', 'a'] }, true],
    [multiple, { kind: 'multiple', choices: ['a'] }, false],
    [multiple, { kind: 'multiple', choices: ['a', 'b', 'c'] }, false],
    [text, { kind: 'text', text: '  new york ' }, true],
    [text, { kind: 'text', text: 'nyc' }, true],
    [text, { kind: 'text', text: '' }, false],
    [order, { kind: 'order', items: ['1', '2', '3'] }, true],
    [order, { kind: 'order', items: ['2', '1', '3'] }, false],
    [match, { kind: 'match', pairs: { p: 'p', r: 'r' } }, true],
    [match, { kind: 'match', pairs: { p: 'r', r: 'p' } }, false],
    [hotspot, { kind: 'hotspot', x: 0.6, y: 0.6 }, true],
    [hotspot, { kind: 'hotspot', x: 0.1, y: 0.1 }, false],
    [single, { kind: 'text', text: 'b' }, false],
  ] as const)('%#', (question, response, expected) => {
    expect(isCorrect(question, response as never)).toBe(expected);
  });

  test('case sensitive text answers', () => {
    expect(
      isCorrect({ ...text, caseSensitive: true } as Question, { kind: 'text', text: 'nyc' }),
    ).toBe(false);
  });
});

describe('answer and attempts', () => {
  test('one attempt by default', () => {
    const s = answer(single, undefined, { kind: 'single', choice: 'a' });
    expect(s).toMatchObject({ attempts: 1, correct: false, done: true });
    expect(answer(single, s, { kind: 'single', choice: 'b' })).toBe(s);
  });

  test('several and unlimited attempts', () => {
    const twice = { ...single, attempts: 2 } as Question;
    const first = answer(twice, undefined, { kind: 'single', choice: 'a' });
    expect(first.done).toBe(false);
    expect(answer(twice, first, { kind: 'single', choice: 'b' })).toMatchObject({
      attempts: 2,
      correct: true,
      done: true,
    });
    const unlimited = { ...single, attempts: 0 } as Question;
    let s = answer(unlimited, undefined, { kind: 'single', choice: 'a' });
    for (let i = 0; i < 20; i++) s = answer(unlimited, s, { kind: 'single', choice: 'a' });
    expect(s.done).toBe(false);
  });
});

test('shuffled is deterministic and never the original order', () => {
  const items = [1, 2, 3, 4, 5];
  expect(shuffled(items, 'x')).toEqual(shuffled(items, 'x'));
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(shuffled(items, seed)).not.toEqual(items);
  expect(shuffled([1, 2], 'z')).toEqual([2, 1]);
  expect([...shuffled(items, 'q')].sort()).toEqual(items);
});

function quizCourse(): Course {
  return course(
    [
      {
        ...chapter('a', 4000, [box('a1', 0, 4000)]),
        tracks: [
          { id: 'ta', clips: [box('a1', 0, 4000)] },
          {
            id: 'tq',
            clips: [
              {
                id: 'qc',
                type: 'question',
                start: 1000,
                duration: 3000,
                frame: { x: 0, y: 0, width: 10, height: 10 },
                question: { ...single, attempts: 2, points: 2 } as Question,
              },
            ],
          },
        ],
      },
      {
        ...chapter('test', 1000, []),
        quiz: { questions: [multiple, { ...text, scored: false } as Question, order], retries: 1 },
      },
      chapter('end', 1000, [box('e', 0, 1000)]),
    ],
    { assessment: { passingScore: 75 } },
  );
}

describe('controller with questions', () => {
  test('stops at a question clip and continues only when it is done', () => {
    const c = new Controller(quizCourse());
    c.play();
    c.advance(1500);
    expect(c.state).toMatchObject({ status: 'question', time: 1000, questionClipId: 'qc' });
    c.play();
    expect(c.state.status).toBe('question');
    c.answer('q1', { kind: 'single', choice: 'a' }); // 1 of 2 attempts
    c.play();
    expect(c.state.status).toBe('question');
    c.answer('q1', { kind: 'single', choice: 'b' });
    c.play();
    c.advance(5000);
    expect(c.state).toMatchObject({ status: 'waiting', seen: [true, false, false] });
  });

  test('a chapter with a skipped question is not seen', () => {
    const c = new Controller(quizCourse());
    c.seek(2000);
    c.play();
    c.advance(5000);
    expect(c.state.seen[0]).toBe(false);
  });

  test('quiz chapter: answer, finish, score, retry', () => {
    const c = new Controller(quizCourse());
    c.goToChapter(1);
    expect(c.state.status).toBe('quiz');
    c.play();
    expect(c.state.status).toBe('quiz');
    c.answer('q2', { kind: 'multiple', choices: ['a'] }); // wrong
    c.answer('q3', { kind: 'text', text: 'nyc' });
    c.finishQuiz();
    expect(c.state.status).toBe('quiz'); // q4 still open
    c.answer('q4', { kind: 'order', items: ['1', '2', '3'] });
    c.finishQuiz();
    expect(c.state).toMatchObject({ status: 'waiting', seen: [false, true, false] });
    // q1 open → not finished; 1 of 4 scored points
    expect(c.state.score).toMatchObject({ earned: 1, possible: 4, finished: false, passed: null });

    expect(c.retriesLeft).toBe(1);
    expect(c.retryQuiz()).toBe(true);
    expect(c.state.status).toBe('quiz');
    expect(c.state.answers.q2).toBeUndefined();
    expect(c.retriesLeft).toBe(0);
    expect(c.retryQuiz()).toBe(false);
  });

  test('score and passing', () => {
    const c = new Controller(quizCourse());
    c.answer('q1', { kind: 'single', choice: 'b' });
    c.answer('q2', { kind: 'multiple', choices: ['a', 'c'] });
    c.answer('q4', { kind: 'order', items: ['2', '1', '3'] });
    expect(c.state.score).toMatchObject({
      earned: 3,
      possible: 4,
      percent: 75,
      finished: true,
      passed: true,
    });
  });

  test('progress with answers survives a reload', () => {
    const c1 = new Controller(quizCourse());
    c1.answer('q1', { kind: 'single', choice: 'a' });
    c1.goToChapter(1);
    c1.answer('q2', { kind: 'multiple', choices: ['a', 'c'] });
    const ids = collectQuestions(quizCourse()).map((r) => r.question.id);
    const encoded = encodeProgress(c1.progress, ids);
    expect(encoded.startsWith('2~')).toBe(true);
    const c2 = new Controller(quizCourse(), decodeProgress(encoded, 3, ids));
    expect(c2.state.answers).toEqual({
      q1: { attempts: 1, correct: false, done: false },
      q2: { attempts: 1, correct: true, done: true },
    });
    expect(c2.state.status).toBe('quiz');
  });
});

describe('progress codec v2', () => {
  test('round trip with answers and retries; stays small', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `q${i}`);
    const answers = Object.fromEntries(
      ids.map((id, i) => [
        id,
        { attempts: i % 4, correct: i % 3 === 0 && i % 4 > 0, done: i % 4 > 0 },
      ]),
    );
    const progress = {
      chapterIndex: 3,
      time: 1200,
      seen: [true, false, true, true],
      answers,
      quizRetries: { 2: 1 },
    };
    const encoded = encodeProgress(progress, ids);
    expect(encoded.length).toBeLessThan(500);
    const decoded = decodeProgress(encoded, 4, ids)!;
    expect(decoded.quizRetries).toEqual({ 2: 1 });
    for (const id of ids) {
      const a = answers[id]!;
      if (a.attempts === 0 && !a.done) expect(decoded.answers![id]).toBeUndefined();
      else expect(decoded.answers![id]).toEqual(a);
    }
  });

  test('v1 strings still decode; garbage is rejected', () => {
    expect(decodeProgress('1~1~a~3', 2)).toMatchObject({ chapterIndex: 1, time: 1000 });
    expect(decodeProgress('2~0~0~0~zz~', 1, ['q'])).toBeNull();
    expect(decodeProgress('2~0~0~0~12~x', 1, ['q'])).toBeNull();
  });

  test('courses without questions keep the short v1 format', () => {
    expect(encodeProgress({ chapterIndex: 0, time: 0, seen: [false] })).toBe('1~0~0~0');
  });
});

test('collectQuestions orders clips by time, then quiz questions', () => {
  expect(collectQuestions(quizCourse()).map((r) => r.question.id)).toEqual([
    'q1',
    'q2',
    'q3',
    'q4',
  ]);
});

test('computeScore without scored questions', () => {
  const c = course([chapter('a', 1000, [])]);
  expect(computeScore(c, {})).toMatchObject({ percent: null, passed: null, finished: true });
});
