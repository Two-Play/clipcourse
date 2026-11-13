// SPDX-License-Identifier: MIT
/** Maps answered questions to SCORM interactions. */
import type { Question } from '@clipcourse/format';
import type { Response } from '@clipcourse/player';
import type { Interaction } from './connection.js';

export function toInteraction(
  question: Question,
  response: Response,
  correct: boolean,
): Interaction {
  const base = {
    id: question.id,
    result: correct,
    weighting: question.points ?? 1,
    description: question.prompt,
  };
  switch (question.kind) {
    case 'single':
      return {
        ...base,
        type: 'choice',
        response: response.kind === 'single' ? [response.choice] : [],
        correct: [question.correct],
        ids: question.choices.map((c) => c.id),
      };
    case 'multiple':
      return {
        ...base,
        type: 'choice',
        response: response.kind === 'multiple' ? response.choices : [],
        correct: question.correct,
        ids: question.choices.map((c) => c.id),
      };
    case 'text':
      return {
        ...base,
        type: 'fill-in',
        response: response.kind === 'text' ? response.text : '',
        correct: question.answers[0]!,
      };
    case 'order':
      return {
        ...base,
        type: 'sequencing',
        response: response.kind === 'order' ? response.items : [],
        correct: question.items.map((i) => i.id),
        ids: question.items.map((i) => i.id),
      };
    case 'match':
      return {
        ...base,
        type: 'matching',
        response:
          response.kind === 'match'
            ? question.pairs.map((p) => [p.id, response.pairs[p.id] ?? ''] as [string, string])
            : [],
        correct: question.pairs.map((p) => [p.id, p.id] as [string, string]),
        ids: question.pairs.map((p) => p.id),
      };
    case 'hotspot':
      return {
        ...base,
        type: 'other',
        response:
          response.kind === 'hotspot' ? `${response.x.toFixed(3)},${response.y.toFixed(3)}` : '',
        correct: question.correct.join(','),
      };
  }
}
