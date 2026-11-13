// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A project is a course document plus its media files. On disk it is a
 * folder (or a .zip of that folder):
 *
 *   course.json
 *   assets/intro.mp4
 *   assets/logo.png
 *
 * Everything here works on plain bytes, so the same code serves the
 * browser and the Tauri desktop app.
 */
import type { Asset, AssetKind, Course } from '@clipcourse/format';
import { validateCourse, type ValidationIssue } from '@clipcourse/format/validation';
import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';

export interface Project {
  course: Course;
  /** Media files by project-relative path, e.g. "assets/logo.png". */
  files: Map<string, Uint8Array>;
}

export const COURSE_FILE = 'course.json';
export const ASSET_DIR = 'assets';
/** Refuse archives that would unpack to more than this. */
export const MAX_PROJECT_BYTES = 2 * 1024 ** 3;

export class ProjectError extends Error {
  override name = 'ProjectError';
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  vtt: 'text/vtt',
};

export function mimeFromName(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[ext] ?? null;
}

export function kindFromMime(mime: string): AssetKind | null {
  if (mime === 'text/vtt') return 'captions';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

/** A safe, readable file name: "Mein Bild (1).PNG" → "mein-bild-1.png". */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const cleanStem =
    stem
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'file';
  return ext ? `${cleanStem}.${ext}` : cleanStem;
}

/** Turns any name into a valid asset id. */
export function assetIdFromName(name: string, taken: ReadonlySet<string>): string {
  const stem = sanitizeFileName(name).replace(/\.[^.]*$/, '').replace(/-/g, '_');
  const base = /^[a-z_]/.test(stem) ? stem : `asset_${stem}`;
  let id = base.slice(0, 100);
  for (let i = 2; taken.has(id); i++) id = `${base.slice(0, 96)}_${i}`;
  return id;
}

export interface ImportedAsset {
  assetId: string;
  asset: Asset;
  path: string;
}

/**
 * Prepares a media file for the project: picks a unique path below assets/
 * and a unique asset id. Does not modify the project; the caller adds the
 * asset with a command and the file with {@link Project.files}.
 */
export function prepareAsset(
  project: Project,
  fileName: string,
  mime?: string,
  extra: Partial<Pick<Asset, 'alt' | 'duration'>> = {},
): ImportedAsset {
  const type = mime || mimeFromName(fileName);
  const kind = type ? kindFromMime(type) : null;
  if (!type || !kind) throw new ProjectError(`Unsupported file type: ${fileName}`);
  const clean = sanitizeFileName(fileName);
  const dot = clean.lastIndexOf('.');
  const stem = dot > 0 ? clean.slice(0, dot) : clean;
  const ext = dot > 0 ? clean.slice(dot) : '';
  const usedPaths = new Set([...project.files.keys(), ...Object.values(project.course.assets).map((a) => a.src)]);
  let path = `${ASSET_DIR}/${clean}`;
  for (let i = 2; usedPaths.has(path); i++) path = `${ASSET_DIR}/${stem}-${i}${ext}`;
  const assetId = assetIdFromName(fileName, new Set(Object.keys(project.course.assets)));
  const asset: Asset = { kind, src: path, mime: type };
  if (extra.alt !== undefined) asset.alt = extra.alt;
  if (extra.duration !== undefined) asset.duration = Math.round(extra.duration);
  return { assetId, asset, path };
}

/** Packs a project into a .zip archive. Media is stored without recompression. */
export function exportProjectZip(project: Project): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]> = {
    [COURSE_FILE]: strToU8(JSON.stringify(project.course, null, 2) + '\n'),
  };
  const referenced = new Set(Object.values(project.course.assets).map((a) => a.src));
  for (const [path, data] of project.files) {
    if (!referenced.has(path)) continue; // drop files no asset points to
    const compressible = /\.(svg|vtt|json)$/i.test(path);
    entries[path] = [data, { level: compressible ? 6 : 0 }];
  }
  return zipSync(entries);
}

/** Reads a project .zip, migrates and validates its course. */
export function importProjectZip(data: Uint8Array): Project {
  let total = 0;
  let unzipped: Unzipped;
  try {
    unzipped = unzipSync(data, {
      filter: (file) => {
        total += file.originalSize;
        if (total > MAX_PROJECT_BYTES) throw new ProjectError('The archive is too large');
        return !file.name.endsWith('/');
      },
    });
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError('The file is not a valid .zip archive');
  }

  // Accept course.json at the root or inside a single top-level folder.
  const names = Object.keys(unzipped).filter((n) => !n.startsWith('__MACOSX/'));
  let prefix = '';
  if (!names.includes(COURSE_FILE)) {
    const nested = names.filter((n) => /^[^/]+\/course\.json$/.test(n));
    if (nested.length !== 1) throw new ProjectError('No course.json found in the archive');
    prefix = nested[0]!.slice(0, -COURSE_FILE.length);
  }

  let json: unknown;
  try {
    json = JSON.parse(strFromU8(unzipped[prefix + COURSE_FILE]!));
  } catch {
    throw new ProjectError('course.json is not valid JSON');
  }
  const result = validateCourse(json);
  if (!result.ok) throw new ProjectError('course.json is not a valid course', result.issues);

  const files = new Map<string, Uint8Array>();
  for (const asset of Object.values(result.course.assets)) {
    if (/^https?:\/\//.test(asset.src)) continue;
    const content = unzipped[prefix + asset.src];
    if (!content) throw new ProjectError(`Missing file in archive: ${asset.src}`);
    files.set(asset.src, content);
  }
  return { course: result.course, files };
}

/** Local asset files referenced by the course that are missing. */
export function missingFiles(project: Project): string[] {
  return Object.values(project.course.assets)
    .filter((a) => !/^https?:\/\//.test(a.src) && !project.files.has(a.src))
    .map((a) => a.src);
}
