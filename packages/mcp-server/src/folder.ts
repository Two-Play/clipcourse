// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Projects as folders: course.json plus media under assets/. Writes are
 * atomic (temporary file + rename), so a crash never leaves a half-written
 * course.json.
 */
import {
  type Dirent,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  COURSE_FILE,
  COURSE_TEMPLATES,
  courseTemplate,
  createEmptyCourse,
  ProjectError,
  randomId,
  type Project,
} from '@clipcourse/editor-core';
import { THEME_PRESETS, themePreset } from '@clipcourse/format';
import { validateCourse } from '@clipcourse/format/validation';

export function isProjectFolder(dir: string): boolean {
  return existsSync(join(dir, COURSE_FILE));
}

function writeAtomic(path: string, data: string | Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

/** Reads and validates a project folder. Media paths must stay inside it. */
export function loadProjectFolder(dir: string): Project {
  const file = join(dir, COURSE_FILE);
  if (!existsSync(file)) throw new ProjectError(`No ${COURSE_FILE} in ${dir}`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ProjectError(`${COURSE_FILE} is not valid JSON`);
  }
  const result = validateCourse(json);
  if (!result.ok) throw new ProjectError(`${COURSE_FILE} is not a valid course`, result.issues);
  const files = new Map<string, Uint8Array>();
  for (const asset of Object.values(result.course.assets)) {
    if (/^https?:\/\//.test(asset.src)) continue;
    const path = resolve(dir, asset.src);
    const rel = relative(dir, path);
    if (rel.startsWith('..')) throw new ProjectError(`Asset path leaves the project: ${asset.src}`);
    if (existsSync(path)) files.set(asset.src, new Uint8Array(readFileSync(path)));
  }
  return { course: result.course, files };
}

/**
 * Writes course.json and any media file that is not on disk yet (or whose
 * content changed). Files are never deleted, so nothing is lost by mistake.
 */
export function saveProjectFolder(
  dir: string,
  project: Project,
  written: Map<string, Uint8Array> = new Map(),
) {
  writeAtomic(join(dir, COURSE_FILE), JSON.stringify(project.course, null, 2) + '\n');
  for (const asset of Object.values(project.course.assets)) {
    if (/^https?:\/\//.test(asset.src)) continue;
    const data = project.files.get(asset.src);
    if (!data || written.get(asset.src) === data) continue;
    const path = resolve(dir, asset.src);
    if (relative(dir, path).startsWith('..'))
      throw new ProjectError(`Asset path leaves the project: ${asset.src}`);
    if (
      !existsSync(path) ||
      statSync(path).size !== data.length ||
      !readFileSync(path).equals(data)
    ) {
      writeAtomic(path, data);
    }
    written.set(asset.src, data);
  }
}

export function createProjectFolder(
  dir: string,
  options: {
    title?: string;
    language?: string;
    width?: number;
    height?: number;
    template?: string;
    theme?: string;
  },
): Project {
  if (existsSync(join(dir, COURSE_FILE)))
    throw new ProjectError(`There is already a project in ${dir}`);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new ProjectError(`The folder ${dir} is not empty`);
  }
  const theme = options.theme ? themePreset(options.theme)?.theme : undefined;
  if (options.theme && !theme)
    throw new ProjectError(
      `Unknown theme "${options.theme}". Themes: ${THEME_PRESETS.map((p) => p.id).join(', ')}`,
    );
  const template = options.template ? courseTemplate(options.template) : undefined;
  if (options.template && !template)
    throw new ProjectError(
      `Unknown course template "${options.template}". Templates: ${COURSE_TEMPLATES.map((t) => t.id).join(', ')}`,
    );
  const size = { width: options.width ?? 1920, height: options.height ?? 1080 };
  const course = template
    ? template.create(randomId, theme, size)
    : createEmptyCourse(undefined, 'Untitled course', theme);
  if (options.title) course.title = options.title;
  if (options.language) course.language = options.language;
  course.stage.width = size.width;
  course.stage.height = size.height;
  const result = validateCourse(course);
  if (!result.ok) throw new ProjectError('Invalid project settings', result.issues);
  const project = { course: result.course, files: new Map<string, Uint8Array>() };
  mkdirSync(dir, { recursive: true });
  saveProjectFolder(dir, project);
  return project;
}

/** Finds project folders below `dir` (not following symlinks), up to `depth` levels. */
export function findProjects(dir: string, depth = 3): string[] {
  const found: string[] = [];
  const walk = (current: string, level: number) => {
    if (isProjectFolder(current)) {
      found.push(current);
      return;
    }
    if (level >= depth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        walk(join(current, entry.name), level + 1);
      }
    }
  };
  walk(dir, 0);
  return found;
}
