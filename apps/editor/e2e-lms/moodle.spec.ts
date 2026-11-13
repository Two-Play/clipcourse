// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Uploads exported packages to a real Moodle and checks launch, media,
 * resume and completion. Runs only when MOODLE_URL is set:
 *
 *   MOODLE_URL=http://localhost:8081 MOODLE_USER=admin MOODLE_PASS=… \
 *     pnpm --filter @clipcourse/editor test:lms
 */
import { expect, test, type FrameLocator, type Page } from '@playwright/test';
import { buildPackage } from './package.js';

const url = process.env.MOODLE_URL;
const user = process.env.MOODLE_USER ?? 'admin';
const pass = process.env.MOODLE_PASS ?? '';

test.skip(!url, 'Set MOODLE_URL to run Moodle tests');

async function login(page: Page) {
  await page.goto(`${url}/login/index.php`);
  // The login page enhances its form with JavaScript after loading.
  await page.waitForLoadState('networkidle');
  const username = page.locator('#username');
  // Already logged in: Moodle redirects away from the login form.
  if (
    !(await username.isVisible({ timeout: 5000 }).catch(() => false)) &&
    !page.url().includes('login')
  )
    return;
  await page.locator('#username').fill(user);
  await page.locator('#password').fill(pass);
  await page.locator('#loginbtn').click();
  await page.waitForLoadState('networkidle');
  if (page.url().includes('/login/')) {
    const alerts = await page.locator('.alert, .loginerrors').allTextContents();
    throw new Error(`Moodle login failed at ${page.url()}: ${alerts.join(' ').trim()}`);
  }
}

async function createCourse(page: Page, name: string): Promise<string> {
  await page.goto(`${url}/course/edit.php?category=1`);
  await page.locator('#id_fullname').fill(name);
  await page.locator('#id_shortname').fill(name);
  await page.locator('#id_saveanddisplay').click();
  await expect(page).toHaveURL(/course\/view\.php\?id=\d+/);
  return new URL(page.url()).searchParams.get('id')!;
}

async function addScorm(page: Page, courseId: string, name: string, zip: Buffer): Promise<void> {
  await page.goto(
    `${url}/course/modedit.php?add=scorm&type=&course=${courseId}&section=0&return=0`,
  );
  await page.locator('#id_name').fill(name);
  await page
    .locator('#fitem_id_packagefile .fp-btn-add, #fitem_id_packagefile [title="Add..."]')
    .first()
    .click();
  await page.getByRole('link', { name: 'Upload a file' }).click();
  await page
    .locator('input[type="file"][name="repo_upload_file"]')
    .setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip });
  await page.getByRole('button', { name: 'Upload this file' }).click();
  await expect(page.locator('#fitem_id_packagefile .fp-filename').first()).toContainText(
    `${name}.zip`,
    { timeout: 30000 },
  );
  await page.locator('#id_submitbutton').click();
  await expect(page).toHaveURL(/mod\/scorm\/view\.php\?id=\d+/);
}

async function enter(page: Page): Promise<FrameLocator> {
  await page.getByRole('button', { name: 'Enter' }).click();
  await expect(page).toHaveURL(/mod\/scorm\/player\.php/);
  return page.frameLocator('#scorm_object');
}

for (const version of ['1.2', '2004'] as const) {
  test(`Moodle: SCORM ${version} package launches, resumes and completes`, async ({ page }) => {
    const id = `cc_${version.replace('.', '')}_${Date.now().toString(36)}`;
    await login(page);
    const courseId = await createCourse(page, id);
    await addScorm(page, courseId, id, buildPackage(version, id));
    const viewUrl = page.url();

    // First session: play chapter one, then leave the activity.
    let course = await enter(page);
    await course.getByRole('button', { name: 'Start' }).click();
    await expect
      .poll(() =>
        course
          .locator('.ccp-clip-image img')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(course.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 10000 });
    await page.goto(viewUrl);

    // Second session: resumes at the end of chapter one.
    course = await enter(page);
    await expect(course.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(course.locator('.ccp-title')).toHaveText('Chapter 1 of 2: First chapter');
    await course.getByRole('button', { name: 'Resume' }).click();
    await expect(course.locator('.ccp-title')).toHaveText('Chapter 2 of 2: Second chapter');
    await expect(course.getByRole('button', { name: 'Replay' })).toBeVisible({ timeout: 10000 });
    await page.goto(viewUrl);

    // Moodle records the attempt as completed (per-attempt report of the SCO).
    const cmid = new URL(viewUrl).searchParams.get('id');
    await page.goto(`${url}/mod/scorm/report.php?id=${cmid}`);
    await page.locator('#attempts a[href*="userreport.php"]').first().click();
    await expect(page.locator('main, #region-main').first()).toContainText(/\bcompleted\b/i);
  });
}
