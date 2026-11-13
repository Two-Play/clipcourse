// SPDX-License-Identifier: MIT
/**
 * Compact, versioned encoding of the learner's progress.
 *
 * Designed to fit SCORM 1.2's 4096-character suspend_data limit:
 *
 *   1~<chapter>~<time>~<seen>                      (no questions)
 *   2~<chapter>~<time>~<seen>~<answers>~<retries>  (with questions)
 *
 * chapter is base 36, time is in tenths of a second (base 36), seen is a
 * hex bitset (chapter 0 = lowest bit of the first digit). answers has two
 * characters per question in course order (attempts in base 36, capped at
 * 35, and a state digit: 0 open, 1 done and wrong, 2 correct); trailing
 * "00" pairs are dropped. retries lists "chapter.count" pairs (base 36).
 * 200 chapters and 200 questions need well under 500 characters.
 */

export interface StoredAnswer {
  attempts: number;
  correct: boolean;
  done: boolean;
}

export interface Progress {
  chapterIndex: number;
  /** Position in the current chapter, ms. */
  time: number;
  /** One entry per chapter. */
  seen: boolean[];
  /** By question id. */
  answers?: Record<string, StoredAnswer>;
  /** Quiz restarts used, by chapter index. */
  quizRetries?: Record<number, number>;
}

const SEPARATOR = '~';

/**
 * @param questionIds all question ids of the course in a stable order
 *   (see collectQuestions); needed to store answers compactly.
 */
export function encodeProgress(progress: Progress, questionIds: readonly string[] = []): string {
  const time = Math.max(0, Math.floor(progress.time / 100));
  const base = [progress.chapterIndex.toString(36), time.toString(36), encodeBits(progress.seen)];
  const answers = progress.answers ?? {};
  const retries = Object.entries(progress.quizRetries ?? {}).filter(([, n]) => n > 0);
  if (questionIds.length === 0 && retries.length === 0) return ['1', ...base].join(SEPARATOR);
  let encoded = questionIds
    .map((id) => {
      const a = answers[id];
      if (!a) return '00';
      return Math.min(a.attempts, 35).toString(36) + (a.correct ? '2' : a.done ? '1' : '0');
    })
    .join('');
  while (encoded.endsWith('00')) encoded = encoded.slice(0, -2);
  const retryPart = retries
    .map(([chapter, n]) => `${Number(chapter).toString(36)}.${n.toString(36)}`)
    .join(',');
  return ['2', ...base, encoded, retryPart].join(SEPARATOR);
}

/**
 * Decodes a progress string for a course with `chapterCount` chapters.
 * Returns null for anything that is not a valid progress string, so that a
 * corrupt or foreign suspend_data value never breaks the player.
 */
export function decodeProgress(
  value: string | null | undefined,
  chapterCount: number,
  questionIds: readonly string[] = [],
): Progress | null {
  if (!value) return null;
  const parts = value.split(SEPARATOR);
  const version = parts[0];
  if (!((version === '1' && parts.length === 4) || (version === '2' && parts.length === 6)))
    return null;
  const [, chapterPart, timePart, bitsPart, answersPart = '', retriesPart = ''] =
    parts as string[] as [string, string, string, string, string?, string?];
  if (!/^[0-9a-z]+$/.test(chapterPart) || !/^[0-9a-z]+$/.test(timePart)) return null;
  if (!/^[0-9a-f]*$/.test(bitsPart)) return null;
  if (!/^([0-9a-z][012])*$/.test(answersPart)) return null;
  if (!/^([0-9a-z]+\.[0-9a-z]+(,[0-9a-z]+\.[0-9a-z]+)*)?$/.test(retriesPart)) return null;
  const chapterIndex = parseInt(chapterPart, 36);
  if (chapterIndex >= chapterCount) return null;
  const progress: Progress = {
    chapterIndex,
    time: parseInt(timePart, 36) * 100,
    seen: decodeBits(bitsPart, chapterCount),
  };
  if (version === '2') {
    const answers: Record<string, StoredAnswer> = {};
    questionIds.forEach((id, i) => {
      const pair = answersPart.slice(i * 2, i * 2 + 2);
      if (pair.length < 2 || pair === '00') return;
      const attempts = parseInt(pair[0]!, 36);
      const flag = pair[1];
      answers[id] = { attempts, correct: flag === '2', done: flag !== '0' };
    });
    progress.answers = answers;
    const quizRetries: Record<number, number> = {};
    for (const item of retriesPart ? retriesPart.split(',') : []) {
      const [chapter, count] = item.split('.') as [string, string];
      quizRetries[parseInt(chapter, 36)] = parseInt(count, 36);
    }
    progress.quizRetries = quizRetries;
  }
  return progress;
}

function encodeBits(bits: boolean[]): string {
  let out = '';
  for (let i = 0; i < bits.length; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) if (bits[i + b]) nibble |= 1 << b;
    out += nibble.toString(16);
  }
  return out;
}

function decodeBits(hex: string, count: number): boolean[] {
  const bits: boolean[] = [];
  for (let i = 0; i < count; i++) {
    const digit = hex[Math.floor(i / 4)];
    const nibble = digit === undefined ? 0 : parseInt(digit, 16);
    bits.push((nibble & (1 << (i % 4))) !== 0);
  }
  return bits;
}

/** Where the player keeps progress between sessions. */
export interface ProgressStore {
  load(): string | null;
  save(value: string): void;
}

export function createMemoryStore(initial: string | null = null): ProgressStore & {
  value: string | null;
} {
  const store = {
    value: initial,
    load: () => store.value,
    save: (value: string) => {
      store.value = value;
    },
  };
  return store;
}

/**
 * Keeps progress in localStorage. Falls back silently when storage is not
 * available (private mode, sandboxed iframes, blocked cookies).
 */
export function createLocalStorageStore(key: string): ProgressStore {
  return {
    load() {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    save(value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Storage unavailable: progress lives only for this session.
      }
    },
  };
}
