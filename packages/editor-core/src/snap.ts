// SPDX-License-Identifier: AGPL-3.0-only
/** Snapping of times to interesting points while dragging. */
import type { Chapter } from '@clipcourse/format';

export interface SnapResult {
  time: number;
  /** The point snapped to, or null if the time was left as is. */
  target: number | null;
}

/** Snap points of a chapter: 0, its end, the playhead and all clip edges. */
export function snapPoints(
  chapter: Chapter,
  playhead: number | null,
  ignore: ReadonlySet<string> = new Set(),
): number[] {
  const points = new Set<number>([0, chapter.duration]);
  if (playhead !== null) points.add(playhead);
  for (const track of chapter.tracks) {
    for (const clip of track.clips) {
      if (ignore.has(clip.id)) continue;
      points.add(clip.start);
      points.add(clip.start + clip.duration);
    }
  }
  return [...points].sort((a, b) => a - b);
}

/** Snaps `time` to the closest point within `threshold` ms. */
export function snapTime(time: number, points: readonly number[], threshold: number): SnapResult {
  let best: number | null = null;
  let distance = threshold;
  for (const point of points) {
    const d = Math.abs(point - time);
    if (d <= distance) {
      best = point;
      distance = d;
    }
  }
  return best === null ? { time, target: null } : { time: best, target: best };
}

/**
 * Snaps a moving block [start, start + duration): whichever edge is closer
 * to a snap point wins.
 */
export function snapBlock(start: number, duration: number, points: readonly number[], threshold: number): SnapResult {
  const head = snapTime(start, points, threshold);
  const tail = snapTime(start + duration, points, threshold);
  const headDistance = head.target === null ? Infinity : Math.abs(head.target - start);
  const tailDistance = tail.target === null ? Infinity : Math.abs(tail.target - (start + duration));
  if (headDistance === Infinity && tailDistance === Infinity) return { time: start, target: null };
  return headDistance <= tailDistance
    ? { time: head.time, target: head.target }
    : { time: tail.time - duration, target: tail.target };
}

/** Grid step (ms) for a zoom level so ruler labels stay readable. */
export function gridStep(pxPerSecond: number, minLabelPx = 80): number {
  const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
  for (const step of steps) if ((step / 1000) * pxPerSecond >= minLabelPx) return step;
  return steps[steps.length - 1]!;
}
