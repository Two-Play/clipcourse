// SPDX-License-Identifier: AGPL-3.0-only
import type { Course } from '@clipcourse/format';
import { expect, test, type Page } from '@playwright/test';
import { clips, editorState, openFresh, press, ribbon } from './helpers.js';

const chapterTitles = async (page: Page) =>
  ((await editorState(page)).course as Course).chapters.map((c) => c.title);

test.describe('chapters', () => {
  test('add from a template, rename, reorder, duplicate, delete', async ({ page }) => {
    await openFresh(page);
    page.on('dialog', (d) => void d.accept());
    const panel = page.getByRole('region', { name: 'Chapters' });

    await panel.getByText('Add chapter', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Title', exact: true }).click();
    expect(await chapterTitles(page)).toEqual(['Chapter 1', 'Title']);
    // The new chapter is opened and has the template's clips.
    expect((await clips(page)).map((c) => c.type)).toEqual(['text', 'text']);

    await panel.getByRole('button', { name: /^2\.\s*Title/ }).dblclick();
    await panel.getByLabel('Rename chapter').fill('Intro');
    await panel.getByLabel('Rename chapter').press('Enter');
    expect(await chapterTitles(page)).toEqual(['Chapter 1', 'Intro']);

    await panel.getByRole('button', { name: 'Move chapter up: Intro' }).click();
    expect(await chapterTitles(page)).toEqual(['Intro', 'Chapter 1']);

    await panel.getByRole('button', { name: 'Duplicate chapter: Intro' }).click();
    expect(await chapterTitles(page)).toEqual(['Intro', 'Intro (copy)', 'Chapter 1']);
    const state = await editorState(page);
    expect(state.course.chapters[1]!.id).toBe(state.chapterId);

    await panel.getByRole('button', { name: 'Delete chapter: Intro (copy)' }).click();
    expect(await chapterTitles(page)).toEqual(['Intro', 'Chapter 1']);
    await page.locator('.tl-ruler').click({ position: { x: 5, y: 10 } });
    await page.keyboard.press('Control+z');
    expect(await chapterTitles(page)).toEqual(['Intro', 'Intro (copy)', 'Chapter 1']);
  });

  test('save a chapter as a template and reuse it', async ({ page }) => {
    await openFresh(page);
    page.on('dialog', (d) => void d.accept('My layout'));
    await press(page, 'Box');
    await page.getByRole('button', { name: 'Save as template' }).click();
    await expect(page.getByRole('status')).toContainText('Saved “My layout”');

    await page.getByText('Add chapter', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'My layout' }).click();
    const { course, chapterId } = await editorState(page);
    expect(course.chapters).toHaveLength(2);
    expect(course.chapters[1]!.id).toBe(chapterId);
    expect((await clips(page)).map((c) => c.type)).toEqual(['box']);
    // Ids are fresh.
    expect(course.chapters[1]!.tracks[0]!.id).not.toBe(course.chapters[0]!.tracks[0]!.id);
  });
});

test.describe('course layer, markers, animations, highlights', () => {
  test('a progress bar in the course layer appears in every chapter', async ({ page }) => {
    await openFresh(page);
    await ribbon(page, 'Insert');
    await press(page, 'Progress bar');
    const { course } = await editorState(page);
    expect(course.courseLayer?.foreground[0]!.clips[0]!.type).toBe('progress');
    await expect(page.locator('.tl-row.is-course')).toHaveCount(1);
    await expect(page.locator('.stage-canvas .ccp-clip-progress')).toBeVisible();

    await page.getByText('Add chapter', { exact: true }).click();
    await page.getByRole('menuitem', { name: 'Blank chapter' }).click();
    await expect(page.locator('.stage-canvas .ccp-clip-progress')).toBeVisible();
    await expect(page.locator('.tl-row.is-course')).toHaveCount(1);
  });

  test('clips cannot be dragged between a chapter track and an all-chapters track', async ({
    page,
  }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Add track for all chapters' }).click();
    await press(page, 'Box');
    const before = (await clips(page))[0]!;
    const clip = (await page.locator('.tl-clip').first().boundingBox())!;
    const courseLane = (await page.locator('.tl-row.is-course .tl-lane').boundingBox())!;
    await page.mouse.move(clip.x + 30, clip.y + clip.height / 2);
    await page.mouse.down();
    await page.mouse.move(clip.x + 30, courseLane.y + courseLane.height / 2, { steps: 6 });
    await page.mouse.up();
    expect((await clips(page))[0]!.trackId).toBe(before.trackId);
  });

  test('markers: add at the playhead, move with the keyboard, delete', async ({ page }) => {
    await openFresh(page);
    await page.evaluate(() => window.__session!.store.getState().setPlayhead(2000));
    await page.getByRole('button', { name: 'Add marker' }).click();
    const marker = page.locator('.tl-marker');
    await expect(marker).toHaveCount(1);
    await marker.focus();
    await page.keyboard.press('Shift+ArrowRight');
    let chapter = (await editorState(page)).course.chapters[0]!;
    expect(chapter.markers).toEqual([expect.objectContaining({ time: 3000, title: 'Marker 1' })]);
    await page.keyboard.press('Delete');
    chapter = (await editorState(page)).course.chapters[0]!;
    expect(chapter.markers).toBeUndefined();
  });

  test('entrance animation and highlight settings', async ({ page }) => {
    await openFresh(page);
    await press(page, 'Highlight');
    await page.getByLabel('Style').selectOption('spotlight');
    await page.getByLabel('Pulse to draw attention').check();
    await page.getByLabel('Entrance', { exact: true }).selectOption('slide');
    await page.getByLabel('Entrance: Direction').selectOption('up');
    const clip = (await clips(page))[0]!;
    expect(clip).toMatchObject({
      type: 'highlight',
      kind: 'spotlight',
      pulse: true,
      animations: { in: { type: 'slide', direction: 'up', duration: 500 } },
    });
    // At the clip start the highlight is still off stage (slide from above).
    await page.evaluate(() => window.__session!.store.getState().setPlayhead(0));
    const transform = await page
      .locator('.stage-canvas .ccp-clip-highlight')
      .evaluate((el) => (el as HTMLElement).style.transform);
    expect(transform).toMatch(/translate\(0px, -\d+px\)/);
    await page.getByLabel('Entrance', { exact: true }).selectOption('none');
    expect((await clips(page))[0]).not.toHaveProperty('animations');
  });

  test('preview shows the table of contents with markers', async ({ page }) => {
    await openFresh(page);
    await ribbon(page, 'File');
    await press(page, 'Open example');
    await expect(page.locator('.tl-clip')).not.toHaveCount(0);
    await page.evaluate(() => window.__session!.store.getState().setPlayhead(4000));
    await page.getByRole('button', { name: 'Add marker' }).click();
    await press(page, 'Preview');
    const dialog = page.getByRole('dialog', { name: 'Preview' });
    await dialog.getByRole('button', { name: 'Contents' }).click();
    const toc = dialog.getByRole('navigation', { name: 'Contents' });
    await expect(toc.getByRole('button', { name: /Video, audio and captions/ })).toBeVisible();
    await toc.getByRole('button', { name: 'Marker 1' }).click();
    const state = await page.evaluate(() =>
      (
        window as unknown as { __preview: { getState(): { chapterIndex: number; time: number } } }
      ).__preview.getState(),
    );
    expect(state).toEqual(expect.objectContaining({ chapterIndex: 0, time: 4000 }));
  });
});
