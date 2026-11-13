// SPDX-License-Identifier: MIT
/**
 * Pure scene evaluation: (course, chapter, time) → what is on stage.
 *
 * This is the heart of the deterministic player. Rendering, media sync and
 * captions all derive from the result, so seeking, pausing or jumping to a
 * chapter always produce the same picture for the same time.
 */
import type { Chapter, Clip, Course, Track } from '@clipcourse/format';

export type LayerName = 'background' | 'chapter' | 'foreground';

export interface ActiveClip {
  clip: Clip;
  layer: LayerName;
  trackId: string;
  /** Stacking order, ascending = further back. Stable for a given chapter. */
  z: number;
  /** Time since the clip started, ms. */
  localTime: number;
  /** Position in the media file for video/audio clips, ms. */
  mediaTime: number | null;
  /** True if the clip's track is muted. */
  trackMuted: boolean;
}

export interface SceneState {
  chapterIndex: number;
  /** Chapter time used for evaluation (clamped to [0, duration]). */
  time: number;
  clips: ActiveClip[];
}

/** Clamps a time to the chapter's timeline and rounds to whole ms. */
export function clampTime(chapter: Chapter, time: number): number {
  if (!Number.isFinite(time)) return 0;
  return Math.min(Math.max(Math.round(time), 0), chapter.duration);
}

/**
 * A clip is active on [start, end). At the very end of the chapter the last
 * frame is held: clips that reach the chapter end stay visible at
 * `time === duration`, so a paused-at-end chapter does not go blank.
 */
export function isClipActive(clip: Clip, time: number, chapterDuration: number): boolean {
  const end = clip.start + clip.duration;
  if (clip.start >= chapterDuration) return false;
  if (time >= clip.start && time < end) return true;
  return time === chapterDuration && end >= chapterDuration;
}

export interface OrderedTrack {
  track: Track;
  layer: LayerName;
}

/** All tracks of a chapter in stacking order, including the course layer. */
export function orderedTracks(course: Course, chapter: Chapter): OrderedTrack[] {
  const result: OrderedTrack[] = [];
  for (const track of course.courseLayer?.background ?? []) {
    result.push({ track, layer: 'background' });
  }
  for (const track of chapter.tracks) result.push({ track, layer: 'chapter' });
  for (const track of course.courseLayer?.foreground ?? []) {
    result.push({ track, layer: 'foreground' });
  }
  return result;
}

export function evaluate(course: Course, chapterIndex: number, time: number): SceneState {
  const chapter = course.chapters[chapterIndex];
  if (!chapter) throw new RangeError(`No chapter at index ${chapterIndex}`);
  const t = clampTime(chapter, time);
  const clips: ActiveClip[] = [];
  let z = 0;

  for (const { track, layer } of orderedTracks(course, chapter)) {
    // Clips in one track are stacked by start time, then by array order,
    // so overlapping clips (which the editor avoids) still render stably.
    const sorted = track.clips
      .map((clip, index) => ({ clip, index }))
      .sort((a, b) => a.clip.start - b.clip.start || a.index - b.index);
    for (const { clip } of sorted) {
      z += 1;
      if (track.hidden) continue;
      if (!isClipActive(clip, t, chapter.duration)) continue;
      const localTime = Math.min(t - clip.start, clip.duration);
      const mediaTime =
        clip.type === 'video' || clip.type === 'audio' ? (clip.trimStart ?? 0) + localTime : null;
      clips.push({
        clip,
        layer,
        trackId: track.id,
        z,
        localTime,
        mediaTime,
        trackMuted: track.muted === true,
      });
    }
  }

  return { chapterIndex, time: t, clips };
}
