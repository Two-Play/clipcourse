// SPDX-License-Identifier: MIT
/**
 * Runs a course inside an LMS: creates the player, keeps the bookmark in
 * suspend data and reports completion by the course's completion rule.
 * Without an LMS, progress is kept in localStorage.
 */
import type { Course } from '@clipcourse/format';
import {
  createLocalStorageStore,
  courseProgressMeasure,
  createPlayer,
  decodeProgress,
  type Player,
  type PlayerOptions,
  type ProgressStore,
} from '@clipcourse/player';
import { findApi, type FoundApi, type ScormVersion, type WindowLike } from './api.js';
import { connect, type LmsConnection } from './connection.js';
import { toInteraction } from './interactions.js';

/** Commit at most this often while playing, ms. Chapter ends and completion commit at once. */
export const COMMIT_INTERVAL = 15000;

export interface RunCourseOptions {
  /** The SCORM version declared in the package; "auto" accepts either. */
  scormVersion?: ScormVersion | 'auto';
  /** Window to start the API search from (default: this window). */
  window?: WindowLike & Window;
  /** Use this API instead of searching for one (e.g. a simulated LMS). */
  api?: FoundApi | null;
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
  /** Finishes the session and removes the player. */
  destroy(): void;
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
      const chapter = progress ? course.chapters[progress.chapterIndex] : undefined;
      lms.saveProgress({
        suspendData: value,
        location: chapter?.id ?? '',
        // Optional chapters do not count; with the goal rule a goal counts as done.
        progress: progress ? courseProgressMeasure(course, progress.seen) : 0,
      });
      pending = true;
      if (now() - lastCommit >= COMMIT_INTERVAL) commit();
    },
    flush() {
      if (pending) commit();
    },
  };
}

export function runCourse(
  container: HTMLElement,
  course: Course,
  options: RunCourseOptions = {},
): RunningCourse {
  const win = options.window ?? window;
  const now = options.now ?? Date.now;
  const found =
    options.api !== undefined ? options.api : findApi(win, options.scormVersion ?? 'auto');
  const lms = found ? connect(found, now) : null;
  if (found && !lms)
    console.warn('[clipcourse] The LMS did not initialize; progress is stored locally.');

  const lmsStore = lms ? createLmsStore(lms, course, now) : null;
  const store = lmsStore ?? createLocalStorageStore(`clipcourse:${course.id}`);
  const player = createPlayer(container, course, { ...options.player, progressStore: store });

  const flush = () => lmsStore?.flush();

  if (lms) {
    const initial = player.getState();
    if (initial.score.possible > 0) lms.setScore(initial.score);
    if (initial.score.passed !== null) lms.setSuccess(initial.score.passed);
    // Completed earlier but the LMS missed it (e.g. the window was closed).
    if (initial.complete) lms.setCompleted(initial.score.passed);
    player.on((event) => {
      if (event.type === 'chapterseen') flush();
      if (event.type === 'answer' && event.state.response) {
        lms.recordInteraction(
          toInteraction(event.question, event.state.response, event.state.correct),
        );
      }
      if (event.type === 'score') {
        lms.setScore(event.score);
        if (event.score.passed !== null) lms.setSuccess(event.score.passed);
        lms.commit();
      }
      if (event.type === 'complete') {
        lms.setCompleted(player.getState().score.passed);
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

  return {
    player,
    lms,
    finish,
    destroy() {
      finish();
      win.removeEventListener('pagehide', finish);
      win.removeEventListener('beforeunload', finish);
      player.destroy();
    },
  };
}
