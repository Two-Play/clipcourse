// SPDX-License-Identifier: AGPL-3.0-only
/** Builds the SCORM test package used by the LMS tests. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportScorm, type ScormVersion } from '@clipcourse/exporter';
import { themePreset, type Course } from '@clipcourse/format';
import { expect, type Frame, type FrameLocator } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtimeFile = `${root}packages/scorm-runtime/dist/clipcourse-runtime.iife.js`;

export function testCourse(id: string): Course {
  const text = (cid: string, value: string) => ({
    id: cid,
    type: 'text' as const,
    text: value,
    role: 'heading' as const,
    start: 0,
    duration: 1500,
    frame: { x: 160, y: 400, width: 1600, height: 200 },
    style: { fontSize: 96, color: 'theme:text', align: 'center' as const },
  });
  return {
    formatVersion: 5,
    id,
    title: `Clipcourse LMS test ${id}`,
    language: 'en',
    stage: { width: 1920, height: 1080, background: 'theme:background' },
    theme: structuredClone(themePreset('light')!.theme),
    assets: { logo: { kind: 'image', src: 'assets/logo.svg', mime: 'image/svg+xml', alt: 'Logo' } },
    chapters: [
      {
        id: 'one',
        title: 'First chapter',
        duration: 1500,
        transition: { mode: 'wait' },
        tracks: [
          { id: 't1', clips: [text('c1', 'Chapter one')] },
          {
            id: 't_reveal',
            clips: [
              {
                id: 'reveal',
                type: 'button',
                text: 'Show the hint',
                start: 0,
                duration: 1500,
                frame: { x: 760, y: 820, width: 400, height: 110 },
                action: { type: 'setClipVisibility', clipId: 'hint', visible: 'show' },
              },
              {
                id: 'hint',
                type: 'text',
                text: 'Hint revealed',
                startsHidden: true,
                start: 0,
                duration: 1500,
                frame: { x: 160, y: 650, width: 1600, height: 120 },
                style: { fontSize: 64, color: 'theme:accent', align: 'center' },
              },
            ],
          },
          {
            id: 't2',
            clips: [
              {
                id: 'img',
                type: 'image',
                assetId: 'logo',
                start: 0,
                duration: 1500,
                frame: { x: 860, y: 100, width: 200, height: 200 },
              },
            ],
          },
        ],
      },
      {
        id: 'two',
        title: 'Second chapter',
        duration: 1500,
        transition: { mode: 'wait' },
        tracks: [{ id: 't3', clips: [text('c2', 'Chapter two')] }],
      },
      {
        id: 'quiz',
        title: 'Final quiz',
        duration: 1000,
        transition: { mode: 'wait' },
        tracks: [],
        quiz: {
          questions: [
            {
              id: 'q_color',
              kind: 'single',
              prompt: 'Which color is the sky on a clear day?',
              choices: [
                { id: 'blue', text: 'Blue' },
                { id: 'green', text: 'Green' },
              ],
              correct: 'blue',
            },
            {
              id: 'q_number',
              kind: 'text',
              prompt: 'Emergency number in the EU?',
              answers: ['112'],
            },
          ],
        },
      },
      {
        // Never visited: optional chapters are not needed for completion.
        id: 'extra',
        title: 'Extra material',
        duration: 1000,
        transition: { mode: 'wait' },
        optional: true,
        tracks: [{ id: 't4', clips: [text('c4', 'Extra')] }],
      },
    ],
    assessment: { passingScore: 50 },
  };
}

/**
 * Plays the quiz chapter: first answer right, second wrong, so the LMS
 * should store a score of 50 and "passed" (passing score 50 %).
 */
/** Reveals the hint in chapter one (stored in the bookmark, checked after resume). */
/** The light theme reached the LMS: stage background and theme variables. */
export async function expectLightTheme(course: Frame | FrameLocator) {
  await expect(course.locator('.ccp-stage')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
  await expect(course.getByRole('button', { name: 'Show the hint' })).toHaveCSS(
    'background-color',
    'rgb(29, 95, 209)',
  );
}

export async function revealHint(course: Frame | FrameLocator) {
  await course.getByRole('button', { name: 'Show the hint' }).click();
  await expect(course.getByText('Hint revealed')).toBeVisible();
}

export async function answerQuiz(course: Frame | FrameLocator) {
  await expect(course.locator('.ccp-quiz-progress')).toHaveText('Question 1 of 2');
  await course.getByRole('radio', { name: 'Blue' }).check();
  await course.getByRole('button', { name: 'Check answer' }).click();
  await course.getByRole('button', { name: 'Next question' }).click();
  await course.getByRole('textbox', { name: 'Your answer' }).fill('110');
  await course.getByRole('button', { name: 'Check answer' }).click();
  await course.getByRole('button', { name: 'Show result' }).click();
  await expect(course.locator('.ccp-quiz-score')).toContainText('50');
  await expect(course.locator('.ccp-quiz-verdict')).toHaveText(/passed/i);
}

export function buildPackage(version: ScormVersion, id: string): Buffer {
  if (!existsSync(runtimeFile)) {
    throw new Error('Build the runtime first: pnpm --filter @clipcourse/scorm-runtime build');
  }
  const files = new Map([
    ['assets/logo.svg', new Uint8Array(readFileSync(`${root}examples/welcome/assets/logo.svg`))],
  ]);
  const result = exportScorm(
    { course: testCourse(id), files },
    { version, runtime: readFileSync(runtimeFile, 'utf8') },
  );
  return Buffer.from(result.zip);
}
