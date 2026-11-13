// SPDX-License-Identifier: AGPL-3.0-only
import type { Clip, Course } from '@clipcourse/format';
import { expect, type Page } from '@playwright/test';

/** Starts the editor with an empty course and no stored draft. */
export async function openFresh(page: Page) {
  await page.goto('/?fresh');
  await expect(
    page.getByRole('tabpanel').getByRole('button', { name: 'Text', exact: true }),
  ).toBeVisible();
}

export function editorState(page: Page) {
  return page.evaluate(() => {
    const s = window.__session!.store.getState();
    return {
      course: s.course,
      chapterId: s.chapterId,
      playhead: s.playhead,
      selection: s.selection,
      zoom: s.zoom,
      undo: s.past.length,
      redo: s.future.length,
    };
  });
}

export async function clips(page: Page): Promise<(Clip & { trackId: string })[]> {
  const { course, chapterId } = await editorState(page);
  const chapter = (course as Course).chapters.find((c) => c.id === chapterId)!;
  return chapter.tracks.flatMap((t) => t.clips.map((c) => ({ ...c, trackId: t.id })));
}

export async function setZoom(page: Page, zoom: number) {
  await page.evaluate((z) => window.__session!.store.getState().setZoom(z), zoom);
}

/** Drags with real mouse events from one point to another in steps. */
export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Switches the ribbon to a tab (File, Home, Insert, Chapter, View). */
export async function ribbon(page: Page, tab: string) {
  await page.getByRole('tab', { name: tab, exact: true }).click();
}

/** Clicks a button in the ribbon or the quick access bar by its exact name. */
export async function press(page: Page, name: string) {
  await page
    .locator('.ribbon, .quick-access')
    .getByRole('button', { name, exact: true })
    .first()
    .click();
}
