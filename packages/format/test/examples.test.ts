// SPDX-License-Identifier: MIT
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { validateCourse } from '../src/validation.js';

const examplesDir = fileURLToPath(new URL('../../../examples', import.meta.url));
const examples = readdirSync(examplesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(examplesDir, d.name, 'course.json')))
  .map((d) => d.name);

describe.each(examples)('example %s', (name) => {
  const dir = join(examplesDir, name);
  const doc: unknown = JSON.parse(readFileSync(join(dir, 'course.json'), 'utf8'));

  test('is a valid course without warnings', () => {
    const result = validateCourse(doc);
    if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
    expect(result.warnings).toEqual([]);
  });

  test('references only existing asset files', () => {
    const result = validateCourse(doc);
    if (!result.ok) return;
    for (const asset of Object.values(result.course.assets)) {
      expect(existsSync(join(dir, asset.src)), asset.src).toBe(true);
    }
  });
});

test('there is at least one example', () => {
  expect(examples.length).toBeGreaterThan(0);
});
