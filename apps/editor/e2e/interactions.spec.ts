// SPDX-License-Identifier: AGPL-3.0-only
import type { ButtonClip, Course } from '@clipcourse/format';
import { expect, test } from '@playwright/test';
import { clips, editorState, openFresh, press } from './helpers.js';

test('a branch button, a reveal and a glossary term work in the preview', async ({ page }) => {
  await openFresh(page);
  // Second chapter as the branch target, then back to chapter 1.
  await page.getByText('Add chapter', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blank chapter' }).click();
  await page.locator('.chapter-item').first().locator('.chapter-open').click();

  await press(page, 'Button');
  const button = (await clips(page)).find((c) => c.type === 'button') as ButtonClip;
  const { course } = await editorState(page);
  expect(button.action).toEqual({
    type: 'goToChapter',
    chapterId: (course as Course).chapters[1]!.id,
  });
  const inspector = page.getByRole('complementary', { name: 'Properties' });
  await inspector.getByLabel('Text', { exact: true }).fill('Go to part 2');

  // A text that is hidden until a box reveals it, with a glossary term in it.
  await page.getByRole('button', { name: 'Add term' }).click();
  await page.getByLabel('Term', { exact: true }).fill('branch');
  await page.getByLabel('Explanation').fill('Another way through the course.');
  await press(page, 'Text');
  const tipId = (await clips(page)).find((c) => c.type === 'text')!.id;
  await inspector.getByLabel('Text', { exact: true }).fill('Take a branch.');
  await inspector.getByLabel('Hidden until shown by a click').check();
  await press(page, 'Box');
  await inspector.getByLabel('Action').selectOption('setClipVisibility');
  await inspector.getByLabel('Clip', { exact: true }).selectOption(tipId);
  await inspector.getByLabel('Name for screen readers').fill('Show the tip');

  const boxClip = (await clips(page)).find((c) => c.type === 'box')!;
  expect(boxClip).toMatchObject({
    action: { type: 'setClipVisibility', clipId: tipId, visible: 'show' },
    actionLabel: 'Show the tip',
  });
  await expect(page.locator(`.tl-clip[data-clip-id="${boxClip.id}"] .tl-clip-badge`)).toHaveCount(
    1,
  );

  await press(page, 'Preview');
  const dialog = page.getByRole('dialog', { name: 'Preview' });
  const tip = dialog.locator(`[data-clip-id="${tipId}"]`);
  await expect(tip).toBeHidden();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await page.evaluate(() => window.__preview!.pause());
  await dialog.getByRole('button', { name: 'Show the tip' }).click();
  await expect(tip).toBeVisible();
  // The glossary term opens its explanation (keyboard); Escape returns to it.
  const term = tip.getByRole('button', { name: 'branch' });
  await term.focus();
  await page.keyboard.press('Enter');
  const info = page.getByRole('dialog', { name: 'branch' });
  await expect(info).toContainText('Another way through the course.');
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(term).toBeFocused();
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Go to part 2' }).click();
  await expect(dialog.locator('.ccp-title')).toHaveText('Chapter 2 of 2: New chapter');

  // The branch target cannot be deleted while the button uses it.
  await dialog.getByRole('button', { name: 'Close preview' }).click();
  page.on('dialog', (d) => void d.accept());
  await page.locator('.chapter-item').nth(1).hover();
  await page
    .locator('.chapter-item')
    .nth(1)
    .getByRole('button', { name: /Delete/ })
    .click();
  await expect(page.locator('.notice')).toContainText('is the target of "Go to part 2"');
  const after = await editorState(page);
  expect(after.course.chapters).toHaveLength(2);
  expect(after.chapterId).toBe(after.course.chapters[0]!.id);
});
