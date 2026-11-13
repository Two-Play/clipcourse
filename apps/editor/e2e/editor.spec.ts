// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { clips, drag, editorState, openFresh, setZoom } from './helpers.js';

const exampleDir = fileURLToPath(new URL('../../../examples/welcome/assets/', import.meta.url));

test.describe('adding and editing clips', () => {
  test('adds a text clip, edits it in the inspector, undo and redo', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Text' }).click();
    const [clip] = await clips(page);
    expect(clip).toMatchObject({ type: 'text', start: 0, duration: 3000 });
    await expect(page.locator(`.tl-clip[data-clip-id="${clip!.id}"]`)).toHaveClass(/is-selected/);
    await expect(page.locator('.stage-canvas .ccp-text')).toHaveText('New text');

    const textarea = page.getByLabel('Text', { exact: true });
    await textarea.fill('Hello learners');
    await expect(page.locator('.stage-canvas .ccp-text')).toHaveText('Hello learners');

    await page.locator('.tl-ruler').click({ position: { x: 5, y: 10 } }); // focus out of the field
    await page.keyboard.press('Control+z');
    await expect(page.locator('.stage-canvas .ccp-text')).toHaveText('New text');
    await page.keyboard.press('Control+z');
    expect(await clips(page)).toHaveLength(0);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator('.stage-canvas .ccp-text')).toHaveText('Hello learners');
  });

  test('new clips go to the playhead and never overlap', async ({ page }) => {
    await openFresh(page);
    await page.evaluate(() => window.__session!.store.getState().setPlayhead(1000));
    await page.getByRole('button', { name: '＋ Text' }).click();
    await page.getByRole('button', { name: '＋ Text' }).click();
    const all = await clips(page);
    expect(all.map((c) => c.start)).toEqual([1000, 1000]);
    expect(new Set(all.map((c) => c.trackId)).size).toBe(2);
  });

  test('delete removes the selection, Ctrl+Z restores it', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Box' }).click();
    await page.locator('.tl-clip').first().click();
    await page.keyboard.press('Delete');
    expect(await clips(page)).toHaveLength(0);
    await page.keyboard.press('Control+z');
    expect(await clips(page)).toHaveLength(1);
  });

  test('split and duplicate', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Box' }).click();
    await page.evaluate(() => window.__session!.store.getState().setPlayhead(1000));
    await page.keyboard.press('s');
    expect((await clips(page)).map((c) => [c.start, c.duration])).toEqual([
      [0, 1000],
      [1000, 2000],
    ]);
    await page.keyboard.press('Control+d');
    expect((await clips(page)).map((c) => c.start)).toEqual([0, 1000, 3000]);
  });
});

test.describe('timeline drags', () => {
  test('moves a clip with snapping off, one undo step', async ({ page }) => {
    await openFresh(page);
    await setZoom(page, 100);
    await page.getByLabel('Snap').uncheck();
    await page.getByRole('button', { name: '＋ Box' }).click();
    const box = (await page.locator('.tl-clip').first().boundingBox())!;
    const y = box.y + box.height / 2;
    await drag(page, { x: box.x + box.width / 2, y }, { x: box.x + box.width / 2 + 200, y });
    expect((await clips(page))[0]!.start).toBe(2000);
    const state = await editorState(page);
    expect(state.undo).toBe(2); // add + move
    await page.keyboard.press('Control+z');
    expect((await clips(page))[0]!.start).toBe(0);
  });

  test('snaps to the playhead', async ({ page }) => {
    await openFresh(page);
    await setZoom(page, 100);
    await page.getByRole('button', { name: '＋ Box' }).click();
    await page.evaluate(() => window.__session!.store.getState().setPlayhead(5000));
    const box = (await page.locator('.tl-clip').first().boundingBox())!;
    const y = box.y + box.height / 2;
    // 497 px ≈ 4970 ms: within the 8 px snap distance of the playhead at 5000 ms.
    await drag(page, { x: box.x + 50, y }, { x: box.x + 50 + 497, y });
    expect((await clips(page))[0]!.start).toBe(5000);
  });

  test('trims the end of a clip', async ({ page }) => {
    await openFresh(page);
    await setZoom(page, 100);
    await page.getByLabel('Snap').uncheck();
    await page.getByRole('button', { name: '＋ Box' }).click();
    const box = (await page.locator('.tl-clip').first().boundingBox())!;
    const y = box.y + box.height / 2;
    await drag(page, { x: box.x + box.width - 2, y }, { x: box.x + box.width - 2 + 150, y });
    expect((await clips(page))[0]!.duration).toBe(4500);
  });

  test('moves a clip to another track', async ({ page }) => {
    await openFresh(page);
    await setZoom(page, 100);
    await page.getByRole('button', { name: '＋ Box' }).click();
    const before = (await clips(page))[0]!;
    const lanes = page.locator('.tl-lane');
    const target = await lanes.nth(1).getAttribute('data-lane-track-id');
    expect(target).not.toBe(before.trackId);
    const box = (await page.locator('.tl-clip').first().boundingBox())!;
    const targetBox = (await lanes.nth(1).boundingBox())!;
    await drag(
      page,
      { x: box.x + 50, y: box.y + box.height / 2 },
      { x: box.x + 50, y: targetBox.y + targetBox.height / 2 },
    );
    expect((await clips(page))[0]!.trackId).toBe(target);
  });

  test('Escape cancels a drag', async ({ page }) => {
    await openFresh(page);
    await setZoom(page, 100);
    await page.getByRole('button', { name: '＋ Box' }).click();
    const box = (await page.locator('.tl-clip').first().boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + 50, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, y, { steps: 5 });
    expect((await clips(page))[0]!.start).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect((await clips(page))[0]!.start).toBe(0);
    expect((await editorState(page)).undo).toBe(1);
  });

  test('keyboard moves a focused clip', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Box' }).click();
    await page.locator('.tl-clip').first().focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await clips(page))[0]!.start).toBe(1100);
    await page.keyboard.press('Alt+ArrowRight');
    expect((await clips(page))[0]!.duration).toBe(3100);
  });

  test('clicking the ruler moves the playhead; dragging the chapter end changes the length', async ({
    page,
  }) => {
    await openFresh(page);
    await setZoom(page, 100);
    await page.getByLabel('Snap').uncheck();
    const ruler = (await page.locator('.tl-ruler').boundingBox())!;
    await page.mouse.click(ruler.x + 300, ruler.y + 10);
    expect((await editorState(page)).playhead).toBe(3000);

    const end = (await page.getByTestId('chapter-end').boundingBox())!;
    await drag(
      page,
      { x: end.x + end.width / 2, y: end.y + 60 },
      { x: ruler.x + 1500, y: end.y + 60 },
    );
    const { course } = await editorState(page);
    expect(course.chapters[0]!.duration).toBe(15000);
  });
});

test.describe('stage', () => {
  test('clicking selects, dragging moves the frame', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Box' }).click();
    await page.keyboard.press('Escape');
    const clip = (await clips(page))[0]!;
    expect((await editorState(page)).selection).toEqual([]);
    const overlay = page.getByTestId('stage-overlay');
    const rect = (await overlay.boundingBox())!;
    const scale = rect.width / 1920;
    if (clip.type !== 'box') throw new Error('expected box');
    const cx = rect.x + (clip.frame.x + clip.frame.width / 2) * scale;
    const cy = rect.y + (clip.frame.y + clip.frame.height / 2) * scale;
    await drag(page, { x: cx, y: cy }, { x: cx + 100 * scale, y: cy + 50 * scale });
    const moved = (await clips(page))[0]!;
    if (moved.type !== 'box') throw new Error('expected box');
    expect(moved.frame.x).toBeCloseTo(clip.frame.x + 100, -1);
    expect(moved.frame.y).toBeCloseTo(clip.frame.y + 50, -1);
    expect((await editorState(page)).selection).toEqual([clip.id]);
  });

  test('corner handle resizes, arrow keys nudge', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Box' }).click();
    const clip = (await clips(page))[0]!;
    if (clip.type !== 'box') throw new Error('expected box');
    const handle = (await page.locator('.stage-handle-se').boundingBox())!;
    const scale = (await page.getByTestId('stage-overlay').boundingBox())!.width / 1920;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await drag(page, { x: hx, y: hy }, { x: hx + 200 * scale, y: hy + 100 * scale });
    let next = (await clips(page))[0]!;
    if (next.type !== 'box') throw new Error('expected box');
    expect(next.frame.width).toBeCloseTo(clip.frame.width + 200, -1);
    expect(next.frame.height).toBeCloseTo(clip.frame.height + 100, -1);

    await page.getByTestId('stage-overlay').focus();
    await page.keyboard.press('Shift+ArrowLeft');
    next = (await clips(page))[0]!;
    if (next.type !== 'box') throw new Error('expected box');
    expect(next.frame.x).toBe(clip.frame.x - 10);
  });
});

test.describe('media and files', () => {
  test('imports an image, places it by drag and drop', async ({ page }) => {
    await openFresh(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import media…' }).first().click();
    await (await chooser).setFiles(`${exampleDir}logo.svg`);
    const asset = page.locator('.asset[data-asset-id="logo"]');
    await expect(asset).toBeVisible();
    await asset.dragTo(page.locator('.tl-lane').first(), { targetPosition: { x: 200, y: 20 } });
    const placed = (await clips(page)).find((c) => c.type === 'image');
    expect(placed).toBeDefined();
    await expect(page.locator('.stage-canvas img')).toHaveCount(1);
  });

  test('save downloads a zip that opens again', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Open example' }).click();
    await expect(page.locator('.tl-clip')).not.toHaveCount(0);
    const before = (await editorState(page)).course;

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /^Save( •)?$/ }).click();
    const file = await (await download).path();
    expect(file).toBeTruthy();

    await page.getByRole('button', { name: 'New' }).click();
    expect((await editorState(page)).course.title).toBe('Untitled course');

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open…' }).click();
    await (
      await chooser
    ).setFiles({ name: 'course.zip', mimeType: 'application/zip', buffer: readFileSync(file) });
    await expect
      .poll(async () => (await editorState(page)).course.title)
      .toBe('Welcome to Clipcourse');
    expect((await editorState(page)).course).toEqual(before);
  });

  test('reports a broken project file', async ({ page }) => {
    await openFresh(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open…' }).click();
    await (
      await chooser
    ).setFiles({ name: 'broken.zip', mimeType: 'application/zip', buffer: Buffer.from('nope') });
    await expect(page.getByRole('status')).toContainText('not a valid .zip');
  });

  test('restores the working copy after a reload', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: '＋ Text' }).click();
    await page.getByLabel('Text', { exact: true }).fill('Survives reload');
    await page.waitForTimeout(1200); // autosave debounce
    await page.goto('/');
    await expect(page.getByRole('status')).toContainText('restored');
    await expect(page.locator('.stage-canvas .ccp-text')).toHaveText('Survives reload');
  });
});

test.describe('playback and preview', () => {
  test('space plays from the playhead and stops at the chapter end', async ({ page }) => {
    await page.clock.install();
    await openFresh(page);
    await page.clock.pauseAt(Date.now() + 1000);
    await page.getByRole('button', { name: '＋ Text' }).click();
    await page.locator('.tl-ruler').click({ position: { x: 5, y: 10 } });
    await page.keyboard.press('Space');
    await page.clock.runFor(2000);
    const playhead = (await editorState(page)).playhead;
    // Within a few animation frames of the requested time.
    expect(playhead).toBeGreaterThanOrEqual(1950);
    expect(playhead).toBeLessThanOrEqual(2060);
    await page.clock.runFor(10000);
    const state = await editorState(page);
    expect(state.playhead).toBe(10000);
    await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  });

  test('preview plays the course in the real player', async ({ page }) => {
    await openFresh(page);
    await page.getByRole('button', { name: 'Open example' }).click();
    await expect(page.locator('.tl-clip')).not.toHaveCount(0);
    await page.getByRole('button', { name: '▶ Preview' }).click();
    const dialog = page.getByRole('dialog', { name: 'Preview' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Welcome to Clipcourse' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Start|Resume/ })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close preview' }).click();
    await expect(dialog).toBeHidden();
  });
});
