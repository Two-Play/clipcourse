// SPDX-License-Identifier: MIT
/**
 * Keeps schema/course.v2.schema.json in sync with the Valibot schema.
 * Regenerate with: UPDATE_SCHEMA=1 pnpm test
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toJsonSchema } from '@valibot/to-json-schema';
import { expect, test } from 'vitest';
import { CourseSchema } from '../src/schema.js';

const file = fileURLToPath(new URL('../schema/course.v2.schema.json', import.meta.url));

function build(): string {
  const schema = toJsonSchema(CourseSchema, { errorMode: 'ignore' });
  const doc = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    ...schema,
    $id: 'urn:clipcourse:schema:course:v2',
    title: 'Clipcourse course, format version 2',
  };
  return JSON.stringify(doc, null, 2) + '\n';
}

test('JSON schema file is up to date', () => {
  const generated = build();
  if (process.env.UPDATE_SCHEMA === '1' || !existsSync(file)) {
    writeFileSync(file, generated);
  }
  expect(readFileSync(file, 'utf8')).toBe(generated);
});
