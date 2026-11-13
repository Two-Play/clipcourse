// SPDX-License-Identifier: MIT
/**
 * Playback state machine. Knows nothing about the DOM or real time: the
 * owner feeds elapsed time through {@link Controller.advance}. This keeps the
 * whole playback logic testable with plain numbers.
 */
import type { Course } from '@clipcourse/format';
import { clampTime } from './evaluate.js';
import type { Progress } from './progress.js';

export type PlaybackStatus =
  /** Not advancing. */
  | 'paused'
  /** Advancing time. */
  | 'playing'
  /** Reached the end of a chapter with transition "wait". */
  | 'waiting'
  /** Reached the end of the last chapter. */
  | 'ended';

export interface PlayerState {
  chapterIndex: number;
  /** ms within the current chapter */
  time: number;
  status: PlaybackStatus;
  /** One entry per chapter: has the learner played it to the end? */
  seen: readonly boolean[];
  /** All chapters seen. */
  complete: boolean;
}

export type ControllerEvent =
  | { type: 'chapterchange'; chapterIndex: number; previousIndex: number }
  | { type: 'chapterseen'; chapterIndex: number }
  | { type: 'complete' }
  | { type: 'seek'; time: number };

export type ControllerListener = (state: PlayerState, events: readonly ControllerEvent[]) => void;

export class Controller {
  readonly course: Course;
  private chapterIndex = 0;
  private time = 0;
  private status: PlaybackStatus = 'paused';
  private seen: boolean[];
  private listeners = new Set<ControllerListener>();
  private pending: ControllerEvent[] = [];

  constructor(course: Course, progress?: Progress | null) {
    if (course.chapters.length === 0) throw new Error('Course has no chapters');
    this.course = course;
    this.seen = course.chapters.map(() => false);
    if (progress) {
      this.seen = course.chapters.map((_, i) => progress.seen[i] === true);
      this.chapterIndex = Math.min(Math.max(progress.chapterIndex, 0), course.chapters.length - 1);
      this.time = clampTime(this.chapter, progress.time);
    }
  }

  get chapter() {
    return this.course.chapters[this.chapterIndex]!;
  }

  get state(): PlayerState {
    return {
      chapterIndex: this.chapterIndex,
      time: this.time,
      status: this.status,
      seen: [...this.seen],
      complete: this.seen.every(Boolean),
    };
  }

  get progress(): Progress {
    return { chapterIndex: this.chapterIndex, time: this.time, seen: [...this.seen] };
  }

  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(): void {
    if (this.status === 'playing') return;
    if (this.status === 'waiting') {
      this.setChapter(this.chapterIndex + 1, 0);
    } else if (this.status === 'ended' || this.time >= this.chapter.duration) {
      // Replay the current chapter from the start.
      this.time = 0;
      this.pending.push({ type: 'seek', time: 0 });
    }
    this.status = 'playing';
    this.flush();
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.status = 'paused';
    this.flush();
  }

  toggle(): void {
    if (this.status === 'playing') this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.time = clampTime(this.chapter, time);
    if (this.status === 'waiting' || this.status === 'ended') this.status = 'paused';
    this.pending.push({ type: 'seek', time: this.time });
    this.flush();
  }

  /** Jumps to a chapter. Keeps playing if the player was playing. */
  goToChapter(index: number, time = 0): void {
    if (index < 0 || index >= this.course.chapters.length) return;
    const keepPlaying = this.status === 'playing' || this.status === 'waiting';
    this.setChapter(index, time);
    this.status = keepPlaying ? 'playing' : 'paused';
    this.flush();
  }

  next(): void {
    this.goToChapter(this.chapterIndex + 1);
  }

  previous(): void {
    this.goToChapter(this.chapterIndex - 1);
  }

  get hasNext(): boolean {
    return this.chapterIndex < this.course.chapters.length - 1;
  }

  get hasPrevious(): boolean {
    return this.chapterIndex > 0;
  }

  /** Advances playback by `delta` ms. Does nothing unless playing. */
  advance(delta: number): void {
    if (this.status !== 'playing' || !(delta > 0)) return;
    const duration = this.chapter.duration;
    this.time = Math.min(Math.round(this.time + delta), duration);
    if (this.time >= duration) {
      this.markSeen(this.chapterIndex);
      if (!this.hasNext) {
        this.status = 'ended';
      } else if (this.chapter.transition.mode === 'auto') {
        this.setChapter(this.chapterIndex + 1, 0);
      } else {
        this.status = 'waiting';
      }
    }
    this.flush();
  }

  private setChapter(index: number, time: number) {
    const previousIndex = this.chapterIndex;
    this.chapterIndex = index;
    this.time = clampTime(this.chapter, time);
    if (previousIndex !== index) {
      this.pending.push({ type: 'chapterchange', chapterIndex: index, previousIndex });
    } else {
      this.pending.push({ type: 'seek', time: this.time });
    }
  }

  private markSeen(index: number) {
    if (this.seen[index]) return;
    const wasComplete = this.seen.every(Boolean);
    this.seen[index] = true;
    this.pending.push({ type: 'chapterseen', chapterIndex: index });
    if (!wasComplete && this.seen.every(Boolean)) this.pending.push({ type: 'complete' });
  }

  private flush() {
    const events = this.pending;
    this.pending = [];
    const state = this.state;
    for (const listener of this.listeners) listener(state, events);
  }
}
