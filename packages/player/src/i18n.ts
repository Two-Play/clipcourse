// SPDX-License-Identifier: MIT
/** User-facing strings of the player chrome. Pass overrides via `strings`. */
export const defaultStrings = {
  play: 'Play',
  pause: 'Pause',
  start: 'Start',
  resume: 'Resume',
  replay: 'Replay',
  continue: 'Continue',
  previousChapter: 'Previous chapter',
  nextChapter: 'Next chapter',
  captionsOn: 'Turn captions on',
  captionsOff: 'Turn captions off',
  seek: 'Position in chapter',
  /** {current} and {total} are replaced with formatted times. */
  timeOf: '{current} of {total}',
  /** {index}, {count} and {title} are replaced. */
  chapterLabel: 'Chapter {index} of {count}: {title}',
  chapterComplete: 'End of chapter. Press Continue to go on.',
  courseComplete: 'You have completed the course.',
  loading: 'Loading…',
  mediaError: 'A media file could not be loaded.',
  controls: 'Player controls',
  contents: 'Contents',
  checkAnswer: 'Check answer',
  correct: 'Correct!',
  incorrect: 'Not quite.',
  tryAgain: 'Try again.',
  attemptsLeft: '{count} attempt(s) left.',
  solution: 'Correct answer: {answer}',
  selectAll: 'Select all that apply.',
  yourAnswer: 'Your answer',
  choose: 'Choose…',
  moveUp: 'Move “{item}” up',
  moveDown: 'Move “{item}” down',
  hotspotAreas: 'Or choose an area',
  questionOf: 'Question {index} of {count}',
  nextQuestion: 'Next question',
  finishQuiz: 'Show result',
  quizResult: 'You answered {correct} of {count} questions correctly.',
  quizScore: 'Score: {percent} %',
  quizPassed: 'Passed – well done!',
  quizFailed: 'Not passed yet. You need {required} %.',
  retryQuiz: 'Try again ({count} left)',
  answerToContinue: 'Answer the question to continue.',
  closeContents: 'Close contents',
  completed: 'completed',
  current: 'current',
};

export type PlayerStrings = typeof defaultStrings;

export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** Formats ms as m:ss (or h:mm:ss). */
export function formatTime(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
