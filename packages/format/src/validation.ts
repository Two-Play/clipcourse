// SPDX-License-Identifier: MIT
/** Entry point with runtime validation (pulls in Valibot). Not for the player. */
export { CourseSchema } from './schema.js';
export { validateCourse, parseCourse } from './validate.js';
export type { ValidationIssue, ValidationResult } from './validate.js';
export { migrateCourse, readFormatVersion, FormatVersionError } from './migrate.js';
