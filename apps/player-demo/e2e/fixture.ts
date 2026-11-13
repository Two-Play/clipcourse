// SPDX-License-Identifier: MIT
import type { Course } from '@clipcourse/format';
import type { Page } from '@playwright/test';

const frame = { x: 100, y: 100, width: 800, height: 200 };

/** A media-free course so timing tests do not depend on codecs. */
export const fixtureCourse: Course = {
  formatVersion: 5,
  id: 'e2e_fixture',
  title: 'E2E fixture',
  language: 'en',
  stage: { width: 1280, height: 720, background: '#000000' },
  assets: {},
  chapters: [
    {
      id: 'one',
      title: 'First',
      duration: 3000,
      transition: { mode: 'wait' },
      markers: [{ id: 'm1', time: 2000, title: 'Halfway' }],
      tracks: [
        {
          id: 't1',
          clips: [
            { id: 'a', type: 'text', text: 'Alpha', start: 0, duration: 1000, frame },
            { id: 'b', type: 'text', text: 'Bravo', start: 1000, duration: 2000, frame },
          ],
        },
      ],
    },
    {
      id: 'two',
      title: 'Second',
      duration: 2000,
      transition: { mode: 'auto' },
      tracks: [
        {
          id: 't2',
          clips: [{ id: 'c', type: 'text', text: 'Charlie', start: 0, duration: 2000, frame }],
        },
      ],
    },
    {
      id: 'three',
      title: 'Third',
      duration: 1000,
      transition: { mode: 'wait' },
      tracks: [
        {
          id: 't3',
          clips: [{ id: 'd', type: 'text', text: 'Delta', start: 0, duration: 1000, frame }],
        },
      ],
    },
  ],
};

export async function openFixture(page: Page) {
  await page.route('**/e2e/course.json', (route) => route.fulfill({ json: fixtureCourse }));
  await page.clock.install();
  await page.goto('/?course=e2e');
  await page.getByRole('button', { name: 'Start' }).waitFor();
  // Freeze time: from here on only page.clock.runFor() advances it.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
}

export const visibleText = (page: Page) => page.locator('.ccp-clip:visible').allTextContents();

export const state = (page: Page) =>
  page.evaluate(() => {
    const s = window.__player!.getState();
    return {
      chapterIndex: s.chapterIndex,
      time: s.time,
      status: s.status,
      seen: [...s.seen],
      complete: s.complete,
    };
  });
