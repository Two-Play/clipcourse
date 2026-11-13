// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from '@playwright/test';
import { clips, editorState, openFresh, press, ribbon } from './helpers.js';

test('tabs work with the keyboard', async ({ page }) => {
  await openFresh(page);
  const home = page.getByRole('tab', { name: 'Home', exact: true });
  await expect(home).toHaveAttribute('aria-selected', 'true');
  await home.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Insert', exact: true })).toBeFocused();
  await expect(
    page.getByRole('tabpanel').getByRole('group', { name: 'All chapters' }),
  ).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'View', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'File', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('selecting a clip shows its contextual tab with formatting tools', async ({ page }) => {
  await openFresh(page);
  await expect(page.getByRole('tab', { name: /tools$/ })).toHaveCount(0);
  await press(page, 'Text');
  const tools = page.getByRole('tab', { name: 'Text tools' });
  await expect(tools).toBeVisible();
  await tools.click();

  await page.getByRole('button', { name: 'Entrance: None' }).click();
  await page.getByRole('menuitem', { name: 'Fade' }).click();
  await press(page, 'Larger text');
  await press(page, 'Bold');
  await press(page, 'Align left');
  const [clip] = await clips(page);
  expect(clip).toMatchObject({
    animations: { in: { type: 'fade', duration: 500 } },
    style: { fontSize: 72, fontWeight: 700, align: 'left' },
  });
  await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Deselecting removes the contextual tab and returns to Home.
  await page.keyboard.press('Escape');
  await expect(tools).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Home', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('arrange: bring to front, send to back, center', async ({ page }) => {
  await openFresh(page);
  await press(page, 'Box');
  const [box] = await clips(page);
  const course = () => editorState(page).then((s) => s.course.chapters[0]!);
  await page.getByRole('tab', { name: 'Box tools' }).click();
  const before = await course();
  const ownIndex = before.tracks.findIndex((t) => t.clips.some((c) => c.id === box!.id));

  await press(page, 'Bring to front');
  let chapter = await course();
  expect(chapter.tracks.findIndex((t) => t.clips.some((c) => c.id === box!.id))).toBe(
    chapter.tracks.length - 1,
  );
  expect(chapter.tracks.length - 1).toBeGreaterThanOrEqual(ownIndex);

  await press(page, 'Send to back');
  chapter = await course();
  expect(chapter.tracks.findIndex((t) => t.clips.some((c) => c.id === box!.id))).toBe(0);

  await page.locator('.stage-canvas').hover();
  await press(page, 'Center vertically');
  const [moved] = await clips(page);
  if (moved!.type !== 'box') throw new Error('box expected');
  expect(moved!.frame.y).toBe(Math.round((1080 - moved!.frame.height) / 2));
});

test('the ribbon collapses and remembers it', async ({ page }) => {
  await openFresh(page);
  await page.getByRole('button', { name: 'Collapse the ribbon' }).click();
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand the ribbon' })).toBeVisible();
  await page.getByRole('tab', { name: 'Insert', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toBeVisible();
});

test('view tab hides and shows panels', async ({ page }) => {
  await openFresh(page);
  await ribbon(page, 'View');
  await press(page, 'Properties panel');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await press(page, 'Properties panel');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
});
