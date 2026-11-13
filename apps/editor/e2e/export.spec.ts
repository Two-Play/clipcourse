// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { openFresh, press, ribbon } from './helpers.js';

const logo = fileURLToPath(new URL('../../../examples/welcome/assets/logo.svg', import.meta.url));

const MIME: Record<string, string> = {
  html: 'text/html',
  js: 'text/javascript',
  svg: 'image/svg+xml',
  xml: 'application/xml',
};

/** Builds a two-chapter course in the editor and exports it. */
async function exportCourse(page: Page, version: '1.2' | '2004') {
  await openFresh(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import media…' }).first().click();
  await (await chooser).setFiles(logo);
  await page
    .locator('.asset[data-asset-id="logo"]')
    .getByRole('button', { name: /Add logo.svg/ })
    .click();
  await page.keyboard.press('Escape');
  await page.getByLabel('Duration (s)').fill('2');
  await page.getByLabel('Duration (s)').press('Enter');
  await page.getByText('Add chapter', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'Blank chapter' }).click();
  await page.getByLabel('Duration (s)').fill('1');
  await page.getByLabel('Duration (s)').press('Enter');

  await ribbon(page, 'File');
  await press(page, 'Export SCORM');
  const dialog = page.getByRole('dialog', { name: 'Export for an LMS (SCORM)' });
  await dialog.getByLabel(version === '1.2' ? /SCORM 1\.2/ : /SCORM 2004/).check();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  const file = await (await download).path();
  await expect(dialog.getByText(/Downloaded/)).toBeVisible();
  return unzipSync(new Uint8Array(readFileSync(file)));
}

async function serve(page: Page, files: Record<string, Uint8Array>) {
  await page.route('**/pkg/**', (route) => {
    const path = decodeURIComponent(
      new URL(route.request().url()).pathname.replace(/^\/pkg\//, ''),
    );
    const body = files[path];
    if (!body) return route.fulfill({ status: 404 });
    return route.fulfill({
      body: Buffer.from(body),
      contentType: MIME[path.split('.').pop()!] ?? 'application/octet-stream',
    });
  });
}

/**
 * Freezes the page clock. Call it while nothing is playing: the clock jumps
 * ahead by a safe margin (so a busy machine cannot make the target lie in
 * the past) and from then on only runFor() advances it.
 */
async function freeze(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1000);
}

const lmsValue = (page: Page, key: string) =>
  page.evaluate((k) => window.lms!.record.data[k] ?? '', key);

for (const version of ['1.2', '2004'] as const) {
  test(`SCORM ${version}: exported package runs in an LMS frame, resumes and completes`, async ({
    page,
  }) => {
    const files = await exportCourse(page, version);
    expect(strFromU8(files['imsmanifest.xml']!)).toContain(
      version === '1.2' ? '<schemaversion>1.2</schemaversion>' : '2004 4th Edition',
    );
    await serve(page, files);

    await page.clock.install();
    await page.goto(`/lms-harness.html?version=${version}`);
    const course = page.frameLocator('#sco');
    await expect(course.getByRole('button', { name: 'Start' })).toBeVisible();
    await freeze(page);
    await course.getByRole('button', { name: 'Start' }).click();
    // Media from the package loads through relative URLs.
    await expect
      .poll(() =>
        course
          .locator('.ccp-clip-image img')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);

    await page.clock.runFor(2300);
    await expect(course.getByRole('button', { name: 'Continue' })).toBeVisible();
    const status = version === '1.2' ? 'cmi.core.lesson_status' : 'cmi.completion_status';
    expect(await lmsValue(page, status)).toBe('incomplete');
    if (version === '2004') expect(await lmsValue(page, 'cmi.progress_measure')).toBe('0.5');

    // Close the course (like leaving the LMS page) and launch it again.
    await page.reload();
    expect(await lmsValue(page, version === '1.2' ? 'cmi.core.exit' : 'cmi.exit')).toBe('suspend');
    const resumed = page.frameLocator('#sco');
    await expect(resumed.getByRole('button', { name: 'Resume' })).toBeVisible();
    expect(
      await page.evaluate(
        () => window.lms!.values[Object.keys(window.lms!.values).find((k) => k.endsWith('entry'))!],
      ),
    ).toBe('resume');

    await freeze(page);
    await resumed.getByRole('button', { name: 'Resume' }).click();
    await page.clock.runFor(2500);
    await expect.poll(() => lmsValue(page, status)).toBe('completed');
  });
}

test('preview simulates an LMS and shows what it stores', async ({ page }) => {
  await openFresh(page);
  await press(page, 'Text');
  await press(page, 'Preview');
  const dialog = page.getByRole('dialog', { name: 'Preview' });
  await dialog.getByLabel('LMS simulation').selectOption('2004');
  const panel = dialog.getByRole('complementary', { name: 'LMS simulation' });
  await expect(panel.locator('[data-lms-key="Status"]')).toHaveText('incomplete');
  await expect(panel.locator('[data-lms-key="Entry"]')).toHaveText('ab-initio');
  await page.evaluate(() => {
    window.__preview!.seek(5000);
    window.__preview!.pause();
    window.__preview!.saveProgress();
  });
  await dialog.getByRole('button', { name: 'Close and relaunch' }).click();
  await expect(panel.locator('[data-lms-key="Entry"]')).toHaveText('resume');
  await expect(panel.locator('[data-lms-key="suspend_data"]')).toContainText('1~0~1e~');
  expect(await page.evaluate(() => window.__preview!.getState().time)).toBe(5000);
});
