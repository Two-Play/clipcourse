// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Chapter templates: a chapter plus the media it uses, so it can be reused
 * in any project. Templates are stored by the platform (see ProjectStorage).
 */
import type { Asset, Chapter, Course, Popup, Question } from '@clipcourse/format';
import { cloneChapter } from './commands.js';
import type { IdFactory } from './document.js';
import { createClip } from './document.js';
import { assetIdFromName, ASSET_DIR, sanitizeFileName, type Project } from './project.js';
import { dropForeignActions, remapActions } from './references.js';

export interface ChapterTemplate {
  id: string;
  name: string;
  /** Built-in templates cannot be deleted. */
  builtIn?: boolean;
  createdAt: number;
  chapter: Chapter;
  /** Assets referenced by the chapter, keyed by their id in the template. */
  assets: Record<string, Asset>;
  /** Media files by path (as in `assets[*].src`). */
  files: [string, Uint8Array][];
  /** Popups opened by the chapter's click actions. */
  popups?: Popup[];
}

/** The chapter's questions (clips and quiz). */
function questionsOf(chapter: Chapter): Question[] {
  return [
    ...chapter.tracks.flatMap((t) =>
      t.clips.flatMap((c) => (c.type === 'question' ? [c.question] : [])),
    ),
    ...(chapter.quiz?.questions ?? []),
  ];
}

function popupRefs(chapter: Chapter): Set<string> {
  const ids = new Set<string>();
  for (const track of chapter.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'audio' && clip.action?.type === 'openPopup') ids.add(clip.action.popupId);
    }
  }
  return ids;
}

function assetRefs(chapter: Chapter): Set<string> {
  const ids = new Set<string>();
  for (const track of chapter.tracks) {
    for (const clip of track.clips) {
      if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio')
        ids.add(clip.assetId);
      if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId)
        ids.add(clip.captionsAssetId);
    }
  }
  for (const question of questionsOf(chapter)) {
    if (question.kind === 'hotspot') ids.add(question.assetId);
  }
  return ids;
}

/** Captures a chapter of a project as a template (with its media). */
export function templateFromChapter(
  project: Project,
  chapterId: string,
  name: string,
  id: string,
): ChapterTemplate {
  const chapter = project.course.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`Unknown chapter "${chapterId}"`);
  const assets: Record<string, Asset> = {};
  const files: [string, Uint8Array][] = [];
  const used = popupRefs(chapter);
  const popups = (project.course.popups ?? []).filter((p) => used.has(p.id));
  const refs = assetRefs(chapter);
  for (const popup of popups) if (popup.assetId) refs.add(popup.assetId);
  for (const assetId of refs) {
    const asset = project.course.assets[assetId];
    if (!asset) continue;
    assets[assetId] = structuredClone(asset);
    const data = project.files.get(asset.src);
    if (data) files.push([asset.src, data]);
  }
  return {
    id,
    name,
    createdAt: Date.now(),
    chapter: structuredClone(chapter),
    assets,
    files,
    ...(popups.length ? { popups: structuredClone(popups) } : {}),
  };
}

export interface InstantiatedTemplate {
  chapter: Chapter;
  /** Assets to add to the course (ids and paths already made unique). */
  assets: Record<string, Asset>;
  /** Files to add to the project. */
  files: Map<string, Uint8Array>;
  /** Popups to add to the course (new ids). */
  popups: Popup[];
}

/**
 * Prepares a template for insertion into `project`: new ids for everything,
 * and template assets renamed where they would clash. Identical files that
 * the project already has are reused instead of copied.
 */
export function instantiateTemplate(
  project: Project,
  template: ChapterTemplate,
  newId: IdFactory,
): InstantiatedTemplate {
  const chapter = cloneChapter(template.chapter, newId);
  chapter.title = template.chapter.title;
  const takenIds = new Set(Object.keys(project.course.assets));
  const takenPaths = new Set([
    ...project.files.keys(),
    ...Object.values(project.course.assets).map((a) => a.src),
  ]);
  const fileByPath = new Map(template.files);
  const assets: Record<string, Asset> = {};
  const files = new Map<string, Uint8Array>();
  const idMap = new Map<string, string>();

  for (const [oldId, asset] of Object.entries(template.assets)) {
    const data = fileByPath.get(asset.src);
    // Reuse an existing asset with the same path and identical content.
    const existing = Object.entries(project.course.assets).find(
      ([, a]) => a.src === asset.src && (!data || sameBytes(project.files.get(a.src), data)),
    );
    if (existing) {
      idMap.set(oldId, existing[0]);
      continue;
    }
    const assetId = takenIds.has(oldId) ? assetIdFromName(oldId, takenIds) : oldId;
    takenIds.add(assetId);
    let src = asset.src;
    if (!/^https?:\/\//.test(src) && takenPaths.has(src)) {
      const clean = sanitizeFileName(src);
      const dot = clean.lastIndexOf('.');
      const stem = dot > 0 ? clean.slice(0, dot) : clean;
      const ext = dot > 0 ? clean.slice(dot) : '';
      for (let i = 2; takenPaths.has(src); i++) src = `${ASSET_DIR}/${stem}-${i}${ext}`;
    }
    takenPaths.add(src);
    assets[assetId] = { ...asset, src };
    if (data) files.set(src, data);
    idMap.set(oldId, assetId);
  }

  for (const track of chapter.tracks) {
    for (const clip of track.clips) {
      if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio') {
        clip.assetId = idMap.get(clip.assetId) ?? clip.assetId;
      }
      if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId) {
        clip.captionsAssetId = idMap.get(clip.captionsAssetId) ?? clip.captionsAssetId;
      }
    }
  }
  for (const question of questionsOf(chapter)) {
    if (question.kind === 'hotspot')
      question.assetId = idMap.get(question.assetId) ?? question.assetId;
  }

  // Popups come along with new ids; other targets outside the chapter are dropped.
  const popupIds = new Map<string, string>();
  const popups = (template.popups ?? []).map((popup) => {
    const id = newId('popup');
    popupIds.set(popup.id, id);
    const copy: Popup = { ...structuredClone(popup), id };
    if (copy.assetId) copy.assetId = idMap.get(copy.assetId) ?? copy.assetId;
    return copy;
  });
  remapActions(chapter, {
    chapters: new Map(),
    markers: new Map(),
    clips: new Map(),
    popups: popupIds,
  });
  dropForeignActions(chapter, {
    ...project.course,
    popups: [...(project.course.popups ?? []), ...popups],
  });
  return { chapter, assets, files, popups };
}

function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Templates that ship with the editor (no media). */
export function builtInTemplates(course: Course): ChapterTemplate[] {
  const ids = { n: 0 };
  const id = (p: string) => `${p}_${++ids.n}`;
  const { width: w, height: h } = course.stage;
  const text = (
    text: string,
    y: number,
    size: number,
    role: 'heading' | 'paragraph',
    start: number,
  ) => {
    const clip = createClip(course, 'text', { id: id('clip'), start, duration: 8000 - start });
    if (clip.type === 'text') {
      clip.text = text;
      clip.role = role;
      clip.frame = {
        x: Math.round(w * 0.1),
        y: Math.round(h * y),
        width: Math.round(w * 0.8),
        height: Math.round(size * 2.4),
      };
      clip.style = {
        fontSize: size,
        color: '#ffffff',
        align: role === 'heading' ? 'center' : 'left',
        verticalAlign: 'middle',
        ...(role === 'heading' ? { fontWeight: 700 } : {}),
      };
      clip.animations = { in: { type: 'fade', duration: 500 } };
    }
    return clip;
  };
  const make = (name: string, title: string, tracks: Chapter['tracks']): ChapterTemplate => ({
    id: `builtin_${name.toLowerCase().replace(/\W+/g, '_')}`,
    name,
    builtIn: true,
    createdAt: 0,
    assets: {},
    files: [],
    chapter: { id: id('chapter'), title, duration: 8000, transition: { mode: 'wait' }, tracks },
  });
  return [
    make('Blank chapter', 'New chapter', [{ id: id('track'), name: 'Text', clips: [] }]),
    make('Title', 'Title', [
      { id: id('track'), name: 'Title', clips: [text('Chapter title', 0.35, 96, 'heading', 0)] },
      {
        id: id('track'),
        name: 'Subtitle',
        clips: [text('A short subtitle', 0.55, 48, 'paragraph', 800)],
      },
    ]),
    make('Title and bullet points', 'Key points', [
      { id: id('track'), name: 'Title', clips: [text('Key points', 0.08, 72, 'heading', 0)] },
      {
        id: id('track'),
        name: 'Point 1',
        clips: [text('• First point', 0.32, 48, 'paragraph', 1000)],
      },
      {
        id: id('track'),
        name: 'Point 2',
        clips: [text('• Second point', 0.48, 48, 'paragraph', 2500)],
      },
      {
        id: id('track'),
        name: 'Point 3',
        clips: [text('• Third point', 0.64, 48, 'paragraph', 4000)],
      },
    ]),
  ];
}
