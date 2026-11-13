// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, test } from 'vitest';
import { createEmptyCourse, findClip } from '../src/document.js';
import { executeOperation, type Operation } from '../src/operations.js';
import { createQuestion, QUESTION_KINDS } from '../src/questions.js';
import { createEditorStore } from '../src/store.js';
import { expectValid } from './helpers.js';

function setup() {
  const store = createEditorStore(createEmptyCourse());
  const files = new Map<string, Uint8Array>();
  const run = (op: Operation) => executeOperation({ store, files }, op);
  return { store, run, course: () => store.getState().course };
}

describe('questions in the editor model', () => {
  test('every kind has a valid default', () => {
    const { run, course } = setup();
    run({ op: 'add_asset', fileName: 'map.png', data: new Uint8Array([1]) });
    for (const kind of QUESTION_KINDS) {
      run({
        op: 'add_clip',
        type: 'question',
        start: 0,
        props: { question: createQuestion(kind, `x_${kind}`, 'map') },
      });
    }
    expectValid(course());
    expect(
      course()
        .chapters[0]!.tracks.flatMap((t) => t.clips)
        .filter((c) => c.type === 'question'),
    ).toHaveLength(6);
  });

  test('add a question clip, patch its question, duplicate and split keep ids unique', () => {
    const { run, course } = setup();
    const { created } = run({ op: 'add_clip', type: 'question', start: 0 });
    const clipId = created!.clipId!;
    run({ op: 'update_clip', clipId, props: { question: { prompt: 'New prompt', attempts: 2 } } });
    const clip = findClip(course(), clipId)!.clip;
    expect(clip.type === 'question' && clip.question).toMatchObject({
      prompt: 'New prompt',
      attempts: 2,
      kind: 'single',
    });
    run({ op: 'duplicate_clip', clipId });
    run({ op: 'split_clip', clipId, time: 2000 });
    expectValid(course());
    run({ op: 'duplicate_chapter', chapterId: course().chapters[0]!.id });
    expectValid(course());
  });

  test('quiz chapters, quiz questions and the assessment', () => {
    const { run, course } = setup();
    const chapterId = run({ op: 'add_chapter', title: 'Final test' }).created!.chapterId!;
    const first = run({ op: 'set_quiz', chapterId, shuffle: true, retries: 2 }).created!
      .questionId!;
    run({ op: 'add_quiz_question', chapterId, question: createQuestion('text', 'cap') });
    run({
      op: 'update_quiz_question',
      chapterId,
      questionId: 'cap',
      props: { prompt: 'Capital?', answers: ['Bern'] },
    });
    run({ op: 'move_quiz_question', chapterId, questionId: 'cap', index: 0 });
    run({ op: 'set_assessment', passingScore: 80 });
    let quiz = course().chapters[1]!.quiz!;
    expect(quiz).toMatchObject({ shuffle: true, retries: 2 });
    expect(quiz.questions.map((q) => q.id)).toEqual(['cap', first]);
    expect(course().assessment).toEqual({ passingScore: 80 });
    run({ op: 'delete_quiz_question', chapterId, questionId: first });
    expect(() => run({ op: 'delete_quiz_question', chapterId, questionId: 'cap' })).toThrow(
      /at least one/,
    );
    expect(() =>
      run({ op: 'update_quiz_question', chapterId, questionId: 'cap', props: { answers: [] } }),
    ).toThrow(/invalid/);
    run({ op: 'set_quiz', chapterId, enabled: false });
    quiz = course().chapters[1]!.quiz!;
    expect(quiz).toBeUndefined();
    expectValid(course());
  });

  test('a duplicate question id from the AI is replaced', () => {
    const { run, course } = setup();
    const chapterId = run({ op: 'add_chapter', title: 'Q' }).created!.chapterId!;
    run({ op: 'set_quiz', chapterId });
    const id = run({
      op: 'add_quiz_question',
      chapterId,
      question: createQuestion('single', 'same'),
    }).created!.questionId;
    const again = run({
      op: 'add_quiz_question',
      chapterId,
      question: createQuestion('single', 'same'),
    }).created!.questionId;
    expect(id).toBe('same');
    expect(again).not.toBe('same');
    expectValid(course());
  });
});
