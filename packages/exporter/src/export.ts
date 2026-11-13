// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Builds a SCORM package from a project:
 *
 *   imsmanifest.xml
 *   index.html               launch page
 *   course.js                course data (window.CLIPCOURSE = …)
 *   clipcourse-runtime.js    player + SCORM runtime (MIT)
 *   assets/…                 media
 */
import { missingFiles, type Project } from '@clipcourse/editor-core';
import type { Course } from '@clipcourse/format';
import { validateCourse } from '@clipcourse/format/validation';
import { strToU8, zipSync, type Zippable } from 'fflate';
import { buildManifest, type ScormVersion } from './manifest.js';
import { escapeXml } from './xml.js';

export interface ExportOptions {
  version: ScormVersion;
  /** Contents of clipcourse-runtime.js (the built @clipcourse/scorm-runtime bundle). */
  runtime: string;
  /** Name shown in the generator meta tag. */
  generator?: string;
}

export interface ExportResult {
  zip: Uint8Array;
  /** All files in the package, including the manifest. */
  files: string[];
  /** Things the author should know (e.g. external media). */
  warnings: string[];
}

export class ExportError extends Error {
  override name = 'ExportError';
  constructor(
    message: string,
    readonly details: string[] = [],
  ) {
    super(message);
  }
}

export const LAUNCH_FILE = 'index.html';
export const RUNTIME_FILE = 'clipcourse-runtime.js';
export const COURSE_DATA_FILE = 'course.js';

export function buildIndexHtml(course: Course, generator = 'Clipcourse'): string {
  return `<!doctype html>
<html lang="${escapeXml(course.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${escapeXml(generator)}">
<title>${escapeXml(course.title)}</title>
<style>html,body{margin:0;height:100%;background:#000}#clipcourse{height:100%}</style>
</head>
<body>
<div id="clipcourse"></div>
<noscript>This course needs JavaScript.</noscript>
<script src="${COURSE_DATA_FILE}"></script>
<script src="${RUNTIME_FILE}"></script>
</body>
</html>
`;
}

export function buildCourseData(course: Course, version: ScormVersion): string {
  // JSON is valid JavaScript (ES2019+); escape "<" so the file is also safe if inlined.
  const json = JSON.stringify({ course, scormVersion: version }).replace(/</g, '\\u003c');
  return `window.CLIPCOURSE = ${json};\n`;
}

export function exportScorm(project: Project, options: ExportOptions): ExportResult {
  const result = validateCourse(project.course);
  if (!result.ok) {
    throw new ExportError(
      'The course is not valid',
      result.issues.map((i) => `${i.path}: ${i.message}`),
    );
  }
  const course = result.course;
  const missing = missingFiles({ course, files: project.files });
  if (missing.length > 0) throw new ExportError('Media files are missing', missing);
  if (!options.runtime.trim()) throw new ExportError('The player runtime is missing');

  const entries: Zippable = {
    [LAUNCH_FILE]: strToU8(buildIndexHtml(course, options.generator)),
    [COURSE_DATA_FILE]: strToU8(buildCourseData(course, options.version)),
    [RUNTIME_FILE]: strToU8(options.runtime),
  };
  for (const asset of Object.values(course.assets)) {
    if (/^https?:\/\//.test(asset.src)) continue;
    const data = project.files.get(asset.src)!;
    entries[asset.src] = /\.(svg|vtt)$/i.test(asset.src) ? data : [data, { level: 0 }];
  }
  const files = Object.keys(entries).sort((a, b) =>
    a === LAUNCH_FILE ? -1 : b === LAUNCH_FILE ? 1 : a.localeCompare(b),
  );
  entries['imsmanifest.xml'] = strToU8(buildManifest(course, options.version, files, LAUNCH_FILE));

  const warnings = result.warnings.map((w) => w.message);
  if (options.version === '1.2' && course.chapters.length > 15000) {
    warnings.push('Very many chapters: the progress data may exceed the SCORM 1.2 limit.');
  }

  return { zip: zipSync(entries, { level: 6 }), files: ['imsmanifest.xml', ...files], warnings };
}

/** File name for the download, e.g. "My_course-scorm12.zip". */
export function packageFileName(course: Course, version: ScormVersion): string {
  const base =
    course.title
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 60) || 'course';
  return `${base}-scorm${version === '1.2' ? '12' : '2004'}.zip`;
}
