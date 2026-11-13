// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import type { Course } from '@clipcourse/format';
import { afterEach, expect, test } from 'vitest';
import { createManualClock } from '../src/clock.js';
import { createPlayer, type Player } from '../src/player.js';
import { chapter, course } from './fixtures.js';

let player: Player | null = null;
afterEach(() => {
  player?.destroy();
  player = null;
  document.body.innerHTML = '';
});

const quizCourse = (): Course =>
  course(
    [
      {
        ...chapter('a', 3000, []),
        tracks: [
          {
            id: 't',
            clips: [
              {
                id: 'qc',
                type: 'question',
                start: 1000,
                duration: 2000,
                frame: { x: 0, y: 0, width: 1000, height: 800 },
                question: {
                  id: 'q1',
                  kind: 'single',
                  prompt: 'Pick B',
                  choices: [
                    { id: 'a', text: 'A' },
                    { id: 'b', text: 'B' },
                  ],
                  correct: 'b',
                  feedback: { correct: 'Great', incorrect: 'Nope' },
                },
              },
            ],
          },
        ],
      },
      {
        ...chapter('test', 1000, []),
        quiz: {
          retries: 1,
          questions: [
            { id: 'q2', kind: 'text', prompt: 'Capital of France?', answers: ['Paris'] },
            {
              id: 'q3',
              kind: 'match',
              prompt: 'Match',
              pairs: [
                { id: 'x', left: 'one', right: '1' },
                { id: 'y', left: 'two', right: '2' },
              ],
            },
          ],
        },
      },
    ],
    { assessment: { passingScore: 100 } },
  );

function setup() {
  const host = document.createElement('div');
  document.body.append(host);
  const clock = createManualClock();
  player = createPlayer(host, quizCourse(), { clock });
  return { host, clock };
}

test('a question clip stops playback, gives feedback and continues', () => {
  const { host, clock } = setup();
  player!.play();
  for (let i = 0; i < 6; i++) clock.step(250);
  expect(player!.getState().status).toBe('question');
  const form = host.querySelector<HTMLFormElement>('.ccp-q')!;
  expect(form.querySelector('legend')!.textContent).toBe('Pick B');
  const submit = form.querySelector<HTMLButtonElement>('.ccp-q-submit')!;
  expect(submit.disabled).toBe(true);
  const radios = form.querySelectorAll<HTMLInputElement>('input[type=radio]');
  radios[1]!.checked = true;
  radios[1]!.dispatchEvent(new Event('change', { bubbles: true }));
  expect(submit.disabled).toBe(false);
  form.requestSubmit();
  const feedback = host.querySelector('.ccp-q-feedback')!;
  expect(feedback.textContent).toBe('Great');
  expect(feedback.getAttribute('role')).toBe('status');
  host.querySelector<HTMLButtonElement>('.ccp-q-continue')!.click();
  expect(player!.getState().status).toBe('playing');
});

test('quiz chapter: one question at a time, result, retry', () => {
  const { host } = setup();
  player!.goToChapter(1);
  expect(player!.getState().status).toBe('quiz');
  expect(host.querySelector('.ccp-quiz-progress')!.textContent).toBe('Question 1 of 2');
  // Reached without pressing Start: the start overlay must not cover the quiz.
  expect(host.querySelector<HTMLElement>('.ccp-overlay')!.hidden).toBe(true);

  const input = host.querySelector<HTMLInputElement>('.ccp-q-text')!;
  input.value = ' paris ';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  host.querySelector<HTMLFormElement>('.ccp-q')!.requestSubmit();
  expect(host.querySelector('.ccp-q-feedback')!.textContent).toBe('Correct!');
  host.querySelector<HTMLButtonElement>('.ccp-q-continue')!.click();

  expect(host.querySelector('.ccp-quiz-progress')!.textContent).toBe('Question 2 of 2');
  const selects = host.querySelectorAll<HTMLSelectElement>('.ccp-q select');
  selects[0]!.value = 'y'; // wrong
  selects[1]!.value = 'x';
  selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
  host.querySelector<HTMLFormElement>('.ccp-q')!.requestSubmit();
  expect(host.querySelector('.ccp-q-continue')!.textContent).toBe('Show result');
  host.querySelector<HTMLButtonElement>('.ccp-q-continue')!.click();

  expect(player!.getState().status).toBe('ended');
  expect(host.querySelector('.ccp-quiz-result')!.textContent).toBe(
    'You answered 1 of 2 questions correctly.',
  );
  expect(host.querySelector('.ccp-quiz-verdict')!.textContent).toMatch(/Not passed yet/);
  const retry = [...host.querySelectorAll<HTMLButtonElement>('.ccp-quiz button')].find((b) =>
    b.textContent!.startsWith('Try again'),
  )!;
  retry.click();
  expect(player!.getState().status).toBe('quiz');
  expect(host.querySelector('.ccp-quiz-progress')!.textContent).toBe('Question 1 of 2');
});

test('order questions can be solved with the up/down buttons', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const c = course([
    {
      ...chapter('q', 1000, []),
      quiz: {
        questions: [
          {
            id: 'o',
            kind: 'order',
            prompt: 'Order',
            items: [
              { id: '1', text: 'one' },
              { id: '2', text: 'two' },
            ],
          },
        ],
      },
    },
  ]);
  player = createPlayer(host, c, { clock: createManualClock() });
  const first = () => host.querySelector('.ccp-q-orderitem')!.getAttribute('data-item-id');
  // Shuffled: never already in the right order.
  expect(first()).toBe('2');
  host.querySelector<HTMLButtonElement>('.ccp-q-orderitem:nth-child(2) .ccp-q-move')!.click(); // move "one" up
  expect(first()).toBe('1');
  host.querySelector<HTMLFormElement>('.ccp-q')!.requestSubmit();
  expect(player.getState().answers.o).toMatchObject({ correct: true });
});
