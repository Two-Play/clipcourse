// SPDX-License-Identifier: MIT
/**
 * Keeps <video>/<audio> elements in step with the timeline. The timeline is
 * the master clock; media elements follow it.
 */

/** The subset of HTMLMediaElement used here (makes the logic testable). */
export interface MediaLike {
  paused: boolean;
  currentTime: number;
  readyState: number;
  ended: boolean;
  seeking: boolean;
  error: unknown;
  muted: boolean;
  volume: number;
  play(): Promise<void> | void;
  pause(): void;
}

export interface MediaTarget {
  active: boolean;
  playing: boolean;
  /** Expected position in the media file, ms. */
  mediaTime: number;
  muted: boolean;
  volume: number;
}

/** Drift (s) tolerated while playing before re-seeking the element. */
export const PLAYING_TOLERANCE = 0.3;
/** Drift (s) tolerated while paused (frame accuracy for seeks). */
export const PAUSED_TOLERANCE = 0.04;
const HAVE_FUTURE_DATA = 3;

export type PlayBlockedHandler = (error: unknown) => void;

export function syncMedia(el: MediaLike, target: MediaTarget, onBlocked: PlayBlockedHandler): void {
  if (el.muted !== target.muted) el.muted = target.muted;
  if (el.volume !== target.volume) el.volume = target.volume;

  if (!target.active) {
    if (!el.paused) el.pause();
    return;
  }

  const expected = target.mediaTime / 1000;
  const drift = Math.abs(el.currentTime - expected);

  if (target.playing) {
    if (el.paused) {
      if (drift > PAUSED_TOLERANCE) el.currentTime = expected;
      const result = el.play();
      if (result && typeof result.catch === 'function') result.catch(onBlocked);
    } else if (drift > PLAYING_TOLERANCE) {
      el.currentTime = expected;
    }
  } else {
    if (!el.paused) el.pause();
    if (drift > PAUSED_TOLERANCE) el.currentTime = expected;
  }
}

/**
 * True if an active, playing element cannot keep up and the timeline should
 * wait for it. Broken elements never stall the timeline.
 */
export function isMediaStalled(el: MediaLike, target: MediaTarget): boolean {
  if (!target.active || !target.playing) return false;
  if (el.error || el.ended) return false;
  return el.seeking || el.readyState < HAVE_FUTURE_DATA;
}
