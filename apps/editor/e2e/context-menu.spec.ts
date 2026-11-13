// SPDX-License-Identifier: AGPL-3.0-only
import type { Course } from '@clipcourse/format';
import { expect, test } from '@playwright/test';
import { clips, editorState, openFresh, press, ribbon } from './helpers.js';

test('right-click a clip: copy, then paste into another chapter from the track menu', async ({
  page,
}) => {
  await openFresh(page);
  await press(page, 'Box');
  const [box] = await clips(page);
  await page.locator(`.tl-clip[data-clip-id="${box!.id}"]`).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Clip menu' });
  await expect(menu).toBeVisible();
  // The browser's own menu does not appear; ours has the editing actions.
  await expect(menu.getByRole('menuitem', { name: /^Paste/ })).toBeDisabled();
  await menu.getByRole('menuitem', { name: /^Copy/ }).click();
  await expect(menu).toBeHidden();

  await page.getByText('Add chapter', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blank chapter' }).click();
  const lane = page.locator('.tl-lane').first();
  const box2 = (await lane.boundingBox())!;
  await lane.click({ button: 'right', position: { x: 200, y: box2.height / 2 } });
  const trackMenu = page.getByRole('menu', { name: 'Track menu' });
  await trackMenu.getByRole('menuitem', { name: /^Paste/ }).click();

  const pasted = await clips(page);
  expect(pasted).toHaveLength(1);
  expect(pasted[0]!.id).not.toBe(box!.id);
  expect(pasted[0]!.start).toBeGreaterThan(0);
  const { selection, course, chapterId } = await editorState(page);
  expect(selection).toEqual([pasted[0]!.id]);
  expect((course as Course).chapters.findIndex((c) => c.id === chapterId)).toBe(1);
});

test('context menus work with the keyboard and keyboard shortcuts copy and paste', async ({
  page,
}) => {
  await openFresh(page);
  await press(page, 'Text');
  const [text] = await clips(page);
  const clip = page.locator(`.tl-clip[data-clip-id="${text!.id}"]`);
  await clip.focus();
  await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Clip menu' });
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  // First letter jumps: "D" → Duplicate.
  await page.keyboard.press('d');
  await expect(menu.getByRole('menuitem', { name: /^Duplicate/ })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(clip).toBeFocused();

  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  expect(await clips(page)).toHaveLength(2);
  await page.keyboard.press('Control+x');
  expect(await clips(page)).toHaveLength(1);
});

test('stage and chapter menus', async ({ page }) => {
  await openFresh(page);
  const overlay = page.locator('.stage-overlay');
  const o = (await overlay.boundingBox())!;
  await overlay.click({ button: 'right', position: { x: o.width * 0.25, y: o.height * 0.25 } });
  await page
    .getByRole('menu', { name: 'Stage menu' })
    .getByRole('menuitem', { name: 'Insert Button here' })
    .click();
  const button = (await clips(page)).find((c) => c.type === 'button')!;
  const { course } = await editorState(page);
  // Centred on the clicked point (a quarter into the stage).
  const frame = (button as { frame: { x: number; width: number } }).frame;
  expect(frame.x + frame.width / 2).toBeCloseTo((course as Course).stage.width * 0.25, -1);

  await page.locator('.chapter-item').first().click({ button: 'right' });
  const chapterMenu = page.getByRole('menu', { name: 'Chapter menu' });
  await chapterMenu.getByRole('menuitem', { name: 'Make quiz chapter' }).click();
  expect((await editorState(page)).course.chapters[0]!.quiz).toBeDefined();
  await page.locator('.chapter-item').first().click({ button: 'right' });
  await expect(chapterMenu.getByRole('menuitem', { name: /^Delete/ })).toBeDisabled();
});

test('panels can be resized by dragging and with the keyboard; sizes are remembered', async ({
  page,
}) => {
  await openFresh(page);
  await page.evaluate(() => localStorage.removeItem('clipcourse:layout'));
  const sidebar = page.locator('.sidebar');
  const before = (await sidebar.boundingBox())!.width;
  const splitter = page.getByRole('separator', { name: 'Resize Chapters and media' });
  const s = (await splitter.boundingBox())!;
  await page.mouse.move(s.x + s.width / 2, s.y + 100);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width / 2 + 80, s.y + 100, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeCloseTo(before + 80, -1);

  const timeline = page.getByRole('separator', { name: 'Resize timeline' });
  await timeline.focus();
  const height = Number(await timeline.getAttribute('aria-valuenow'));
  await page.keyboard.press('Shift+ArrowUp');
  await expect(timeline).toHaveAttribute('aria-valuenow', String(height + 50));

  await page.reload();
  await expect
    .poll(async () => (await page.locator('.sidebar').boundingBox())!.width)
    .toBeCloseTo(before + 80, -1);
  await ribbon(page, 'View');
  await press(page, 'Reset layout');
  await expect
    .poll(async () => (await page.locator('.sidebar').boundingBox())!.width)
    .toBeCloseTo(before, -1);
});

test('changing the stage format scales the clips', async ({ page }) => {
  await openFresh(page);
  await press(page, 'Box');
  const [box] = await clips(page);
  const inspector = page.getByRole('complementary', { name: 'Properties' });
  await page.locator('.stage-overlay').click({ position: { x: 2, y: 2 } });
  await inspector.getByLabel('Stage format').selectOption('1:1');
  const { course } = await editorState(page);
  expect((course as Course).stage).toMatchObject({ width: 1080, height: 1080 });
  const scaled = (await clips(page))[0] as { frame: { width: number } };
  expect(scaled.frame.width).toBeCloseTo(
    (box as { frame: { width: number } }).frame.width * (1080 / 1920),
    0,
  );
  await expect(page.locator('.notice')).toContainText('1080×1080');
});
