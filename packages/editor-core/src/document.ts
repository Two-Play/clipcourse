// SPDX-License-Identifier: AGPL-3.0-only
/** Lookup helpers and factories for course documents. */
import type {
  Asset,
  AssetKind,
  Chapter,
  Clip,
  ClipType,
  Course,
  Frame,
  Track,
} from '@clipcourse/format';

export interface TrackLocation {
  chapterIndex: number;
  trackIndex: number;
  track: Track;
}

export interface ClipLocation extends TrackLocation {
  clipIndex: number;
  clip: Clip;
}

export function chapterIndexById(course: Course, chapterId: string): number {
  return course.chapters.findIndex((c) => c.id === chapterId);
}

export function getChapter(course: Course, chapterId: string): Chapter {
  const chapter = course.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error(`Unknown chapter "${chapterId}"`);
  return chapter;
}

export function findTrack(course: Course, trackId: string): TrackLocation | null {
  for (let chapterIndex = 0; chapterIndex < course.chapters.length; chapterIndex++) {
    const tracks = course.chapters[chapterIndex]!.tracks;
    const trackIndex = tracks.findIndex((t) => t.id === trackId);
    if (trackIndex >= 0) return { chapterIndex, trackIndex, track: tracks[trackIndex]! };
  }
  return null;
}

export function findClip(course: Course, clipId: string): ClipLocation | null {
  for (let chapterIndex = 0; chapterIndex < course.chapters.length; chapterIndex++) {
    const tracks = course.chapters[chapterIndex]!.tracks;
    for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
      const track = tracks[trackIndex]!;
      const clipIndex = track.clips.findIndex((c) => c.id === clipId);
      if (clipIndex >= 0) {
        return { chapterIndex, trackIndex, track, clipIndex, clip: track.clips[clipIndex]! };
      }
    }
  }
  return null;
}

/** All ids used anywhere in the document (chapters, tracks, clips, assets). */
export function collectIds(course: Course): Set<string> {
  const ids = new Set<string>(Object.keys(course.assets));
  const addTracks = (tracks: Track[]) => {
    for (const track of tracks) {
      ids.add(track.id);
      for (const clip of track.clips) ids.add(clip.id);
    }
  };
  for (const chapter of course.chapters) {
    ids.add(chapter.id);
    addTracks(chapter.tracks);
  }
  if (course.courseLayer) {
    addTracks(course.courseLayer.background);
    addTracks(course.courseLayer.foreground);
  }
  return ids;
}

export type IdFactory = (prefix: string) => string;

/** Random ids like "clip_k3j9x2"; valid for the format's id pattern. */
export const randomId: IdFactory = (prefix) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

/** Returns a factory that never repeats an id already in `course`. */
export function uniqueIdFactory(course: Course, base: IdFactory = randomId): IdFactory {
  const used = collectIds(course);
  return (prefix) => {
    let id = base(prefix);
    while (used.has(id)) id = base(prefix);
    used.add(id);
    return id;
  };
}

/** A centered frame covering `fraction` of the stage width. */
export function defaultFrame(course: Course, type: ClipType, aspect = 16 / 9): Frame {
  const { width: sw, height: sh } = course.stage;
  if (type === 'text') {
    const width = Math.round(sw * 0.7);
    const height = Math.round(sh * 0.15);
    return { x: Math.round((sw - width) / 2), y: Math.round((sh - height) / 2), width, height };
  }
  if (type === 'shape' || type === 'box') {
    const width = Math.round(sw * 0.3);
    const height = Math.round(sh * 0.25);
    return { x: Math.round((sw - width) / 2), y: Math.round((sh - height) / 2), width, height };
  }
  let width = Math.round(sw * 0.6);
  let height = Math.round(width / aspect);
  if (height > sh * 0.8) {
    height = Math.round(sh * 0.8);
    width = Math.round(height * aspect);
  }
  return { x: Math.round((sw - width) / 2), y: Math.round((sh - height) / 2), width, height };
}

export const DEFAULT_CLIP_DURATION = 3000;

export interface NewClipOptions {
  id: string;
  start: number;
  duration?: number;
  assetId?: string;
  asset?: Asset;
}

/** Creates a clip with sensible defaults for laypeople. */
export function createClip(course: Course, type: ClipType, options: NewClipOptions): Clip {
  const { id, start } = options;
  const mediaDuration = options.asset?.duration;
  const duration = Math.max(1, Math.round(options.duration ?? mediaDuration ?? DEFAULT_CLIP_DURATION));
  const base = { id, start: Math.max(0, Math.round(start)), duration };
  switch (type) {
    case 'text':
      return {
        ...base,
        type,
        text: 'New text',
        frame: defaultFrame(course, type),
        style: { fontSize: 64, color: '#ffffff', align: 'center', verticalAlign: 'middle' },
      };
    case 'box':
      return {
        ...base,
        type,
        frame: defaultFrame(course, type),
        fill: '#4f8cff',
        radius: 16,
        padding: 24,
        text: 'Box',
        style: { fontSize: 40, color: '#ffffff', align: 'center', verticalAlign: 'middle' },
      };
    case 'shape':
      return {
        ...base,
        type,
        shape: 'rect',
        frame: defaultFrame(course, type),
        stroke: '#ffd166',
        strokeWidth: 8,
        radius: 8,
      };
    case 'image':
      return { ...base, type, assetId: requireAsset(options), frame: defaultFrame(course, type), fit: 'contain' };
    case 'video':
      return { ...base, type, assetId: requireAsset(options), frame: defaultFrame(course, type), fit: 'contain' };
    case 'audio':
      return { ...base, type, assetId: requireAsset(options) };
  }
}

function requireAsset(options: NewClipOptions): string {
  if (!options.assetId) throw new Error('This clip type needs an asset');
  return options.assetId;
}

/** Which clip type an asset becomes when dropped on the timeline. */
export function clipTypeForAsset(kind: AssetKind): ClipType | null {
  switch (kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    default:
      return null;
  }
}

/** A new, valid, one-chapter course. */
export function createEmptyCourse(newId: IdFactory = randomId, title = 'Untitled course'): Course {
  const chapterId = newId('chapter');
  return {
    formatVersion: 1,
    id: newId('course'),
    title,
    language: 'en',
    stage: { width: 1920, height: 1080, background: '#101522' },
    assets: {},
    chapters: [
      {
        id: chapterId,
        title: 'Chapter 1',
        duration: 10000,
        transition: { mode: 'wait' },
        tracks: [
          { id: newId('track'), name: 'Text', clips: [] },
          { id: newId('track'), name: 'Images', clips: [] },
        ],
      },
    ],
  };
}

/** The end of the last clip in a chapter, ms. */
export function contentEnd(chapter: Chapter): number {
  let end = 0;
  for (const track of chapter.tracks) for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  return end;
}
