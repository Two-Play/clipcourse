// SPDX-License-Identifier: MIT
/**
 * Compact, versioned encoding of the learner's progress.
 *
 * The string is designed to fit SCORM 1.2's 4096-character suspend_data
 * limit with plenty of room: "1~<chapter>~<time>~<seen>", where chapter is
 * base 36, time is in tenths of a second (base 36) and seen is a hex bitset
 * (chapter 0 = lowest bit of the first digit). 200 chapters need ~60 chars.
 */

export interface Progress {
  chapterIndex: number;
  /** Position in the current chapter, ms. */
  time: number;
  /** One entry per chapter. */
  seen: boolean[];
}

const VERSION = '1';
const SEPARATOR = '~';

export function encodeProgress(progress: Progress): string {
  const time = Math.max(0, Math.floor(progress.time / 100));
  return [
    VERSION,
    progress.chapterIndex.toString(36),
    time.toString(36),
    encodeBits(progress.seen),
  ].join(SEPARATOR);
}

/**
 * Decodes a progress string for a course with `chapterCount` chapters.
 * Returns null for anything that is not a valid progress string, so that a
 * corrupt or foreign suspend_data value never breaks the player.
 */
export function decodeProgress(
  value: string | null | undefined,
  chapterCount: number,
): Progress | null {
  if (!value) return null;
  const parts = value.split(SEPARATOR);
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, chapterPart, timePart, bitsPart] = parts as [string, string, string, string];
  if (!/^[0-9a-z]+$/.test(chapterPart) || !/^[0-9a-z]+$/.test(timePart)) return null;
  if (!/^[0-9a-f]*$/.test(bitsPart)) return null;
  const chapterIndex = parseInt(chapterPart, 36);
  if (chapterIndex >= chapterCount) return null;
  return {
    chapterIndex,
    time: parseInt(timePart, 36) * 100,
    seen: decodeBits(bitsPart, chapterCount),
  };
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
