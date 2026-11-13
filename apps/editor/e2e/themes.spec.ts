// SPDX-License-Identifier: AGPL-3.0-only
import type { Course } from '@clipcourse/format';
import { expect, test } from '@playwright/test';
import { clips, editorState, openFresh, press, ribbon } from './helpers.js';

test('a course from a template with a theme; switching the theme restyles the stage', async ({
  page,
}) => {
  await openFresh(page);
  await ribbon(page, 'File');
  await press(page, 'New');
  const gallery = page.getByRole('dialog', { name: 'New course' });
  await gallery.locator('label.gallery-card', { hasText: 'Onboarding' }).click();
  // The template suggests its theme; the author picks another one.
  await expect(gallery.getByRole('radio', { name: 'Light' })).toBeChecked();
  await gallery.locator('label.theme-option', { hasText: 'Warm' }).click();
  await expect(gallery.getByRole('radio', { name: 'Warm' })).toBeChecked();
  await expect(gallery.locator('.course-thumb .ccp-stage')).toHaveCount(4);
  await gallery.getByRole('button', { name: 'Create course' }).click();
  await expect(gallery).toBeHidden();

  let { course } = await editorState(page);
  expect((course as Course).title).toBe('Welcome aboard');
  expect((course as Course).theme?.preset).toBe('warm');
  expect((course as Course).chapters.map((c) => c.title)).toEqual([
    'Welcome',
    'Who we are',
    'Our products',
    'Knowledge check',
    'Summary',
  ]);
  const stage = page.locator('.stage-host .ccp-stage');
  await expect(stage).toHaveCSS('background-color', 'rgb(255, 248, 240)');

  await ribbon(page, 'Design');
  await page.getByRole('button', { name: 'High contrast' }).click();
  await expect(page.getByRole('button', { name: 'High contrast' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(stage).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  ({ course } = await editorState(page));
  expect((course as Course).theme?.colors.accent).toBe('#ffd400');
  // Undo brings the previous theme back.
  await page.locator('.stage-overlay').focus();
  await page.keyboard.press('Control+z');
  await expect(stage).toHaveCSS('background-color', 'rgb(255, 248, 240)');
});

test('new clips use theme roles; the color field offers roles and custom colors', async ({
  page,
}) => {
  await openFresh(page);
  await press(page, 'Box');
  const box = (await clips(page)).find((c) => c.type === 'box')!;
  expect(box).toMatchObject({ fill: 'theme:surface', style: { color: 'theme:text' } });
  const inspector = page.getByRole('complementary', { name: 'Properties' });
  const fill = inspector.getByLabel('Fill', { exact: true });
  await expect(fill).toHaveValue('theme:surface');
  await fill.selectOption('theme:accent');
  expect((await clips(page)).find((c) => c.id === box.id)).toMatchObject({ fill: 'theme:accent' });
  await fill.selectOption('custom');
  const custom = (await clips(page)).find((c) => c.id === box.id) as { fill: string };
  expect(custom.fill).toMatch(/^#[0-9a-f]{6}$/i);
  await expect(inspector.getByLabel('Fill: Custom color')).toBeVisible();
});
