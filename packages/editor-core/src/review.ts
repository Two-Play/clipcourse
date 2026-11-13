// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Course review: validation plus accessibility and quality checks, written
 * so that both people and AI assistants can act on them.
 */
import type {
  Chapter,
  Clip,
  Course,
  Question,
  TextStyle,
  Track,
  VisualClip,
} from '@clipcourse/format';
import { validateCourse } from '@clipcourse/format/validation';

export type ReviewSeverity = 'error' | 'warning' | 'info';

export interface ReviewIssue {
  severity: ReviewSeverity;
  code: string;
  message: string;
  chapterId?: string;
  clipId?: string;
  assetId?: string;
  /** Concrete suggestion, if there is one. */
  fix?: string;
}

// --- Colors and contrast (WCAG 2.x) ------------------------------------------------

const NAMED: Record<string, [number, number, number]> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  orange: [255, 165, 0],
};

/** Parses hex, rgb()/rgba() and a few named colors. Returns null for anything else or transparent colors. */
export function parseColor(value: string | undefined): [number, number, number] | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (NAMED[v]) return NAMED[v];
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const [r, g, b, a] = [...m[1]!].map((c) => parseInt(c + c, 16));
    if (a !== undefined && a < 255) return null;
    return [r!, g!, b!];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) {
    if (m[2] && parseInt(m[2], 16) < 255) return null;
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    if (m[4] !== undefined) {
      const alpha = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      if (alpha < 1) return null;
    }
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  return null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

// --- Helpers ------------------------------------------------------------------------

function textOf(clip: Clip): { text: string; style: TextStyle | undefined } | null {
  if (clip.type === 'text') return { text: clip.text, style: clip.style };
  if (clip.type === 'box' && clip.text) return { text: clip.text, style: clip.style };
  return null;
}

function overlaps(a: VisualClip, b: VisualClip): boolean {
  const fa = a.frame;
  const fb = b.frame;
  const timeOverlap = a.start < b.start + b.duration && b.start < a.start + a.duration;
  return (
    timeOverlap &&
    fa.x < fb.x + fb.width &&
    fb.x < fa.x + fa.width &&
    fa.y < fb.y + fb.height &&
    fb.y < fa.y + fa.height
  );
}

/** The opaque color behind a text clip, as far as it can be determined. */
function backgroundBehind(
  course: Course,
  chapter: Chapter,
  tracks: Track[],
  trackIndex: number,
  clip: VisualClip,
): string | null {
  if (clip.type === 'box' && clip.fill) return clip.fill;
  for (let i = trackIndex - 1; i >= 0; i--) {
    for (const other of tracks[i]!.clips) {
      if (other.type === 'audio' || !overlaps(clip, other)) continue;
      const covers =
        other.frame.x <= clip.frame.x &&
        other.frame.y <= clip.frame.y &&
        other.frame.x + other.frame.width >= clip.frame.x + clip.frame.width &&
        other.frame.y + other.frame.height >= clip.frame.y + clip.frame.height;
      if (!covers) return null; // partly covered: unknown
      if (
        other.type === 'box' ||
        (other.type === 'shape' && (other.shape === 'rect' || other.shape === 'ellipse'))
      ) {
        if (other.fill) return other.fill;
        continue;
      }
      return null; // image, video, …: cannot judge
    }
  }
  return chapter.background ?? course.stage.background;
}

/** Rough reading time: 2.5 words per second plus one second to notice the text. */
export function readingTime(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.round(1000 + (words / 2.5) * 1000);
}

// --- Review ---------------------------------------------------------------------------

export function reviewCourse(course: Course): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const result = validateCourse(course);
  if (!result.ok) {
    for (const issue of result.issues) {
      issues.push({
        severity: 'error',
        code: 'invalid',
        message: `${issue.path}: ${issue.message}`,
      });
    }
    return issues;
  }
  for (const warning of result.warnings) {
    issues.push({
      severity: 'warning',
      code: 'validation',
      message: `${warning.path}: ${warning.message}`,
    });
  }

  const reviewQuestion = (question: Question, where: { chapterId: string; clipId?: string }) => {
    if (question.kind !== 'hotspot') return;
    usedAssets.add(question.assetId);
    if (question.alt === undefined && course.assets[question.assetId]?.alt === undefined) {
      issues.push({
        severity: 'warning',
        code: 'missing-alt',
        ...where,
        message: `The image of question ${question.id} has no alternative text.`,
        fix: 'Describe the image in the question\'s "alt". Learners without sight answer with the labelled area buttons.',
      });
    }
  };

  const minFont = (course.stage.width / 1920) * 28;
  const largeFont = (course.stage.width / 1920) * 48;
  const usedAssets = new Set<string>();

  for (const chapter of course.chapters) {
    const tracks = chapter.tracks;
    const clipCount = tracks.reduce((n, t) => n + t.clips.length, 0);
    if (clipCount === 0 && !chapter.quiz) {
      issues.push({
        severity: 'warning',
        code: 'empty-chapter',
        chapterId: chapter.id,
        message: `Chapter "${chapter.title}" has no content.`,
      });
    }
    if (chapter.duration > 180000 && !chapter.markers?.length) {
      issues.push({
        severity: 'info',
        code: 'long-chapter',
        chapterId: chapter.id,
        message: `Chapter "${chapter.title}" is ${Math.round(chapter.duration / 60000)} minutes long and has no markers.`,
        fix: 'Add markers so learners can jump to sections, or split the chapter.',
      });
    }

    tracks.forEach((track, trackIndex) => {
      for (const clip of track.clips) {
        if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio')
          usedAssets.add(clip.assetId);
        if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId)
          usedAssets.add(clip.captionsAssetId);
        const where = { chapterId: chapter.id, clipId: clip.id };
        if (clip.type === 'question') reviewQuestion(clip.question, where);

        if (clip.type === 'image') {
          const alt = clip.alt ?? course.assets[clip.assetId]?.alt;
          if (alt === undefined) {
            issues.push({
              severity: 'warning',
              code: 'missing-alt',
              ...where,
              message: `Image ${clip.id} in "${chapter.title}" has no alternative text.`,
              fix: 'Describe the image in "alt", or set alt to "" if it is purely decorative.',
            });
          }
        }
        if (
          (clip.type === 'video' && !clip.muted && !track.muted) ||
          (clip.type === 'audio' && !track.muted)
        ) {
          if (!clip.captionsAssetId) {
            issues.push({
              severity: 'warning',
              code: 'missing-captions',
              ...where,
              message: `${clip.type === 'video' ? 'Video' : 'Audio'} ${clip.id} in "${chapter.title}" has no captions.`,
              fix: 'Import a WebVTT file and set captionsAssetId, unless the clip has no speech.',
            });
          }
        }

        const text = textOf(clip);
        if (text && clip.type !== 'audio') {
          const size = text.style?.fontSize ?? 48;
          if (size < minFont) {
            issues.push({
              severity: 'warning',
              code: 'small-text',
              ...where,
              message: `Text in ${clip.id} uses font size ${size}, which is hard to read on small screens.`,
              fix: `Use at least ${Math.ceil(minFont)}.`,
            });
          }
          const fg = parseColor(text.style?.color ?? '#ffffff');
          const bg = parseColor(
            backgroundBehind(course, chapter, tracks, trackIndex, clip) ?? undefined,
          );
          if (fg && bg) {
            const ratio = contrastRatio(fg, bg);
            const needed = size >= largeFont || (text.style?.fontWeight ?? 400) >= 700 ? 3 : 4.5;
            if (ratio < needed) {
              issues.push({
                severity: 'warning',
                code: 'low-contrast',
                ...where,
                message: `Text in ${clip.id} has a contrast ratio of ${ratio.toFixed(1)}:1 (WCAG AA needs ${needed}:1).`,
                fix: 'Change the text color or the background.',
              });
            }
          }
          const needed = readingTime(text.text);
          if (clip.duration < needed && clip.duration < chapter.duration - clip.start) {
            issues.push({
              severity: 'info',
              code: 'short-text',
              ...where,
              message: `Text in ${clip.id} is shown for ${(clip.duration / 1000).toFixed(1)} s; reading it takes about ${(needed / 1000).toFixed(1)} s.`,
              fix: `Show it for at least ${(needed / 1000).toFixed(1)} s.`,
            });
          }
        }
      }
    });
  }

  for (const chapter of course.chapters) {
    for (const question of chapter.quiz?.questions ?? []) {
      reviewQuestion(question, { chapterId: chapter.id });
    }
  }

  const scored = course.chapters.flatMap((chapter) => [
    ...(chapter.quiz?.questions ?? []),
    ...chapter.tracks.flatMap((t) =>
      t.clips.flatMap((c) => (c.type === 'question' ? [c.question] : [])),
    ),
  ]);
  const scoredCount = scored.filter((q) => q.scored !== false).length;
  if (scoredCount > 0 && !course.assessment) {
    issues.push({
      severity: 'info',
      code: 'no-passing-score',
      message: `The course has ${scoredCount} scored question(s) but no passing score: the LMS gets a score, but no passed/failed.`,
      fix: 'Set a passing score (set_assessment) if learners should pass or fail.',
    });
  }
  if (course.assessment && scoredCount === 0) {
    issues.push({
      severity: 'warning',
      code: 'passing-score-without-questions',
      message: 'A passing score is set, but the course has no scored questions.',
      fix: 'Add questions, or remove the passing score.',
    });
  }

  for (const track of [
    ...(course.courseLayer?.background ?? []),
    ...(course.courseLayer?.foreground ?? []),
  ]) {
    for (const clip of track.clips) {
      if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio')
        usedAssets.add(clip.assetId);
    }
  }
  for (const assetId of Object.keys(course.assets)) {
    if (!usedAssets.has(assetId)) {
      issues.push({
        severity: 'info',
        code: 'unused-asset',
        assetId,
        message: `Media "${assetId}" is not used.`,
      });
    }
  }
  return issues;
}
