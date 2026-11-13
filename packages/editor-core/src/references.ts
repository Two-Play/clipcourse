// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Click actions point at chapters, markers, popups and clips. These helpers
 * keep those references intact: deleting a target that a clip still uses is
 * refused with a readable message, and copies of a chapter point at their
 * own copies.
 */
import type { Chapter, ClipAction, Course, VisualClip } from '@clipcourse/format';
import { trackGroups } from './document.js';

export interface ActionUser {
  clip: VisualClip;
  /** Chapter title, or "All chapters" for the course layer. */
  where: string;
}

/** All clips with a click action. */
export function actionUsers(course: Course): ActionUser[] {
  const users: ActionUser[] = [];
  for (const { scope, tracks } of trackGroups(course)) {
    const where =
      scope.kind === 'chapter'
        ? (course.chapters[scope.chapterIndex]?.title ?? '')
        : 'All chapters';
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.type !== 'audio' && clip.action) users.push({ clip, where });
      }
    }
  }
  return users;
}

function describe({ clip, where }: ActionUser): string {
  const name =
    clip.type === 'button' || clip.type === 'text'
      ? `"${clip.text.slice(0, 40)}"`
      : clip.type === 'box' && clip.text
        ? `"${clip.text.slice(0, 40)}"`
        : `${clip.type} ${clip.id}`;
  return `${name} in "${where}"`;
}

/**
 * Throws if a clip (other than those in `ignore`) has an action matching
 * `targets`. `what` names the thing being deleted, e.g. 'Chapter "Intro"'.
 */
export function assertNotTargeted(
  course: Course,
  targets: (action: ClipAction) => boolean,
  ignore: ReadonlySet<string>,
  what: string,
): void {
  const users = actionUsers(course).filter(
    (u) => !ignore.has(u.clip.id) && targets(u.clip.action!),
  );
  if (users.length === 0) return;
  throw new Error(
    `${what} is the target of ${users.map(describe).join(', ')}. Change or delete ${users.length === 1 ? 'that click action' : 'those click actions'} first.`,
  );
}

/** Clip ids inside a chapter. */
export function chapterClipIds(chapter: Chapter): Set<string> {
  return new Set(chapter.tracks.flatMap((t) => t.clips.map((c) => c.id)));
}

/** Does the action point into this chapter (the chapter, its markers or its clips)? */
export function targetsChapter(action: ClipAction, chapter: Chapter): boolean {
  if (action.type === 'goToChapter' || action.type === 'goToMarker')
    return action.chapterId === chapter.id;
  if (action.type === 'setClipVisibility') return chapterClipIds(chapter).has(action.clipId);
  return false;
}

export interface IdMaps {
  chapters: ReadonlyMap<string, string>;
  markers: ReadonlyMap<string, string>;
  clips: ReadonlyMap<string, string>;
  popups?: ReadonlyMap<string, string>;
}

/** Rewrites the targets of the actions in `chapter` (in place) using the id maps. */
export function remapActions(chapter: Chapter, maps: IdMaps): void {
  for (const track of chapter.tracks) {
    for (const clip of track.clips) {
      if (clip.type === 'audio' || !clip.action) continue;
      const action = clip.action;
      switch (action.type) {
        case 'goToChapter':
          action.chapterId = maps.chapters.get(action.chapterId) ?? action.chapterId;
          break;
        case 'goToMarker':
          if (maps.markers.has(action.markerId)) {
            action.chapterId = maps.chapters.get(action.chapterId) ?? action.chapterId;
            action.markerId = maps.markers.get(action.markerId)!;
          }
          break;
        case 'setClipVisibility':
          action.clipId = maps.clips.get(action.clipId) ?? action.clipId;
          break;
        case 'openPopup':
          action.popupId = maps.popups?.get(action.popupId) ?? action.popupId;
          break;
        case 'openUrl':
          break;
      }
    }
  }
}

/**
 * Makes the actions of a chapter fit `course` (used for templates from other
 * projects): targets that do not exist there are dropped from clips, and
 * buttons point at the chapter itself instead, so the author can see and
 * change them.
 */
export function dropForeignActions(chapter: Chapter, course: Course): void {
  const chapters = new Map(course.chapters.map((c) => [c.id, c]));
  chapters.set(chapter.id, chapter);
  const clipIds = chapterClipIds(chapter);
  for (const { tracks } of trackGroups(course))
    for (const t of tracks) for (const c of t.clips) clipIds.add(c.id);
  const popups = new Set((course.popups ?? []).map((p) => p.id));
  const exists = (action: ClipAction) => {
    switch (action.type) {
      case 'goToChapter':
        return chapters.has(action.chapterId);
      case 'goToMarker':
        return !!chapters.get(action.chapterId)?.markers?.some((m) => m.id === action.markerId);
      case 'setClipVisibility':
        return clipIds.has(action.clipId);
      case 'openPopup':
        return popups.has(action.popupId);
      case 'openUrl':
        return true;
    }
  };
  for (const track of chapter.tracks) {
    for (const clip of track.clips) {
      if (clip.type === 'audio' || !clip.action || exists(clip.action)) continue;
      if (clip.type === 'button') clip.action = { type: 'goToChapter', chapterId: chapter.id };
      else delete clip.action;
    }
  }
}
