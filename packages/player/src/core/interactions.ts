// SPDX-License-Identifier: MIT
/**
 * Click actions, clip visibility and the completion rule. Pure functions.
 */
import type { Clip, Course, GlossaryEntry } from '@clipcourse/format';

/** Every clip of the course in a stable order (course layer, then chapters). */
function allClips(course: Course): Clip[] {
  const clips: Clip[] = [];
  for (const track of course.courseLayer?.background ?? []) clips.push(...track.clips);
  for (const track of course.courseLayer?.foreground ?? []) clips.push(...track.clips);
  for (const chapter of course.chapters) {
    for (const track of chapter.tracks) clips.push(...track.clips);
  }
  return clips;
}

/**
 * Clips whose visibility the learner can change (targets of
 * setClipVisibility actions), in a stable order. Their state is part of the
 * learner's progress.
 */
export function visibilityTargets(course: Course): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const clip of allClips(course)) {
    if (clip.type === 'audio') continue;
    const action = clip.action;
    if (action?.type === 'setClipVisibility' && !seen.has(action.clipId)) {
      seen.add(action.clipId);
      targets.push(action.clipId);
    }
  }
  return targets;
}

/** Visible by default unless the clip starts hidden; learner changes win. */
export function isClipShown(clip: Clip, visibility: Readonly<Record<string, boolean>>): boolean {
  const changed = visibility[clip.id];
  if (changed !== undefined) return changed;
  return clip.type === 'audio' || clip.startsHidden !== true;
}

/** Chapters that count for completion and progress. */
function countedChapters(course: Course): number[] {
  const indexes: number[] = [];
  course.chapters.forEach((chapter, i) => {
    if (course.completion?.mode === 'goal' ? true : chapter.optional !== true) indexes.push(i);
  });
  return indexes;
}

export function isCourseComplete(course: Course, seen: readonly boolean[]): boolean {
  if (course.completion?.mode === 'goal') {
    return course.chapters.some((chapter, i) => chapter.goal === true && seen[i] === true);
  }
  return countedChapters(course).every((i) => seen[i] === true);
}

/**
 * Progress for the LMS (0..1): seen required chapters / all required
 * chapters; with the goal rule 1 once a goal is reached, otherwise the share
 * of seen chapters (a branching course has no fixed path length).
 */
export function courseProgressMeasure(course: Course, seen: readonly boolean[]): number {
  if (isCourseComplete(course, seen)) return 1;
  const counted = countedChapters(course);
  if (counted.length === 0) return 1;
  const done = counted.filter((i) => seen[i] === true).length;
  return Math.round((done / counted.length) * 1e4) / 1e4;
}

// --- Glossary ----------------------------------------------------------------------

export type TextPart = string | { entry: GlossaryEntry; text: string };

/**
 * Splits text into plain parts and glossary terms. Each entry is marked at
 * its first occurrence only, as whole words, ignoring case. Longer terms win
 * over shorter ones they contain.
 */
export function createGlossaryMatcher(
  entries: readonly GlossaryEntry[] | undefined,
): ((text: string) => TextPart[]) | null {
  if (!entries || entries.length === 0) return null;
  const forms: { form: string; entry: GlossaryEntry }[] = [];
  for (const entry of entries) {
    for (const form of [entry.term, ...(entry.variants ?? [])]) {
      if (form.trim()) forms.push({ form: form.trim(), entry });
    }
  }
  forms.sort((a, b) => b.form.length - a.form.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${forms.map((f) => escape(f.form)).join('|')})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const byForm = new Map(forms.map((f) => [f.form.toLocaleLowerCase(), f.entry]));

  return (text: string) => {
    const parts: TextPart[] = [];
    const used = new Set<string>();
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const entry = byForm.get(match[0].toLocaleLowerCase());
      if (!entry || used.has(entry.id)) continue;
      used.add(entry.id);
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push({ entry, text: match[0] });
      last = match.index + match[0].length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
}
