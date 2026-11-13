// SPDX-License-Identifier: MIT
/**
 * Clipcourse course format, version 1.
 *
 * Conventions:
 * - All times and durations are integer milliseconds.
 * - All positions and sizes are in logical stage pixels (see {@link Stage}).
 * - Every chapter has its own timeline that starts at 0.
 * - Track order is the stacking order: `tracks[0]` is the back-most layer.
 */

export const FORMAT_VERSION = 1 as const;

export interface Course {
  formatVersion: typeof FORMAT_VERSION;
  /** Stable identifier, used as SCORM manifest identifier. */
  id: string;
  title: string;
  /** BCP 47 language tag of the course content, e.g. "en" or "de-CH". */
  language: string;
  stage: Stage;
  /** Media and caption files, referenced by id from clips. */
  assets: Record<string, Asset>;
  /** Elements shown in every chapter (background, logo, …). Optional. */
  courseLayer?: CourseLayer;
  chapters: Chapter[];
  /**
   * Namespaced data for features that are not part of the core format yet
   * (e.g. quizzes). Keys should be reverse-DNS or package names. Players
   * ignore unknown extensions.
   */
  extensions?: Record<string, unknown>;
}

export interface Stage {
  /** Logical width, e.g. 1920. The player scales the stage to fit. */
  width: number;
  /** Logical height, e.g. 1080. */
  height: number;
  /** CSS color of the stage behind all layers. */
  background: string;
}

export type AssetKind = 'image' | 'video' | 'audio' | 'captions';

export interface Asset {
  kind: AssetKind;
  /**
   * Relative path inside the project (e.g. "assets/intro.mp4") or an absolute
   * http(s) URL. External URLs make the exported course depend on network
   * access.
   */
  src: string;
  /** MIME type, e.g. "video/mp4". Optional, used for export and players. */
  mime?: string;
  /** Default alternative text for images. Clips may override it. */
  alt?: string;
  /** Original duration of video/audio in ms, if known. */
  duration?: number;
}

export interface CourseLayer {
  /** Tracks rendered behind every chapter's own tracks. */
  background: Track[];
  /** Tracks rendered in front of every chapter's own tracks. */
  foreground: Track[];
}

export type ChapterTransition =
  /** Pause at the end and wait for the learner to continue (default). */
  | { mode: 'wait' }
  /** Continue with the next chapter automatically. */
  | { mode: 'auto' };

export interface Chapter {
  id: string;
  title: string;
  /** Length of the chapter timeline in ms. Must be > 0. */
  duration: number;
  transition: ChapterTransition;
  /** Optional chapter background color, drawn above the stage background. */
  background?: string;
  tracks: Track[];
}

export interface Track {
  id: string;
  name?: string;
  /** Hidden tracks are not rendered (and not played, for media). */
  hidden?: boolean;
  /** Muted tracks render normally but play media without sound. */
  muted?: boolean;
  clips: Clip[];
}

export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in degrees, clockwise, around the frame center. */
  rotation?: number;
}

interface ClipBase {
  id: string;
  /** Start on the chapter timeline, ms. */
  start: number;
  /** Duration on the chapter timeline, ms. Must be > 0. */
  duration: number;
}

interface VisualClipBase extends ClipBase {
  frame: Frame;
  /** 0..1, default 1. */
  opacity?: number;
}

export type ImageFit = 'contain' | 'cover' | 'fill';

export interface ImageClip extends VisualClipBase {
  type: 'image';
  assetId: string;
  fit?: ImageFit;
  /** Overrides the asset's alt text. Empty string marks the image decorative. */
  alt?: string;
}

export interface TextStyle {
  fontFamily?: string;
  /** Logical pixels. */
  fontSize?: number;
  fontWeight?: number;
  italic?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
}

export interface TextClip extends VisualClipBase {
  type: 'text';
  /** Plain text. Line breaks are kept. */
  text: string;
  style?: TextStyle;
  /** Semantic role for assistive technology. */
  role?: 'heading' | 'paragraph';
}

export interface ShapeClip extends VisualClipBase {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** Corner radius for rect. */
  radius?: number;
}

export interface BoxClip extends VisualClipBase {
  type: 'box';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  padding?: number;
  text?: string;
  style?: TextStyle;
}

interface MediaProps {
  assetId: string;
  /** Offset into the media file where playback starts, ms. Default 0. */
  trimStart?: number;
  /** 0..1, default 1. */
  volume?: number;
  /** Asset id of a WebVTT captions asset. */
  captionsAssetId?: string;
}

export interface VideoClip extends VisualClipBase, MediaProps {
  type: 'video';
  fit?: ImageFit;
  muted?: boolean;
}

export interface AudioClip extends ClipBase, MediaProps {
  type: 'audio';
}

export type VisualClip = ImageClip | TextClip | ShapeClip | BoxClip | VideoClip;
export type MediaClip = VideoClip | AudioClip;
export type Clip = VisualClip | AudioClip;
export type ClipType = Clip['type'];

export function isVisualClip(clip: Clip): clip is VisualClip {
  return clip.type !== 'audio';
}

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.type === 'video' || clip.type === 'audio';
}

export function clipEnd(clip: Clip): number {
  return clip.start + clip.duration;
}
