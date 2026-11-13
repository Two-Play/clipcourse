// SPDX-License-Identifier: AGPL-3.0-only
import type { Chapter, Question, QuestionClip } from '@clipcourse/format';
import { expect, test } from '@playwright/test';
import { clips, editorState, openFresh, press, ribbon } from './helpers.js';

async function questionClip(page: Parameters<typeof clips>[0]) {
  return (await clips(page)).find(
    (c): c is QuestionClip & { trackId: string } => c.type === 'question',
  )!;
}

test('inserts a question clip and edits it in the inspector', async ({ page }) => {
  await openFresh(page);
  await press(page, 'Question');
  const menu = page.getByRole('menu', { name: 'Question' });
  // Hotspot questions need an image first.
  await expect(menu.getByRole('menuitem', { name: 'Click the image' })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Multiple choice' }).click();

  let clip = await questionClip(page);
  expect(clip.question.kind).toBe('multiple');
  await expect(page.getByRole('tab', { name: 'Question tools' })).toBeVisible();

  const inspector = page.getByRole('complementary', { name: 'Properties' });
  await inspector.getByRole('checkbox', { name: 'Correct: Correct answer 2' }).uncheck();
  await inspector.getByRole('textbox', { name: 'Answers 3' }).fill('Paris');
  clip = await questionClip(page);
  const q = clip.question as Extract<Question, { kind: 'multiple' }>;
  expect(q.correct).toEqual([q.choices[0]!.id]);
  expect(q.choices[2]!.text).toBe('Paris');
  // The stage shows the question as the learner will see it.
  await expect(page.locator('.stage-host .ccp-q')).toContainText('Paris');
  await expect(page.locator('.stage-host .ccp-q input').first()).toBeDisabled();

  // Typing is merged into one undo step per field.
  await page.locator('.stage-overlay').focus();
  await page.keyboard.press('Control+z');
  clip = await questionClip(page);
  expect((clip.question as Extract<Question, { kind: 'multiple' }>).choices[2]!.text).toBe(
    'Wrong answer',
  );

  // Another kind starts from that kind's sample content.
  await inspector.getByLabel('Question type').selectOption('order');
  clip = await questionClip(page);
  expect(clip.question.kind).toBe('order');
  expect(clip.question.id).toBe(q.id);
  expect(clip.question.prompt).not.toBe(q.prompt);
  await expect(inspector.getByRole('group', { name: 'Items in the correct order' })).toBeVisible();
});

test('quiz chapter with a passing score reports passed to the LMS', async ({ page }) => {
  await openFresh(page);
  await ribbon(page, 'Insert');
  await press(page, 'Quiz chapter');
  const state = await editorState(page);
  const { chapterId } = state;
  let { course } = state;
  const quizChapter = course.chapters.find((c: Chapter) => c.id === chapterId)!;
  expect(quizChapter.quiz!.questions).toHaveLength(1);
  await expect(page.locator('[data-testid="quiz-preview"]')).toContainText('Question 1 of 1');

  const inspector = page.getByRole('complementary', { name: 'Properties' });
  await inspector.getByRole('button', { name: 'Add question' }).click();
  await expect(page.locator('[data-testid="quiz-preview"]')).toContainText('Question 2 of 2');
  await inspector.getByLabel('Question type').selectOption('text');
  await inspector.getByLabel('Accepted answers (one per line)').fill('112\nOne one two');
  await inspector.getByLabel('Score the course (pass/fail)').check();
  await expect(inspector.getByLabel('Passing score (%)')).toHaveValue('80');

  ({ course } = await editorState(page));
  const questions = course.chapters[1]!.quiz!.questions;
  expect(questions.map((q: Question) => q.kind)).toEqual(['single', 'text']);
  expect((questions[1] as Extract<Question, { kind: 'text' }>).answers).toEqual([
    '112',
    'One one two',
  ]);
  expect(course.assessment).toEqual({ passingScore: 80 });

  await press(page, 'Preview');
  const dialog = page.getByRole('dialog', { name: 'Preview' });
  await dialog.getByLabel('LMS simulation').selectOption('2004');
  const panel = dialog.getByRole('complementary', { name: 'LMS simulation' });
  await page.evaluate(() => window.__preview!.goToChapter(1));

  await expect(dialog.locator('.ccp-quiz-progress')).toHaveText('Question 1 of 2');
  await dialog.getByRole('radio', { name: 'The right answer' }).check();
  await dialog.getByRole('button', { name: 'Check answer' }).click();
  await expect(dialog.locator('.ccp-q-feedback')).toHaveText('Correct!');
  await dialog.getByRole('button', { name: 'Next question' }).click();
  await dialog.getByRole('textbox', { name: 'Your answer' }).fill(' one ONE two ');
  await dialog.getByRole('button', { name: 'Check answer' }).click();
  await dialog.getByRole('button', { name: 'Show result' }).click();

  await expect(dialog.locator('.ccp-quiz-verdict')).toHaveText(/passed/i);
  await expect(panel.locator('[data-lms-key="Score"]')).toHaveText('100 %');
  await expect(panel.locator('[data-lms-key="Result"]')).toHaveText('passed');
  const lms = await page.evaluate(() => window.__previewLms!.values);
  expect(lms['cmi.interactions.1.type']).toBe('fill-in');
  expect(lms['cmi.interactions.1.result']).toBe('correct');
});
