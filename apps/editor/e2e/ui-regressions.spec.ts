// SPDX-License-Identifier: AGPL-3.0-only
/** Regression tests for layout and interaction bugs (menus, scrolling, selection). */
import { expect, test, type Page } from '@playwright/test';
import { clips, openFresh, press, ribbon, setZoom } from './helpers.js';

/** Elements that show a scrollbar right now. */
function scrollbars(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('*')]
      .filter((e) => {
        const cs = getComputedStyle(e);
        return (
          (e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(cs.overflowY)) ||
          (e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(cs.overflowX))
        );
      })
      .map((e) => e.className),
  );
}

async function insideViewport(page: Page, selector: string) {
  const box = (await page.locator(selector).boundingBox())!;
  const size = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(size.width);
  expect(box.y + box.height).toBeLessThanOrEqual(size.height);
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 640 },
]) {
  test(`menus float without adding scrollbars (${size.width}×${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await openFresh(page);
    const before = await scrollbars(page);

    await ribbon(page, 'Insert');
    const button = page.getByRole('button', { name: 'New chapter' });
    await button.click();
    const menu = page.getByRole('menu', { name: 'New chapter' });
    await expect(menu).toBeVisible();
    await insideViewport(page, '.popover');
    expect(await scrollbars(page)).toEqual(before);
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(button).toBeFocused();

    await page.getByRole('button', { name: 'Add chapter' }).click();
    await expect(page.getByRole('menu', { name: 'Add chapter' })).toBeVisible();
    await insideViewport(page, '.popover');
    expect(await scrollbars(page)).toEqual(before);
    await page.locator('.stage-area').click({ position: { x: 5, y: 5 } });
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
}

test('side panels never scroll horizontally', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await openFresh(page);
  await ribbon(page, 'File');
  await press(page, 'Open example');
  await expect(page.locator('.tl-clip')).not.toHaveCount(0);
  const overflow = await page.evaluate(() =>
    ['.chapters', '.assets', '.inspector'].map((s) => {
      const el = document.querySelector<HTMLElement>(s)!;
      return el.scrollWidth - el.clientWidth;
    }),
  );
  expect(overflow).toEqual([0, 0, 0]);
});

test('track names stay readable next to the track buttons', async ({ page }) => {
  await openFresh(page);
  const name = page.locator('.tl-track-name').first();
  expect((await name.boundingBox())!.width).toBeGreaterThan(90);
});

test('dragging on the ruler, timeline and stage does not select text', async ({ page }) => {
  await openFresh(page);
  await press(page, 'Text');
  const ruler = (await page.locator('.tl-ruler').boundingBox())!;
  await page.mouse.move(ruler.x + 5, ruler.y + 10);
  await page.mouse.down();
  await page.mouse.move(ruler.x + 400, ruler.y + 60, { steps: 6 });
  await page.mouse.up();
  const stage = (await page.getByTestId('stage-overlay').boundingBox())!;
  await page.mouse.move(stage.x + 2, stage.y + 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width - 2, stage.y + stage.height - 2, { steps: 6 });
  await page.mouse.up();
  // Areas without their own drag handling: panel titles, track names, ribbon.
  const from = (await page.locator('.chapters .panel-title h2').boundingBox())!;
  const to = (await page.locator('.tl-track-name').last().boundingBox())!;
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 10 });
  await page.mouse.up();
  const ribbonBox = (await page.locator('.ribbon-panel').boundingBox())!;
  await page.mouse.move(ribbonBox.x + 4, ribbonBox.y + ribbonBox.height - 6);
  await page.mouse.down();
  await page.mouse.move(ribbonBox.x + ribbonBox.width / 2, ribbonBox.y + 10, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('');
});

test('selection handles at the stage edge are not clipped', async ({ page }) => {
  await openFresh(page);
  await press(page, 'Box');
  const [box] = await clips(page);
  await page.evaluate((id) => {
    const s = window.__session!.store.getState();
    s.execute('test', (draft) => {
      for (const t of draft.chapters[0]!.tracks)
        for (const c of t.clips)
          if (c.id === id && c.type === 'box') c.frame = { x: 0, y: 0, width: 400, height: 300 };
    });
    s.select([id]);
  }, box!.id);
  const handle = (await page.locator('.stage-handle-nw').boundingBox())!;
  const visible = await page.evaluate(() => {
    const el = document.querySelector('.stage-handle-nw')!;
    const r = el.getBoundingClientRect();
    return document.elementFromPoint(r.left + 2, r.top + 2) === el;
  });
  expect(handle.width).toBeGreaterThan(8);
  expect(visible).toBe(true);
});

test('selecting a clip on the stage scrolls the timeline to it', async ({ page }) => {
  await openFresh(page);
  await page.evaluate(() => window.__session!.store.getState().setPlayhead(9000));
  await press(page, 'Box');
  await setZoom(page, 400);
  await page.locator('.tl-scroll').evaluate((el) => (el.scrollLeft = 0));
  await page.keyboard.press('Escape');
  const overlay = (await page.getByTestId('stage-overlay').boundingBox())!;
  await page.mouse.click(overlay.x + overlay.width / 2, overlay.y + overlay.height / 2);
  const [clip] = await clips(page);
  const clipBox = (await page.locator(`.tl-clip[data-clip-id="${clip!.id}"]`).boundingBox())!;
  const lane = (await page.locator('.tl-scroll').boundingBox())!;
  expect(clipBox.x).toBeGreaterThanOrEqual(lane.x + 190);
  expect(clipBox.x).toBeLessThan(lane.x + lane.width);
});
