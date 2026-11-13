// SPDX-License-Identifier: AGPL-3.0-only
/** Pure helpers for timeline and stage geometry (unit tested). */
import type { Chapter, Clip, Course, Frame, Track, VisualClip } from '@clipcourse/format';
import { evaluate } from '@clipcourse/player';
import { t, type MessageKey } from './i18n.js';

export const msToPx = (ms: number, zoom: number) => (ms * zoom) / 1000;
export const pxToMs = (px: number, zoom: number) => Math.round((px * 1000) / zoom);

/** Tracks as shown in the timeline: front-most on top (reverse of the format order). */
export function displayTracks(chapter: Chapter): Track[] {
  return [...chapter.tracks].reverse();
}

const LABEL_KEYS: Record<Clip['type'], MessageKey> = {
  image: 'clipLabelImage',
  video: 'clipLabelVideo',
  audio: 'clipLabelAudio',
  shape: 'clipLabelShape',
  box: 'clipLabelBox',
  text: 'clipLabelText',
  highlight: 'clipLabelHighlight',
  progress: 'clipLabelProgress',
  question: 'clipLabelQuestion',
  button: 'clipLabelButton',
};

/** Short human label for a clip on the timeline. */
export function clipLabel(clip: Clip, course: Course): string {
  const kind = t(LABEL_KEYS[clip.type]);
  if (clip.type === 'text') return clip.text.split('\n')[0]!.slice(0, 60) || kind;
  if (clip.type === 'button') return `${kind}: ${clip.text.slice(0, 60)}`;
  if (clip.type === 'box' && clip.text) return clip.text.split('\n')[0]!.slice(0, 60);
  if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio') {
    const src = course.assets[clip.assetId]?.src ?? '';
    return `${kind}: ${src.split('/').pop()}`;
  }
  if (clip.type === 'shape') return `${kind}: ${clip.shape}`;
  if (clip.type === 'highlight') return `${kind}: ${clip.label || clip.kind}`;
  if (clip.type === 'question')
    return `${kind}: ${clip.question.prompt.split('\n')[0]!.slice(0, 60)}`;
  return kind;
}

/** Formats ms as m:ss.t for the ruler and inputs. */
export function formatTimecode(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const tenth = Math.floor((total % 1000) / 100);
  return `${m}:${String(s).padStart(2, '0')}.${tenth}`;
}

/** Topmost visible clip at a stage point, or null. */
export function hitTest(
  course: Course,
  chapterIndex: number,
  time: number,
  x: number,
  y: number,
): VisualClip | null {
  const scene = evaluate(course, chapterIndex, time);
  for (let i = scene.clips.length - 1; i >= 0; i--) {
    const { clip } = scene.clips[i]!;
    if (clip.type === 'audio') continue;
    if (pointInFrame(clip.frame, x, y)) return clip;
  }
  return null;
}

/** Point-in-frame test that respects rotation. */
export function pointInFrame(frame: Frame, x: number, y: number): boolean {
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const angle = (-(frame.rotation ?? 0) * Math.PI) / 180;
  const dx = x - cx;
  const dy = y - cy;
  const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(rx) <= frame.width / 2 && Math.abs(ry) <= frame.height / 2;
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se';

/** New frame after dragging a corner handle by (dx, dy) stage pixels. */
export function resizeFrame(frame: Frame, handle: Handle, dx: number, dy: number, min = 10): Frame {
  let { x, y, width, height } = frame;
  if (handle === 'nw' || handle === 'sw') {
    const nx = Math.min(x + dx, x + width - min);
    width = width + (x - nx);
    x = nx;
  } else {
    width = Math.max(min, width + dx);
  }
  if (handle === 'nw' || handle === 'ne') {
    const ny = Math.min(y + dy, y + height - min);
    height = height + (y - ny);
    y = ny;
  } else {
    height = Math.max(min, height + dy);
  }
  const result: Frame = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  };
  if (frame.rotation !== undefined) result.rotation = frame.rotation;
  return result;
}
