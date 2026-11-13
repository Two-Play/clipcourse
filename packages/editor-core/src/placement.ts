// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Placement rules for clips on a track: clips on the same track never
 * overlap. Moves and resizes are resolved to the nearest valid position
 * instead of being rejected, which feels natural while dragging.
 */
import type { Clip, Track } from '@clipcourse/format';

export interface Interval {
  start: number;
  end: number;
}

/** Occupied intervals on a track, sorted, ignoring the given clip ids. */
export function occupied(track: Track, ignore: ReadonlySet<string> = new Set()): Interval[] {
  return track.clips
    .filter((c) => !ignore.has(c.id))
    .map((c) => ({ start: c.start, end: c.start + c.duration }))
    .sort((a, b) => a.start - b.start);
}

/** Free gaps on a track (the last gap is open-ended). */
export function freeGaps(track: Track, ignore: ReadonlySet<string> = new Set()): Interval[] {
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const block of occupied(track, ignore)) {
    if (block.start > cursor) gaps.push({ start: cursor, end: block.start });
    cursor = Math.max(cursor, block.end);
  }
  gaps.push({ start: cursor, end: Number.POSITIVE_INFINITY });
  return gaps;
}

export function fits(track: Track, start: number, duration: number, ignore?: ReadonlySet<string>): boolean {
  if (start < 0) return false;
  const end = start + duration;
  return occupied(track, ignore).every((b) => end <= b.start || start >= b.end);
}

/**
 * The valid start closest to `desired` for a clip of `duration` on `track`.
 * Always succeeds, because the space after the last clip is unbounded.
 */
export function nearestFreeStart(
  track: Track,
  desired: number,
  duration: number,
  ignore?: ReadonlySet<string>,
): number {
  const want = Math.max(0, Math.round(desired));
  let best = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const gap of freeGaps(track, ignore)) {
    if (gap.end - gap.start < duration) continue;
    const candidate = Math.min(Math.max(want, gap.start), gap.end - duration);
    const distance = Math.abs(candidate - want);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Limits for resizing one edge of a clip so it does not run into its
 * neighbours (or below 0 / below the minimum duration).
 */
export function resizeLimits(track: Track, clip: Clip, minDuration: number): { minStart: number; maxEnd: number } {
  let minStart = 0;
  let maxEnd = Number.POSITIVE_INFINITY;
  const end = clip.start + clip.duration;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    const otherEnd = other.start + other.duration;
    if (otherEnd <= clip.start) minStart = Math.max(minStart, otherEnd);
    if (other.start >= end) maxEnd = Math.min(maxEnd, other.start);
  }
  return { minStart: Math.min(minStart, end - minDuration), maxEnd: Math.max(maxEnd, clip.start + minDuration) };
}
