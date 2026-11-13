// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';
import { openFixture, state, visibleText } from './fixture.js';

test.describe('playback', () => {
  test('plays in real time and switches clips at exact times', async ({ page }) => {
    await openFixture(page);
    await expect.poll(() => visibleText(page)).toEqual(['Alpha']);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.runFor(1500);
    const s = await state(page);
    expect(s.status).toBe('playing');
    // Within one animation frame of the requested time.
    expect(s.time).toBeGreaterThanOrEqual(1480);
    expect(s.time).toBeLessThanOrEqual(1520);
    await expect.poll(() => visibleText(page)).toEqual(['Bravo']);
  });

  test('seeking always produces the same picture', async ({ page }) => {
    await openFixture(page);
    const seekAndRead = async (t: number) => {
      await page.evaluate((time) => window.__player!.seek(time), t);
      return visibleText(page);
    };
    const first = await seekAndRead(999);
    await seekAndRead(2500);
    await seekAndRead(0);
    expect(await seekAndRead(999)).toEqual(first);
    expect(first).toEqual(['Alpha']);
    expect(await seekAndRead(1000)).toEqual(['Bravo']);
    // Last frame is held at the chapter end.
    expect(await seekAndRead(3000)).toEqual(['Bravo']);
  });

  test('waits for Continue, then auto-advances, then completes', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.runFor(3500);
    expect(await state(page)).toMatchObject({
      chapterIndex: 0,
      status: 'waiting',
      seen: [true, false, false],
    });

    const cont = page.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeVisible();
    await cont.click();
    expect(await state(page)).toMatchObject({ chapterIndex: 1, status: 'playing' });
    await expect(page.locator('.ccp-title')).toHaveText('Chapter 2 of 3: Second');

    // Chapter 2 continues automatically into chapter 3.
    await page.clock.runFor(2300);
    expect(await state(page)).toMatchObject({ chapterIndex: 2, status: 'playing' });

    await page.clock.runFor(1500);
    expect(await state(page)).toMatchObject({
      status: 'ended',
      complete: true,
      seen: [true, true, true],
    });
    await expect(page.locator('#status')).toContainText('complete');
  });

  test('pausing stops time', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.runFor(500);
    await page.getByRole('button', { name: 'Pause' }).click();
    const t = (await state(page)).time;
    await page.clock.runFor(2000);
    expect((await state(page)).time).toBe(t);
  });
});

test.describe('progress', () => {
  test('restores chapter, position and seen chapters after reload', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.runFor(3200);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.clock.runFor(700);
    await page.getByRole('button', { name: 'Pause' }).click();
    const before = await state(page);

    await page.reload();
    await page.getByRole('button', { name: 'Resume' }).waitFor();
    const after = await state(page);
    expect(after.chapterIndex).toBe(1);
    expect(after.seen).toEqual([true, false, false]);
    expect(after.time).toBe(Math.floor(before.time / 100) * 100);
  });
});

test.describe('keyboard and accessibility', () => {
  test('controls are reachable and operable by keyboard', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Start' }).focus();
    await page.keyboard.press('Enter');
    expect((await state(page)).status).toBe('playing');

    await page.getByRole('button', { name: 'Pause' }).focus();
    await page.keyboard.press('k');
    expect((await state(page)).status).toBe('paused');

    await page.keyboard.press('ArrowRight');
    expect((await state(page)).time).toBeGreaterThanOrEqual(3000);

    await page.keyboard.press('n');
    expect((await state(page)).chapterIndex).toBe(1);
    await page.keyboard.press('p');
    expect((await state(page)).chapterIndex).toBe(0);
  });

  test('moves focus to Continue at the end of a chapter', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.getByRole('button', { name: 'Pause' }).focus();
    await page.keyboard.press('k');
    await page.keyboard.press('k');
    await page.clock.runFor(3500);
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  });

  test('stage is a labelled region and the seek bar has a text value', async ({ page }) => {
    await openFixture(page);
    await expect(page.getByRole('region', { name: 'E2E fixture' })).toBeVisible();
    await page.evaluate(() => window.__player!.seek(1500));
    await expect(page.getByRole('slider', { name: 'Position in chapter' })).toHaveAttribute(
      'aria-valuetext',
      '0:01 of 0:03',
    );
  });
});

test.describe('table of contents', () => {
  test('lists chapters and markers, jumps, and closes with Escape', async ({ page }) => {
    await openFixture(page);
    const button = page.getByRole('button', { name: 'Contents' });
    await button.click();
    const toc = page.getByRole('navigation', { name: 'Contents' });
    await expect(toc).toBeVisible();
    await expect(toc.getByRole('button', { name: /First/ })).toBeFocused();
    await toc.getByRole('button', { name: 'Halfway' }).click();
    expect(await state(page)).toMatchObject({ chapterIndex: 0, time: 2000 });
    await expect(toc).toBeHidden();
    await expect(page.locator('.ccp-tick')).toHaveCount(1);

    await button.click();
    await page.keyboard.press('Escape');
    await expect(toc).toBeHidden();
    await expect(button).toBeFocused();

    await page.keyboard.press('t');
    await toc.getByRole('button', { name: /Third/ }).click();
    expect((await state(page)).chapterIndex).toBe(2);
  });

  test('marks seen chapters', async ({ page }) => {
    await openFixture(page);
    await page.getByRole('button', { name: 'Start' }).click();
    await page.clock.runFor(3200);
    await page.getByRole('button', { name: 'Contents' }).click();
    await expect(
      page
        .getByRole('navigation', { name: 'Contents' })
        .getByRole('button', { name: /First.*completed/ }),
    ).toBeVisible();
  });
});

test.describe('example course', () => {
  test('loads the welcome example with media and captions', async ({ page }) => {
    await page.goto('/?course=welcome');
    await expect(page.getByRole('heading', { name: 'Welcome to Clipcourse' })).toBeVisible();
    await page.evaluate(() => window.__player!.goToChapter(2, 1000));
    await expect(page.locator('video')).toHaveCount(1);
    await expect(page.locator('audio')).toHaveCount(1);
    const cc = page.getByRole('button', { name: 'Turn captions on' });
    await expect(cc).toBeVisible();
    await page.locator('.ccp-time').click();
    await page.keyboard.press('c');
    await expect(page.getByRole('button', { name: 'Turn captions off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.ccp-captions')).toHaveText('This is a video clip on the timeline.');
  });

  test('the stage keeps its aspect ratio', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto('/?course=welcome');
    const box = await page.locator('.ccp-stage').boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(16 / 9, 2);
  });
});
