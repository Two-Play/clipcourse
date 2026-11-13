// SPDX-License-Identifier: MIT
/**
 * Questions: responses, grading, scoring. Pure functions, no DOM.
 */
import type { Course, Question } from '@clipcourse/format';

export type Response =
  | { kind: 'single'; choice: string }
  | { kind: 'multiple'; choices: string[] }
  | { kind: 'text'; text: string }
  | { kind: 'order'; items: string[] }
  | { kind: 'match'; pairs: Record<string, string> }
  | { kind: 'hotspot'; x: number; y: number };

/** What the learner did with one question. */
export interface AnswerState {
  attempts: number;
  correct: boolean;
  /** No more attempts, or answered correctly. */
  done: boolean;
  /** Last response (this session only; not stored in suspend data). */
  response?: Response;
}

export function points(question: Question): number {
  return question.points ?? 1;
}

export function isScored(question: Question): boolean {
  return question.scored !== false;
}

export function allowedAttempts(question: Question): number {
  return question.attempts ?? 1;
}

const normalize = (text: string, caseSensitive: boolean) => {
  const t = text.trim().replace(/\s+/g, ' ');
  return caseSensitive ? t : t.toLocaleLowerCase();
};

export function isCorrect(question: Question, response: Response): boolean {
  switch (question.kind) {
    case 'single':
      return response.kind === 'single' && response.choice === question.correct;
    case 'multiple': {
      if (response.kind !== 'multiple') return false;
      const chosen = new Set(response.choices);
      return (
        chosen.size === question.correct.length && question.correct.every((id) => chosen.has(id))
      );
    }
    case 'text': {
      if (response.kind !== 'text') return false;
      const cs = question.caseSensitive === true;
      const given = normalize(response.text, cs);
      return given !== '' && question.answers.some((a) => normalize(a, cs) === given);
    }
    case 'order':
      return (
        response.kind === 'order' &&
        response.items.length === question.items.length &&
        question.items.every((item, i) => response.items[i] === item.id)
      );
    case 'match':
      return (
        response.kind === 'match' &&
        question.pairs.every((pair) => response.pairs[pair.id] === pair.id)
      );
    case 'hotspot': {
      if (response.kind !== 'hotspot') return false;
      return question.areas.some(
        (a) =>
          question.correct.includes(a.id) &&
          response.x >= a.x &&
          response.x <= a.x + a.width &&
          response.y >= a.y &&
          response.y <= a.y + a.height,
      );
    }
  }
}

/** Applies one attempt and returns the new state (unchanged if already done). */
export function answer(
  question: Question,
  state: AnswerState | undefined,
  response: Response,
): AnswerState {
  const current = state ?? { attempts: 0, correct: false, done: false };
  if (current.done) return current;
  const attempts = current.attempts + 1;
  const correct = isCorrect(question, response);
  const max = allowedAttempts(question);
  return { attempts, correct, done: correct || (max > 0 && attempts >= max), response };
}

/** Deterministic shuffle (mulberry32 seeded from a string), never the identity for 2+ items. */
export function shuffled<T>(items: readonly T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  if (result.length > 1 && result.every((item, i) => item === items[i])) {
    result.push(result.shift()!); // rotate: an "already solved" order would be no question
  }
  return result;
}

export interface QuestionRef {
  question: Question;
  chapterIndex: number;
  /** Question clip id, or null for quiz chapter questions. */
  clipId: string | null;
  /** Start of the question clip on the chapter timeline (clips only). */
  start: number;
}

/** All questions of the course in a stable order (chapters, then time, then quiz order). */
export function collectQuestions(course: Course): QuestionRef[] {
  const refs: QuestionRef[] = [];
  course.chapters.forEach((chapter, chapterIndex) => {
    const clips = chapter.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'question');
    clips.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
    for (const clip of clips) {
      if (clip.type === 'question')
        refs.push({ question: clip.question, chapterIndex, clipId: clip.id, start: clip.start });
    }
    for (const question of chapter.quiz?.questions ?? []) {
      refs.push({ question, chapterIndex, clipId: null, start: 0 });
    }
  });
  return refs;
}

export interface Score {
  /** Points earned and possible over scored questions. */
  earned: number;
  possible: number;
  /** 0–100, or null when there are no scored questions. */
  percent: number | null;
  /** All scored questions are done. */
  finished: boolean;
  /** passed/failed once finished and an assessment exists; otherwise null. */
  passed: boolean | null;
}

export function computeScore(
  course: Course,
  answers: Readonly<Record<string, AnswerState>>,
): Score {
  let earned = 0;
  let possible = 0;
  let finished = true;
  for (const { question } of collectQuestions(course)) {
    if (!isScored(question)) continue;
    possible += points(question);
    const state = answers[question.id];
    if (state?.correct) earned += points(question);
    if (!state?.done) finished = false;
  }
  if (possible === 0)
    return { earned: 0, possible: 0, percent: null, finished: true, passed: null };
  const percent = Math.round((earned / possible) * 1000) / 10;
  const passed = course.assessment && finished ? percent >= course.assessment.passingScore : null;
  return { earned, possible, percent, finished, passed };
}
