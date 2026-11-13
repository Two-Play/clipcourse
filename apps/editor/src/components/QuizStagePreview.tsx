// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A quiz chapter has no timeline content: the stage shows the question that
 * is being edited, rendered by the player (inputs disabled).
 */
import { defaultStrings, format, renderQuestion } from '@clipcourse/player';
import type { Chapter, Course } from '@clipcourse/format';
import { useLayoutEffect, useRef } from 'react';
import { useSession } from '../context.js';
import { t } from '../i18n.js';
import { useQuizFocus } from '../quizFocus.js';

export function QuizStagePreview({ course, chapter }: { course: Course; chapter: Chapter }) {
  const session = useSession();
  const hostRef = useRef<HTMLDivElement>(null);
  const focus = useQuizFocus();
  const quiz = chapter.quiz;
  const index = Math.max(0, quiz?.questions.findIndex((q) => q.id === focus) ?? 0);
  const question = quiz?.questions[index];

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !question || !quiz) return;
    const panel = document.createElement('div');
    panel.className = 'ccp-quiz-panel';
    const progress = document.createElement('p');
    progress.className = 'ccp-quiz-progress';
    progress.textContent = format(defaultStrings.questionOf, {
      index: index + 1,
      count: quiz.questions.length,
    });
    panel.append(
      progress,
      renderQuestion(document, {
        question,
        state: undefined,
        strings: defaultStrings,
        assets: course.assets,
        imageUrl: session.resolveAsset,
        interactive: false,
      }),
    );
    host.replaceChildren(panel);
  }, [question, quiz, index, course.assets, session]);

  if (!question) return null;
  return (
    <div
      ref={hostRef}
      className="ccp-quiz stage-quiz-preview"
      aria-label={t('quizChapter')}
      data-testid="quiz-preview"
    />
  );
}
