// SPDX-License-Identifier: MIT
import { FORMAT_VERSION } from './types.js';

export class FormatVersionError extends Error {
  override name = 'FormatVersionError';
}

type Json = Record<string, unknown>;

/**
 * Migration steps. `migrations[n]` upgrades a document from version `n` to
 * `n + 1`. Each step must be pure: it receives a deep copy and returns the
 * upgraded document.
 */
const migrations: Record<number, (doc: Json) => Json> = {
  // v2 only adds optional features (animations, highlight and progress
  // clips, chapter markers).
  1: (doc) => ({ ...doc, formatVersion: 2 }),
  // v3 only adds optional features (questions, quiz chapters, assessment).
  2: (doc) => ({ ...doc, formatVersion: 3 }),
  // v4 only adds optional features (buttons, click actions, popups,
  // glossary, completion rule).
  3: (doc) => ({ ...doc, formatVersion: 4 }),
  // v5 only adds optional features (theme, color roles).
  4: (doc) => ({ ...doc, formatVersion: 5 }),
};

/** Returns the format version stored in a raw document. */
export function readFormatVersion(input: unknown): number {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new FormatVersionError('A course document must be a JSON object');
  }
  const version = (input as Json).formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FormatVersionError('Missing or invalid "formatVersion"');
  }
  return version;
}

/**
 * Upgrades a raw course document to {@link FORMAT_VERSION}. The input is not
 * modified. The result still has to be validated.
 */
export function migrateCourse(input: unknown, target: number = FORMAT_VERSION): unknown {
  let version = readFormatVersion(input);
  if (version > target) {
    throw new FormatVersionError(
      `This course uses format version ${version}, but this software supports up to version ${target}. Please update Clipcourse.`,
    );
  }
  let doc = structuredClone(input) as Json;
  while (version < target) {
    const step = migrations[version];
    if (!step) {
      throw new FormatVersionError(`No migration from format version ${version}`);
    }
    doc = step(doc);
    version += 1;
    if (doc.formatVersion !== version) {
      throw new Error(`Migration to version ${version} did not set formatVersion`);
    }
  }
  return doc;
}

/** For tests: run migrations with a custom table. */
export function migrateWith(
  input: unknown,
  table: Record<number, (doc: Json) => Json>,
  target: number,
): unknown {
  const saved = { ...migrations };
  Object.assign(migrations, table);
  try {
    return migrateCourse(input, target);
  } finally {
    for (const key of Object.keys(migrations)) delete migrations[Number(key)];
    Object.assign(migrations, saved);
  }
}
