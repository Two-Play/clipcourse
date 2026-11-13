// SPDX-License-Identifier: MIT
/**
 * Runs a course inside an LMS: creates the player, keeps the bookmark in
 * suspend data and reports completion once every chapter has been seen.
 * Without an LMS, progress is kept in localStorage.
 */
import type { Course } from '@clipcourse/format';
import {
  createLocalStorageStore,
  createPlayer,
  decodeProgress,
  type Player,
  type PlayerOptions,
  type ProgressStore,
} from '@clipcourse/player';
import { findApi, type ScormVersion, type WindowLike } from './api.js';
import { connect, type LmsConnection } from './connection.js';

/** Commit at most this often while playing, ms. Chapter ends and completion commit at once. */
export const COMMIT_INTERVAL = 15000;

export interface RunCourseOptions {
  /** The SCORM version declared in the package; "auto" accepts either. */
  scormVersion?: ScormVersion | 'auto';
  /** Window to start the API search from (default: this window). */
  window?: WindowLike & Window;
  /** Extra player options (strings, captions, …). */
  player?: Omit<PlayerOptions, 'progressStore'>;
  now?: () => number;
}

export interface RunningCourse {
  player: Player;
  /** null when no LMS was found. */
  lms: LmsConnection | null;
  /** Saves, commits and ends the LMS session. */
  finish(): void;
}

/** Progress store that writes the bookmark through the LMS connection. */
export function createLmsStore(
  lms: LmsConnection,
  course: Course,
  now: () => number = Date.now,
): ProgressStore & { flush(): void } {
  let lastCommit = 0;
  let pending = false;
  const commit = () => {
    lms.commit();
    lastCommit = now();
    pending = false;
  };
  return {
    load: () => lms.getSuspendData() || null,
    save(value) {
      const progress = decodeProgress(value, course.chapters.length);
      const seen = progress ? progress.seen.filter(Boolean).length : 0;
      const chapter = progress ? course.chapters[progress.chapterIndex] : undefined;
      lms.saveProgress({
        suspendData: value,
        location: chapter?.id ?? '',
        progress: course.chapters.length ? seen / course.chapters.length : 0,
      });
      pending = true;
      if (now() - lastCommit >= COMMIT_INTERVAL) commit();
    },
    flush() {
      if (pending) commit();
    },
  };
}

export function runCourse(container: HTMLElement, course: Course, options: RunCourseOptions = {}): RunningCourse {
  const win = options.window ?? window;
  const now = options.now ?? Date.now;
  const found = findApi(win, options.scormVersion ?? 'auto');
  const lms = found ? connect(found, now) : null;
  if (found && !lms) console.warn('[clipcourse] The LMS did not initialize; progress is stored locally.');

  const lmsStore = lms ? createLmsStore(lms, course, now) : null;
  const store = lmsStore ?? createLocalStorageStore(`clipcourse:${course.id}`);
  const player = createPlayer(container, course, { ...options.player, progressStore: store });

  const flush = () => lmsStore?.flush();

  if (lms) {
    // Completed earlier but the LMS missed it (e.g. the window was closed).
    if (player.getState().complete) lms.setCompleted();
    player.on((event) => {
      if (event.type === 'chapterseen') flush();
      if (event.type === 'complete') {
        lms.setCompleted();
        lms.commit();
      }
    });
  }

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    player.saveProgress();
    flush();
    lms?.terminate();
  };
  win.addEventListener('pagehide', finish);
  win.addEventListener('beforeunload', finish);

  return { player, lms, finish };
}
