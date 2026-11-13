// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Editing commands. Each command creator returns a recipe that mutates an
 * Immer draft of the course. The store runs recipes through Immer, records
 * patches and makes every command undoable.
 *
 * Commands never produce an invalid document: positions are clamped and
 * resolved instead of throwing, so dragging always does something sensible.
 */
import type { Asset, Chapter, Clip, Course, Track } from '@clipcourse/format';
import { current, isDraft } from 'immer';
import { findClip, findTrack, getChapter, contentEnd } from './document.js';
import { nearestFreeStart, resizeLimits } from './placement.js';

export type Recipe = (draft: Course) => void;

/** Shortest clip the editor creates by resizing or splitting, ms. */
export const MIN_CLIP_DURATION = 100;

function requireClip(course: Course, clipId: string) {
  const location = findClip(course, clipId);
  if (!location) throw new Error(`Unknown clip "${clipId}"`);
  return location;
}

function requireTrack(course: Course, trackId: string) {
  const location = findTrack(course, trackId);
  if (!location) throw new Error(`Unknown track "${trackId}"`);
  return location;
}

/** Grows the chapter so all clips fit. Never shrinks it. */
function growChapter(chapter: Chapter) {
  const end = contentEnd(chapter);
  if (end > chapter.duration) chapter.duration = end;
}

/** Deep copy that works on Immer drafts and plain objects. */
function cloneClip(clip: Clip): Clip {
  return structuredClone(isDraft(clip) ? current(clip) : clip);
}

function sortClips(track: Track) {
  track.clips.sort((a, b) => a.start - b.start);
}

// --- Course and chapters -----------------------------------------------------

export const setCourseProps =
  (props: Partial<Pick<Course, 'title' | 'language'>>): Recipe =>
  (draft) => {
    if (props.title !== undefined) draft.title = props.title;
    if (props.language !== undefined) draft.language = props.language;
  };

export const setChapterProps =
  (
    chapterId: string,
    props: Partial<Pick<Chapter, 'title' | 'duration' | 'transition'>> & {
      background?: string | null;
    },
  ): Recipe =>
  (draft) => {
    const chapter = getChapter(draft, chapterId);
    if (props.title !== undefined) chapter.title = props.title;
    if (props.duration !== undefined)
      chapter.duration = Math.max(MIN_CLIP_DURATION, Math.round(props.duration));
    if (props.transition !== undefined) chapter.transition = props.transition;
    if (props.background === null) delete chapter.background;
    else if (props.background !== undefined) chapter.background = props.background;
  };

/** Sets the chapter duration to the end of its last clip. */
export const fitChapterToContent =
  (chapterId: string): Recipe =>
  (draft) => {
    const chapter = getChapter(draft, chapterId);
    chapter.duration = Math.max(MIN_CLIP_DURATION, contentEnd(chapter));
  };

// --- Tracks --------------------------------------------------------------------

export const addTrack =
  (chapterId: string, track: { id: string; name?: string }, index?: number): Recipe =>
  (draft) => {
    const chapter = getChapter(draft, chapterId);
    const newTrack: Track = { id: track.id, clips: [] };
    if (track.name !== undefined) newTrack.name = track.name;
    const at =
      index === undefined
        ? chapter.tracks.length
        : Math.max(0, Math.min(index, chapter.tracks.length));
    chapter.tracks.splice(at, 0, newTrack);
  };

export const removeTrack =
  (trackId: string): Recipe =>
  (draft) => {
    const { chapterIndex, trackIndex } = requireTrack(draft, trackId);
    draft.chapters[chapterIndex]!.tracks.splice(trackIndex, 1);
  };

export const updateTrack =
  (trackId: string, props: { name?: string; hidden?: boolean; muted?: boolean }): Recipe =>
  (draft) => {
    const { track } = requireTrack(draft, trackId);
    if (props.name !== undefined) track.name = props.name;
    for (const key of ['hidden', 'muted'] as const) {
      const value = props[key];
      if (value === true) track[key] = true;
      else if (value === false) delete track[key];
    }
  };

/** Moves a track to a new index in the stacking order (0 = back-most). */
export const moveTrack =
  (trackId: string, toIndex: number): Recipe =>
  (draft) => {
    const { chapterIndex, trackIndex } = requireTrack(draft, trackId);
    const tracks = draft.chapters[chapterIndex]!.tracks;
    const [track] = tracks.splice(trackIndex, 1);
    tracks.splice(Math.max(0, Math.min(toIndex, tracks.length)), 0, track!);
  };

// --- Clips ---------------------------------------------------------------------

/** Adds a clip to a track at the free position nearest to `clip.start`. */
export const addClip =
  (trackId: string, clip: Clip): Recipe =>
  (draft) => {
    const { chapterIndex, track } = requireTrack(draft, trackId);
    const placed = { ...clip, start: nearestFreeStart(track, clip.start, clip.duration) } as Clip;
    track.clips.push(placed);
    sortClips(track);
    growChapter(draft.chapters[chapterIndex]!);
  };

export const removeClips =
  (clipIds: readonly string[]): Recipe =>
  (draft) => {
    const ids = new Set(clipIds);
    for (const chapter of draft.chapters) {
      for (const track of chapter.tracks) track.clips = track.clips.filter((c) => !ids.has(c.id));
    }
  };

/**
 * Moves a clip to `start` on `trackId` (default: its own track). The target
 * track must be in the same chapter. Overlaps are resolved to the nearest
 * free position.
 */
export const moveClip =
  (clipId: string, start: number, trackId?: string): Recipe =>
  (draft) => {
    const from = requireClip(draft, clipId);
    const target = trackId ? requireTrack(draft, trackId) : from;
    if (target.chapterIndex !== from.chapterIndex)
      throw new Error('Clips can only move within a chapter');
    const clip = from.track.clips[from.clipIndex]!;
    const resolved = nearestFreeStart(target.track, start, clip.duration, new Set([clipId]));
    from.track.clips.splice(from.clipIndex, 1);
    clip.start = resolved;
    target.track.clips.push(clip);
    sortClips(target.track);
    growChapter(draft.chapters[from.chapterIndex]!);
  };

/**
 * Moves one edge of a clip to `time`. Moving the start edge of a video or
 * audio clip trims the media (like a video editor): the picture stays
 * where it is on the timeline.
 */
export const resizeClip =
  (clipId: string, edge: 'start' | 'end', time: number): Recipe =>
  (draft) => {
    const { track, clipIndex, chapterIndex } = requireClip(draft, clipId);
    const clip = track.clips[clipIndex]!;
    const { minStart, maxEnd } = resizeLimits(track, clip, MIN_CLIP_DURATION);
    const end = clip.start + clip.duration;
    const t = Math.round(time);
    if (edge === 'end') {
      const newEnd = Math.min(Math.max(t, clip.start + MIN_CLIP_DURATION), maxEnd);
      clip.duration = newEnd - clip.start;
    } else {
      let newStart = Math.max(Math.min(t, end - MIN_CLIP_DURATION), minStart);
      if (clip.type === 'video' || clip.type === 'audio') {
        const trim = clip.trimStart ?? 0;
        // Cannot reveal media before its first frame.
        newStart = Math.max(newStart, clip.start - trim);
        const newTrim = trim + (newStart - clip.start);
        if (newTrim > 0) clip.trimStart = newTrim;
        else delete clip.trimStart;
      }
      clip.duration = end - newStart;
      clip.start = newStart;
    }
    growChapter(draft.chapters[chapterIndex]!);
  };

/** Applies an arbitrary change to one clip (used by the properties panel). */
export const updateClip =
  (clipId: string, update: (clip: Clip) => void): Recipe =>
  (draft) => {
    const { track, clipIndex, chapterIndex } = requireClip(draft, clipId);
    const clip = track.clips[clipIndex]!;
    const { id, type } = clip;
    update(clip);
    if (clip.id !== id || clip.type !== type)
      throw new Error('updateClip must not change id or type');
    clip.start = Math.max(0, Math.round(clip.start));
    clip.duration = Math.max(MIN_CLIP_DURATION, Math.round(clip.duration));
    sortClips(track);
    growChapter(draft.chapters[chapterIndex]!);
  };

/** Splits a clip at `time` into two clips; the second gets `newId`. */
export const splitClip =
  (clipId: string, time: number, newId: string): Recipe =>
  (draft) => {
    const { track, clipIndex } = requireClip(draft, clipId);
    const clip = track.clips[clipIndex]!;
    const at = Math.round(time);
    const offset = at - clip.start;
    if (offset < MIN_CLIP_DURATION || clip.duration - offset < MIN_CLIP_DURATION) return;
    const second = cloneClip(clip);
    second.id = newId;
    second.start = at;
    second.duration = clip.duration - offset;
    if (second.type === 'video' || second.type === 'audio') {
      second.trimStart = (second.trimStart ?? 0) + offset;
    }
    clip.duration = offset;
    track.clips.splice(clipIndex + 1, 0, second);
  };

/** Copies a clip to the next free position after it on the same track. */
export const duplicateClip =
  (clipId: string, newId: string): Recipe =>
  (draft) => {
    const { track, clip, chapterIndex } = requireClip(draft, clipId);
    const copy = cloneClip(clip);
    copy.id = newId;
    copy.start = nearestFreeStart(track, clip.start + clip.duration, clip.duration);
    track.clips.push(copy);
    sortClips(track);
    growChapter(draft.chapters[chapterIndex]!);
  };

// --- Assets --------------------------------------------------------------------

export const addAsset =
  (assetId: string, asset: Asset): Recipe =>
  (draft) => {
    if (draft.assets[assetId]) throw new Error(`Asset "${assetId}" already exists`);
    draft.assets[assetId] = asset;
  };

export function assetUsage(course: Course, assetId: string): string[] {
  const users: string[] = [];
  const visit = (tracks: Track[]) => {
    for (const track of tracks) {
      for (const clip of track.clips) {
        const refs =
          clip.type === 'image'
            ? [clip.assetId]
            : clip.type === 'video' || clip.type === 'audio'
              ? [clip.assetId, clip.captionsAssetId]
              : [];
        if (refs.includes(assetId)) users.push(clip.id);
      }
    }
  };
  for (const chapter of course.chapters) visit(chapter.tracks);
  if (course.courseLayer) {
    visit(course.courseLayer.background);
    visit(course.courseLayer.foreground);
  }
  return users;
}

export const removeAsset =
  (assetId: string): Recipe =>
  (draft) => {
    const users = assetUsage(draft, assetId);
    if (users.length > 0) throw new Error(`Asset "${assetId}" is used by ${users.join(', ')}`);
    delete draft.assets[assetId];
  };
