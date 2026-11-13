// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tests against real LMS installations. Opt-in: set MOODLE_URL (and the
 * admin credentials) to run them, see docs/lms-testing.md.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e-lms',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure', viewport: { width: 1440, height: 900 } },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
