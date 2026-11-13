// SPDX-License-Identifier: AGPL-3.0-only
/** Ready-to-edit example questions for every kind. */
import type { Question, QuestionKind } from '@clipcourse/format';

export const QUESTION_KINDS: QuestionKind[] = [
  'single',
  'multiple',
  'text',
  'order',
  'match',
  'hotspot',
];

/**
 * A new question of `kind` with sensible placeholder content. Hotspot
 * questions need an image asset.
 */
export function createQuestion(kind: QuestionKind, id: string, imageAssetId?: string): Question {
  switch (kind) {
    case 'single':
      return {
        id,
        kind,
        prompt: 'Which answer is correct?',
        choices: [
          { id: 'a', text: 'The right answer' },
          { id: 'b', text: 'A wrong answer' },
          { id: 'c', text: 'Another wrong answer' },
        ],
        correct: 'a',
        feedback: { correct: 'Correct!', incorrect: 'Not quite.' },
      };
    case 'multiple':
      return {
        id,
        kind,
        prompt: 'Select all correct answers.',
        choices: [
          { id: 'a', text: 'Correct answer 1' },
          { id: 'b', text: 'Correct answer 2' },
          { id: 'c', text: 'Wrong answer' },
        ],
        correct: ['a', 'b'],
        feedback: { correct: 'Correct!', incorrect: 'Not quite.' },
      };
    case 'text':
      return {
        id,
        kind,
        prompt: 'Type the answer.',
        answers: ['answer'],
        feedback: { correct: 'Correct!', incorrect: 'Not quite.' },
      };
    case 'order':
      return {
        id,
        kind,
        prompt: 'Put the steps in the right order.',
        items: [
          { id: 's1', text: 'First step' },
          { id: 's2', text: 'Second step' },
          { id: 's3', text: 'Third step' },
        ],
      };
    case 'match':
      return {
        id,
        kind,
        prompt: 'Match the terms.',
        pairs: [
          { id: 'p1', left: 'Term 1', right: 'Meaning 1' },
          { id: 'p2', left: 'Term 2', right: 'Meaning 2' },
          { id: 'p3', left: 'Term 3', right: 'Meaning 3' },
        ],
      };
    case 'hotspot':
      if (!imageAssetId) throw new Error('A hotspot question needs an image');
      return {
        id,
        kind,
        prompt: 'Click the right place.',
        assetId: imageAssetId,
        areas: [{ id: 'h1', label: 'Target area', x: 0.4, y: 0.4, width: 0.2, height: 0.2 }],
        correct: ['h1'],
      };
  }
}
