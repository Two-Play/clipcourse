// SPDX-License-Identifier: MIT
import * as v from 'valibot';
import { CourseSchema } from './schema.js';
import { migrateCourse, FormatVersionError } from './migrate.js';
import type { Clip, ClipAction, Course, Question, Track } from './types.js';

export interface ValidationIssue {
  /** JSON-pointer-like path, e.g. "/chapters/0/tracks/1/clips/2/assetId". */
  path: string;
  message: string;
}

export type ValidationResult =
  | { ok: true; course: Course; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] };

/**
 * Migrates `input` to the current format version and validates it, both
 * structurally (schema) and semantically (unique ids, asset references).
 */
export function validateCourse(input: unknown): ValidationResult {
  let migrated: unknown;
  try {
    migrated = migrateCourse(input);
  } catch (error) {
    if (error instanceof FormatVersionError) {
      return { ok: false, issues: [{ path: '/formatVersion', message: error.message }] };
    }
    throw error;
  }

  const parsed = v.safeParse(CourseSchema, migrated);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.issues.map((issue) => ({
        path: toPointer(issue.path),
        message: issue.message,
      })),
    };
  }

  const course = parsed.output;
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  checkSemantics(course, issues, warnings);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, course, warnings };
}

/** Like {@link validateCourse}, but throws on invalid input. */
export function parseCourse(input: unknown): Course {
  const result = validateCourse(input);
  if (!result.ok) {
    const details = result.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
    throw new Error(`Invalid course:\n${details}`);
  }
  return result.course;
}

function toPointer(path: v.IssuePathItem[] | undefined): string {
  if (!path || path.length === 0) return '/';
  return '/' + path.map((item) => String(item.key)).join('/');
}

function checkSemantics(course: Course, issues: ValidationIssue[], warnings: ValidationIssue[]) {
  const chapterIds = new Set<string>();
  const trackIds = new Set<string>();
  const clipIds = new Set<string>();

  const checkUnique = (set: Set<string>, value: string, path: string, what: string) => {
    if (set.has(value)) issues.push({ path, message: `Duplicate ${what} id "${value}"` });
    set.add(value);
  };

  const checkAsset = (assetId: string, kinds: string[], path: string) => {
    const asset = course.assets[assetId];
    if (!asset) {
      issues.push({ path, message: `Unknown asset "${assetId}"` });
    } else if (!kinds.includes(asset.kind)) {
      issues.push({
        path,
        message: `Asset "${assetId}" has kind "${asset.kind}", expected ${kinds.join(' or ')}`,
      });
    }
  };

  const checkTracks = (tracks: Track[], basePath: string, chapterDuration: number | null) => {
    tracks.forEach((track, ti) => {
      const trackPath = `${basePath}/${ti}`;
      checkUnique(trackIds, track.id, `${trackPath}/id`, 'track');
      const sorted = [...track.clips].sort((a, b) => a.start - b.start);
      for (let k = 1; k < sorted.length; k++) {
        const prev = sorted[k - 1]!;
        const clip = sorted[k]!;
        if (clip.start < prev.start + prev.duration) {
          warnings.push({
            path: trackPath,
            message: `Clips "${prev.id}" and "${clip.id}" overlap on track "${track.id}"; the editor expects one clip at a time per track`,
          });
        }
      }
      track.clips.forEach((clip, ci) => {
        const clipPath = `${trackPath}/clips/${ci}`;
        checkUnique(clipIds, clip.id, `${clipPath}/id`, 'clip');
        switch (clip.type) {
          case 'image':
            checkAsset(clip.assetId, ['image'], `${clipPath}/assetId`);
            break;
          case 'video':
            checkAsset(clip.assetId, ['video'], `${clipPath}/assetId`);
            break;
          case 'audio':
            checkAsset(clip.assetId, ['audio', 'video'], `${clipPath}/assetId`);
            break;
          default:
            break;
        }
        if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId) {
          checkAsset(clip.captionsAssetId, ['captions'], `${clipPath}/captionsAssetId`);
        }
        if (chapterDuration !== null && clip.start + clip.duration > chapterDuration) {
          warnings.push({
            path: clipPath,
            message: `Clip "${clip.id}" ends after the chapter and will be cut off`,
          });
        }
      });
    });
  };

  if (course.courseLayer) {
    checkTracks(course.courseLayer.background, '/courseLayer/background', null);
    checkTracks(course.courseLayer.foreground, '/courseLayer/foreground', null);
  }

  const markerIds = new Set<string>();
  course.chapters.forEach((chapter, i) => {
    checkUnique(chapterIds, chapter.id, `/chapters/${i}/id`, 'chapter');
    chapter.markers?.forEach((marker, m) => {
      checkUnique(markerIds, marker.id, `/chapters/${i}/markers/${m}/id`, 'marker');
      if (marker.time > chapter.duration) {
        warnings.push({
          path: `/chapters/${i}/markers/${m}`,
          message: `Marker "${marker.title}" is after the end of chapter "${chapter.title}"`,
        });
      }
    });
    checkTracks(chapter.tracks, `/chapters/${i}/tracks`, chapter.duration);
  });

  // Questions: unique ids, answers that point to existing choices.
  const questionIds = new Set<string>();
  const checkQuestion = (question: Question, path: string) => {
    checkUnique(questionIds, question.id, `${path}/id`, 'question');
    const ref = (ids: string[], allowed: { id: string }[], field: string) => {
      const known = new Set(allowed.map((a) => a.id));
      if (known.size !== allowed.length)
        issues.push({ path, message: `Question "${question.id}" has duplicate ${field} ids` });
      for (const id of ids) {
        if (!known.has(id))
          issues.push({
            path: `${path}/correct`,
            message: `Question "${question.id}": unknown ${field} "${id}"`,
          });
      }
    };
    switch (question.kind) {
      case 'single':
        ref([question.correct], question.choices, 'choice');
        break;
      case 'multiple':
        ref(question.correct, question.choices, 'choice');
        break;
      case 'order':
        ref([], question.items, 'item');
        break;
      case 'match':
        ref([], question.pairs, 'pair');
        break;
      case 'hotspot':
        ref(question.correct, question.areas, 'area');
        checkAsset(question.assetId, ['image'], `${path}/assetId`);
        break;
      case 'text':
        break;
    }
  };
  course.chapters.forEach((chapter, i) => {
    chapter.tracks.forEach((track, ti) =>
      track.clips.forEach((clip, ci) => {
        if (clip.type === 'question')
          checkQuestion(clip.question, `/chapters/${i}/tracks/${ti}/clips/${ci}/question`);
      }),
    );
    chapter.quiz?.questions.forEach((question, qi) =>
      checkQuestion(question, `/chapters/${i}/quiz/questions/${qi}`),
    );
  });
  for (const tracks of [
    course.courseLayer?.background ?? [],
    course.courseLayer?.foreground ?? [],
  ]) {
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.type === 'question') {
          issues.push({
            path: '/courseLayer',
            message: `Question "${clip.id}" cannot be in the course layer`,
          });
        }
      }
    }
  }

  // Popups and glossary.
  const popupIds = new Set<string>();
  course.popups?.forEach((popup, i) => {
    checkUnique(popupIds, popup.id, `/popups/${i}/id`, 'popup');
    if (popup.assetId) checkAsset(popup.assetId, ['image'], `/popups/${i}/assetId`);
  });
  const glossaryIds = new Set<string>();
  course.glossary?.forEach((entry, i) =>
    checkUnique(glossaryIds, entry.id, `/glossary/${i}/id`, 'glossary entry'),
  );

  // Click actions point to things that exist.
  const checkAction = (clip: Clip, action: ClipAction, path: string) => {
    switch (action.type) {
      case 'goToChapter':
        if (!chapterIds.has(action.chapterId))
          issues.push({
            path,
            message: `Clip "${clip.id}": unknown chapter "${action.chapterId}"`,
          });
        break;
      case 'goToMarker': {
        const chapter = course.chapters.find((c) => c.id === action.chapterId);
        if (!chapter)
          issues.push({
            path,
            message: `Clip "${clip.id}": unknown chapter "${action.chapterId}"`,
          });
        else if (!chapter.markers?.some((m) => m.id === action.markerId))
          issues.push({
            path,
            message: `Clip "${clip.id}": chapter "${chapter.title}" has no marker "${action.markerId}"`,
          });
        break;
      }
      case 'openPopup':
        if (!popupIds.has(action.popupId))
          issues.push({ path, message: `Clip "${clip.id}": unknown popup "${action.popupId}"` });
        break;
      case 'setClipVisibility':
        if (!clipIds.has(action.clipId))
          issues.push({ path, message: `Clip "${clip.id}": unknown clip "${action.clipId}"` });
        else if (action.clipId === clip.id && action.visible !== 'hide')
          warnings.push({
            path,
            message: `Clip "${clip.id}" shows itself; it can only hide itself`,
          });
        break;
      case 'openUrl':
        break;
    }
  };
  const checkClipActions = (tracks: Track[], basePath: string) =>
    tracks.forEach((track, ti) =>
      track.clips.forEach((clip, ci) => {
        if (clip.type === 'audio') return;
        const path = `${basePath}/${ti}/clips/${ci}/action`;
        if (clip.type === 'question' && clip.action) {
          issues.push({ path, message: `Question clip "${clip.id}" cannot have a click action` });
          return;
        }
        if (clip.action) checkAction(clip, clip.action, path);
      }),
    );
  checkClipActions(course.courseLayer?.background ?? [], '/courseLayer/background');
  checkClipActions(course.courseLayer?.foreground ?? [], '/courseLayer/foreground');
  course.chapters.forEach((chapter, i) =>
    checkClipActions(chapter.tracks, `/chapters/${i}/tracks`),
  );

  // Completion rule.
  if (course.completion?.mode === 'goal' && !course.chapters.some((c) => c.goal)) {
    warnings.push({
      path: '/completion',
      message: 'The course is completed when a goal chapter is reached, but no chapter is a goal',
    });
  }
  if (course.completion?.mode !== 'goal' && course.chapters.every((c) => c.optional)) {
    warnings.push({
      path: '/chapters',
      message: 'All chapters are optional; the course counts as completed right away',
    });
  }

  for (const [assetId, asset] of Object.entries(course.assets)) {
    if (/^https?:\/\//.test(asset.src)) {
      warnings.push({
        path: `/assets/${assetId}/src`,
        message: `Asset "${assetId}" is external; the course needs network access to show it`,
      });
    }
  }
}
