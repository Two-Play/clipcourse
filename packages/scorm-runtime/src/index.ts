// SPDX-License-Identifier: MIT
export { findApi } from './api.js';
export type { FoundApi, Scorm12Api, Scorm2004Api, ScormVersion, WindowLike } from './api.js';
export { connect, SUSPEND_DATA_LIMIT } from './connection.js';
export type { LmsConnection } from './connection.js';
export { createLmsStore, runCourse, COMMIT_INTERVAL } from './course.js';
export type { RunCourseOptions, RunningCourse } from './course.js';
export { formatIsoDuration, formatScorm12Time } from './time.js';
