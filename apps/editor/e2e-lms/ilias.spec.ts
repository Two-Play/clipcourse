// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Needs learning progress enabled in ILIAS (scripts/lms/ilias-up.sh does it):
 * otherwise ILIAS runs SCORM 1.2 in "no-credit" mode and drops scores.
 *
 * Uploads exported packages to a real ILIAS and checks launch, media,
 * resume and completion. Runs only when ILIAS_URL is set, see
 * docs/lms-testing.md.
 */
import { expect, test, type Frame, type Page } from '@playwright/test';
import { answerQuiz, buildPackage } from './package.js';

const url = process.env.ILIAS_URL;
const user = process.env.ILIAS_USER ?? 'root';
const pass = process.env.ILIAS_PASS ?? '';

test.skip(!url, 'Set ILIAS_URL to run ILIAS tests');

async function login(page: Page) {
  await page.goto(`${url}/login.php`);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Login' }).first().click();
  await page.waitForLoadState('networkidle');
  if (page.url().includes('login.php')) throw new Error(`ILIAS login failed at ${page.url()}`);
}

/** Creates a SCORM learning module in the repository root; returns its ref_id. */
async function createModule(
  page: Page,
  version: '1.2' | '2004',
  name: string,
  zip: Buffer,
): Promise<string> {
  await page.goto(`${url}/ilias.php?baseClass=ilrepositorygui&ref_id=1`);
  await page.getByRole('button', { name: 'Add New Object' }).click();
  await page.getByRole('link', { name: 'Learning Module SCORM' }).click();
  await page.getByRole('radio', { name: version === '1.2' ? 'SCORM 1.2' : /SCORM 2004/ }).check();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: `${name}.zip`, mimeType: 'application/zip', buffer: zip });
  await expect(
    page
      .getByRole('textbox', { name: 'Selected files' })
      .or(page.getByText(`${name}.zip`))
      .first(),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create' }).first().click();
  await page.waitForLoadState('networkidle');
  const refId = new URL(page.url()).searchParams.get('ref_id');
  if (!refId || refId === '1') throw new Error(`Module was not created (at ${page.url()})`);
  return refId;
}

/** Opens the ILIAS player and returns the frame that runs the course. */
async function launch(page: Page, launchUrl: string) {
  await page.goto(launchUrl);
  let frame: Frame | undefined;
  await expect
    .poll(
      () => (frame = page.frames().find((f) => f.url().endsWith('/index.html'))) !== undefined,
      { timeout: 20000 },
    )
    .toBe(true);
  return frame!;
}

for (const version of ['1.2', '2004'] as const) {
  test(`ILIAS: SCORM ${version} package launches, resumes, scores and completes`, async ({
    page,
  }) => {
    const name = `cc_${version.replace('.', '')}_${Date.now().toString(36)}`;
    await login(page);
    const refId = await createModule(page, version, name, buildPackage(version, name));
    test.info().annotations.push({ type: 'ref_id', description: refId });
    const launchUrl = `${url}/ilias.php?baseClass=ilSAHSPresentationGUI&ref_id=${refId}`;

    // First session: play chapter one, then leave.
    let course = await launch(page, launchUrl);
    await course.getByRole('button', { name: 'Start' }).click();
    await expect
      .poll(() =>
        course
          .locator('.ccp-clip-image img')
          .evaluate((img) => (img as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(course.getByRole('button', { name: 'Continue' })).toBeVisible({ timeout: 10000 });
    await page.goto(`${url}/ilias.php?baseClass=ilrepositorygui&ref_id=1`);
    await page.waitForLoadState('networkidle');

    // Second session: resumes at the end of chapter one.
    course = await launch(page, launchUrl);
    await expect(course.getByRole('button', { name: 'Resume' })).toBeVisible();
    await expect(course.locator('.ccp-title')).toHaveText('Chapter 1 of 3: First chapter');
    await course.getByRole('button', { name: 'Resume' }).click();
    await expect(course.locator('.ccp-title')).toHaveText('Chapter 2 of 3: Second chapter');
    await course.getByRole('button', { name: 'Continue' }).click({ timeout: 10000 });
    await expect(course.locator('.ccp-title')).toHaveText('Chapter 3 of 3: Final quiz');
    await answerQuiz(course);
    await page.goto(`${url}/ilias.php?baseClass=ilrepositorygui&ref_id=1`);
    await page.waitForLoadState('networkidle');

    // ILIAS lists the learner's status under "Tracking Data".
    await page.goto(`${url}/goto.php/sahs/${refId}`);
    await page.getByRole('link', { name: 'Tracking Data' }).click();
    await page
      .getByRole('combobox', { name: 'Report' })
      .selectOption({ label: 'Basic report for chapters (SCO)' });
    await page.getByRole('button', { name: 'Apply Filter' }).click();
    await page.waitForLoadState('networkidle');
    // 1.2 has one status (passed/failed); 2004 separates completion and success.
    const statuses = version === '1.2' ? ['passed'] : ['completed', 'passed'];
    for (const status of statuses) {
      await expect(page.getByRole('cell', { name: status, exact: true }).first()).toBeVisible();
    }
  });
}
