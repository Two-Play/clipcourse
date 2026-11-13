// SPDX-License-Identifier: MIT
/**
 * Clipcourse course format, version 3.
 *
 * Version history:
 * - 1: courses, chapters, tracks, clips (image, text, shape, box, video,
 *      audio), course layer, captions.
 * - 2: clip animations (in/out), highlight and progress clips, chapter
 *      markers. Purely additive: every v1 document is a valid v2 document
 *      once its version number is raised.
 * - 3: questions (question clips that pause the timeline, quiz chapters)
 *      and course assessment (passing score). Additive as well.
 *
 * Conventions:
 * - All times and durations are integer milliseconds.
 * - All positions and sizes are in logical stage pixels (see {@link Stage}).
 * - Every chapter has its own timeline that starts at 0.
 * - Track order is the stacking order: `tracks[0]` is the back-most layer.
 */

export const FORMAT_VERSION = 3 as const;

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
  /** Scoring of the course's questions; without it, questions are practice only. */
  assessment?: Assessment;
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
  /** Jump points inside the chapter, shown in the table of contents. */
  markers?: Marker[];
  tracks: Track[];
  /**
   * Makes this a quiz chapter: the player shows the questions one after
   * another (over the chapter's tracks at time 0) instead of playing the
   * timeline. The chapter counts as seen when the quiz is finished.
   */
  quiz?: Quiz;
}

export interface Assessment {
  /** Percentage (0–100) of the scored points needed to pass. */
  passingScore: number;
}

export interface Quiz {
  questions: Question[];
  /** Shuffle the question order (deterministic per learner attempt is not needed: fixed seed). */
  shuffle?: boolean;
  /** How often the learner may restart the quiz after finishing it. Default 0. */
  retries?: number;
}

export type QuestionKind = 'single' | 'multiple' | 'text' | 'order' | 'match' | 'hotspot';

export interface Choice {
  id: string;
  text: string;
}

interface QuestionBase {
  /** Stable id: used for progress and as SCORM interaction id. */
  id: string;
  prompt: string;
  /** Points for a correct answer, default 1. */
  points?: number;
  /** Counts towards the course score, default true. */
  scored?: boolean;
  /** Allowed attempts; 0 means unlimited. Default 1. */
  attempts?: number;
  /** Show the correct answer after the last attempt. Default true. */
  showSolution?: boolean;
  feedback?: { correct?: string; incorrect?: string };
}

/** One correct choice (also true/false). */
export interface SingleChoiceQuestion extends QuestionBase {
  kind: 'single';
  choices: Choice[];
  correct: string;
}

/** Several correct choices; all of them and nothing else must be selected. */
export interface MultipleChoiceQuestion extends QuestionBase {
  kind: 'multiple';
  choices: Choice[];
  correct: string[];
}

/** Free text compared with accepted answers (trimmed, spaces collapsed). */
export interface TextQuestion extends QuestionBase {
  kind: 'text';
  answers: string[];
  caseSensitive?: boolean;
}

/** Bring items into order; `items` is the correct order. */
export interface OrderQuestion extends QuestionBase {
  kind: 'order';
  items: Choice[];
}

/** Match each left item to its right item. */
export interface MatchQuestion extends QuestionBase {
  kind: 'match';
  pairs: { id: string; left: string; right: string }[];
}

/** Click the right place in an image. Areas are relative to the image (0–1). */
export interface HotspotQuestion extends QuestionBase {
  kind: 'hotspot';
  assetId: string;
  alt?: string;
  areas: { id: string; label: string; x: number; y: number; width: number; height: number }[];
  /** Ids of the areas that count as correct. */
  correct: string[];
}

export type Question =
  | SingleChoiceQuestion
  | MultipleChoiceQuestion
  | TextQuestion
  | OrderQuestion
  | MatchQuestion
  | HotspotQuestion;

export interface Marker {
  id: string;
  /** Position on the chapter timeline, ms. */
  time: number;
  title: string;
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
  /** Entrance and exit animations. */
  animations?: ClipAnimations;
}

export type AnimationType = 'fade' | 'slide' | 'zoom';
export type SlideDirection = 'left' | 'right' | 'up' | 'down';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface Animation {
  type: AnimationType;
  /** ms; clamped to the clip duration when played. */
  duration: number;
  /** For "slide": the side the clip comes from (in) or leaves to (out). */
  direction?: SlideDirection;
  easing?: Easing;
}

export interface ClipAnimations {
  /** Plays at the start of the clip. */
  in?: Animation;
  /** Plays at the end of the clip. */
  out?: Animation;
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

export type HighlightKind =
  /** Semi-transparent area, like a text marker. */
  | 'marker'
  /** Outline around the area. */
  | 'frame'
  /** Arrow pointing at the right edge of the frame (rotate the frame to aim). */
  | 'arrow'
  /** Dims everything except the area. */
  | 'spotlight';

export interface HighlightClip extends VisualClipBase {
  type: 'highlight';
  kind: HighlightKind;
  /** Main color, default depends on the kind. */
  color?: string;
  /** Line width for frame and arrow, default 8. */
  strokeWidth?: number;
  /** Corner radius for marker, frame and spotlight. */
  radius?: number;
  /** Gently pulses while visible to draw attention. */
  pulse?: boolean;
  /** Read out by screen readers when the highlight appears. */
  label?: string;
}

/**
 * Shows how far the learner is in the whole course, based on the current
 * chapter and position (not on history), so it stays deterministic.
 */
export interface ProgressClip extends VisualClipBase {
  type: 'progress';
  fill?: string;
  /** Color of the unfilled part. */
  background?: string;
  radius?: number;
}

/**
 * A question on the timeline. When playback reaches its start, the player
 * pauses until the question is answered; the clip stays visible (with
 * feedback) until its end.
 */
export interface QuestionClip extends VisualClipBase {
  type: 'question';
  question: Question;
}

export type VisualClip =
  | ImageClip
  | TextClip
  | ShapeClip
  | BoxClip
  | VideoClip
  | HighlightClip
  | ProgressClip
  | QuestionClip;
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
