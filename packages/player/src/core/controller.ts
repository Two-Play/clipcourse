// SPDX-License-Identifier: MIT
/**
 * Playback state machine. Knows nothing about the DOM or real time: the
 * owner feeds elapsed time through {@link Controller.advance}. This keeps the
 * whole playback logic testable with plain numbers.
 *
 * Questions: playback stops at the start of every question clip that is not
 * answered yet (status "question") and goes on with play() once it is.
 * Quiz chapters have no running timeline (status "quiz"); they count as
 * seen when all their questions are done.
 */
import type { Clip, ClipAction, Course, Question } from '@clipcourse/format';
import { clampTime } from './evaluate.js';
import { isClipShown, isCourseComplete } from './interactions.js';
import type { Progress } from './progress.js';
import {
  answer,
  collectQuestions,
  computeScore,
  type AnswerState,
  type QuestionRef,
  type Response,
  type Score,
} from './quiz.js';

export type PlaybackStatus =
  /** Not advancing. */
  | 'paused'
  /** Advancing time. */
  | 'playing'
  /** Reached the end of a chapter with transition "wait". */
  | 'waiting'
  /** Reached the end of the last chapter. */
  | 'ended'
  /** Stopped at a question clip that needs an answer. */
  | 'question'
  /** In a quiz chapter that is not finished yet. */
  | 'quiz';

export interface PlayerState {
  chapterIndex: number;
  /** ms within the current chapter */
  time: number;
  status: PlaybackStatus;
  /** One entry per chapter: has the learner played it to the end? */
  seen: readonly boolean[];
  /** The completion rule is met (by default: all required chapters seen). */
  complete: boolean;
  /** Clip visibility changed by the learner, by clip id. */
  visibility: Readonly<Record<string, boolean>>;
  /** The question clip playback is stopped at (status "question"). */
  questionClipId: string | null;
  /** Answers by question id. */
  answers: Readonly<Record<string, AnswerState>>;
  /** Restarts used per quiz chapter (by chapter index). */
  quizRetries: Readonly<Record<number, number>>;
  score: Score;
}

export type ControllerEvent =
  | { type: 'chapterchange'; chapterIndex: number; previousIndex: number }
  | { type: 'chapterseen'; chapterIndex: number }
  | { type: 'complete' }
  | { type: 'seek'; time: number }
  | { type: 'question'; questionId: string; clipId: string }
  | { type: 'answer'; questionId: string; state: AnswerState; question: Question }
  | { type: 'score'; score: Score };

export type ControllerListener = (state: PlayerState, events: readonly ControllerEvent[]) => void;

export class Controller {
  readonly course: Course;
  readonly questions: QuestionRef[];
  private chapterIndex = 0;
  private time = 0;
  private status: PlaybackStatus = 'paused';
  private seen: boolean[];
  private answers: Record<string, AnswerState> = {};
  private quizRetries: Record<number, number> = {};
  private questionClipId: string | null = null;
  private visibility: Record<string, boolean> = {};
  private clipsById = new Map<string, Clip>();
  private listeners = new Set<ControllerListener>();
  private pending: ControllerEvent[] = [];
  private byId: Map<string, QuestionRef>;

  constructor(course: Course, progress?: Progress | null) {
    if (course.chapters.length === 0) throw new Error('Course has no chapters');
    this.course = course;
    this.questions = collectQuestions(course);
    this.byId = new Map(this.questions.map((ref) => [ref.question.id, ref]));
    this.seen = course.chapters.map(() => false);
    for (const track of [
      ...(course.courseLayer?.background ?? []),
      ...(course.courseLayer?.foreground ?? []),
      ...course.chapters.flatMap((c) => c.tracks),
    ]) {
      for (const clip of track.clips) this.clipsById.set(clip.id, clip);
    }
    if (progress) {
      for (const [id, shown] of Object.entries(progress.visibility ?? {})) {
        if (this.clipsById.has(id)) this.visibility[id] = shown;
      }
      this.seen = course.chapters.map((_, i) => progress.seen[i] === true);
      this.chapterIndex = Math.min(Math.max(progress.chapterIndex, 0), course.chapters.length - 1);
      this.time = clampTime(this.chapter, progress.time);
      for (const [id, s] of Object.entries(progress.answers ?? {})) {
        if (this.byId.has(id))
          this.answers[id] = { attempts: s.attempts, correct: s.correct, done: s.done };
      }
      this.quizRetries = { ...(progress.quizRetries ?? {}) };
      // Restored at the end of a finished chapter: continue where the learner
      // left off (waiting for "Continue", or done) instead of replaying it.
      if (this.time >= this.chapter.duration && this.seen[this.chapterIndex]) {
        this.status = this.hasNext ? 'waiting' : 'ended';
      }
    }
    if (this.chapter.quiz) {
      this.time = 0;
      this.status = this.seen[this.chapterIndex] ? (this.hasNext ? 'waiting' : 'ended') : 'quiz';
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
      complete: isCourseComplete(this.course, this.seen),
      visibility: { ...this.visibility },
      questionClipId: this.questionClipId,
      answers: { ...this.answers },
      quizRetries: { ...this.quizRetries },
      score: computeScore(this.course, this.answers),
    };
  }

  get progress(): Progress {
    const answers: NonNullable<Progress['answers']> = {};
    for (const [id, s] of Object.entries(this.answers)) {
      answers[id] = { attempts: s.attempts, correct: s.correct, done: s.done };
    }
    return {
      chapterIndex: this.chapterIndex,
      time: this.time,
      seen: [...this.seen],
      answers,
      quizRetries: { ...this.quizRetries },
      visibility: { ...this.visibility },
    };
  }

  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(): void {
    if (this.status === 'playing' || this.status === 'quiz') return;
    if (this.status === 'question') {
      // Only go on once the question is done.
      const ref = this.questionClipId ? this.questionForClip(this.questionClipId) : null;
      if (ref && !this.answers[ref.question.id]?.done) return;
      this.questionClipId = null;
    } else if (this.status === 'waiting') {
      this.setChapter(this.chapterIndex + 1, 0);
      // setChapter may have switched to a quiz chapter (or an already seen one).
      const after = this.status as PlaybackStatus;
      if (after === 'quiz' || after === 'waiting' || after === 'ended') {
        this.flush();
        return;
      }
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
    if (this.chapter.quiz) return;
    this.time = clampTime(this.chapter, time);
    if (this.status === 'waiting' || this.status === 'ended' || this.status === 'question') {
      this.status = 'paused';
    }
    this.questionClipId = null;
    this.pending.push({ type: 'seek', time: this.time });
    this.flush();
  }

  /** Jumps to a chapter. Keeps playing if the player was playing. */
  goToChapter(index: number, time = 0): void {
    if (index < 0 || index >= this.course.chapters.length) return;
    const keepPlaying = this.status === 'playing' || this.status === 'waiting';
    this.setChapter(index, time);
    if (!this.chapter.quiz) this.status = keepPlaying ? 'playing' : 'paused';
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
    const target = Math.min(Math.round(this.time + delta), duration);

    // Stop at the first unanswered question clip in [time, target].
    const blocking = this.questions.find(
      (ref) =>
        ref.chapterIndex === this.chapterIndex &&
        ref.clipId !== null &&
        ref.start >= this.time &&
        ref.start <= target &&
        ref.start < duration &&
        !this.answers[ref.question.id]?.done,
    );
    if (blocking) {
      this.time = blocking.start;
      this.status = 'question';
      this.questionClipId = blocking.clipId;
      this.pending.push({
        type: 'question',
        questionId: blocking.question.id,
        clipId: blocking.clipId!,
      });
      this.flush();
      return;
    }

    this.time = target;
    if (this.time >= duration) {
      if (this.chapterQuestionsDone(this.chapterIndex)) this.markSeen(this.chapterIndex);
      if (!this.hasNext) {
        this.status = 'ended';
      } else if (this.chapter.transition.mode === 'auto') {
        this.setChapter(this.chapterIndex + 1, 0);
        if (!this.chapter.quiz) this.status = 'playing';
      } else {
        this.status = 'waiting';
      }
    }
    this.flush();
  }

  /** Records one attempt. Returns the new state, or null for unknown questions. */
  answer(questionId: string, response: Response): AnswerState | null {
    const ref = this.byId.get(questionId);
    if (!ref) return null;
    const before = this.answers[questionId];
    if (before?.done) return before;
    const scoreBefore = computeScore(this.course, this.answers);
    const state = answer(ref.question, before, response);
    this.answers[questionId] = state;
    this.pending.push({ type: 'answer', questionId, state, question: ref.question });
    const scoreAfter = computeScore(this.course, this.answers);
    if (scoreAfter.earned !== scoreBefore.earned || scoreAfter.finished !== scoreBefore.finished) {
      this.pending.push({ type: 'score', score: scoreAfter });
    }
    this.flush();
    return state;
  }

  /** Ends a quiz chapter once all its questions are done. */
  finishQuiz(): void {
    if (!this.chapter.quiz || this.status !== 'quiz') return;
    if (!this.chapterQuestionsDone(this.chapterIndex)) return;
    this.markSeen(this.chapterIndex);
    this.status = this.hasNext ? 'waiting' : 'ended';
    this.flush();
  }

  /** Quiz restarts left for the current quiz chapter. */
  get retriesLeft(): number {
    const quiz = this.chapter.quiz;
    if (!quiz) return 0;
    return Math.max(0, (quiz.retries ?? 0) - (this.quizRetries[this.chapterIndex] ?? 0));
  }

  /** Restarts the current quiz chapter (clears its answers) if retries are left. */
  retryQuiz(): boolean {
    const quiz = this.chapter.quiz;
    if (!quiz || this.retriesLeft <= 0) return false;
    this.quizRetries[this.chapterIndex] = (this.quizRetries[this.chapterIndex] ?? 0) + 1;
    for (const question of quiz.questions) delete this.answers[question.id];
    this.status = 'quiz';
    this.pending.push({ type: 'score', score: computeScore(this.course, this.answers) });
    this.flush();
    return true;
  }

  /** Shows, hides or toggles a clip (setClipVisibility action). */
  setClipVisibility(clipId: string, mode: 'show' | 'hide' | 'toggle'): void {
    const clip = this.clipsById.get(clipId);
    if (!clip) return;
    const current = isClipShown(clip, this.visibility);
    const next = mode === 'toggle' ? !current : mode === 'show';
    if (next === current) return;
    this.visibility[clipId] = next;
    this.flush();
  }

  /**
   * Runs the parts of a click action that change playback: jumps (which
   * start playing the target, since the learner asked for it) and show/hide.
   * Popups and links are up to the owner. Returns false for unknown targets.
   */
  runAction(action: ClipAction): boolean {
    switch (action.type) {
      case 'goToChapter':
      case 'goToMarker': {
        const index = this.course.chapters.findIndex((c) => c.id === action.chapterId);
        if (index < 0) return false;
        let time = 0;
        if (action.type === 'goToMarker') {
          const marker = this.course.chapters[index]!.markers?.find(
            (m) => m.id === action.markerId,
          );
          if (!marker) return false;
          time = marker.time;
        }
        this.setChapter(index, time);
        if (!this.chapter.quiz) this.status = 'playing';
        this.flush();
        return true;
      }
      case 'setClipVisibility':
        if (!this.clipsById.has(action.clipId)) return false;
        if (action.pause) this.pause();
        this.setClipVisibility(action.clipId, action.visible);
        return true;
      default:
        return true;
    }
  }

  questionForClip(clipId: string): QuestionRef | null {
    return this.questions.find((ref) => ref.clipId === clipId) ?? null;
  }

  private chapterQuestionsDone(index: number): boolean {
    return this.questions.every(
      (ref) => ref.chapterIndex !== index || this.answers[ref.question.id]?.done,
    );
  }

  private setChapter(index: number, time: number) {
    const previousIndex = this.chapterIndex;
    this.chapterIndex = index;
    this.time = clampTime(this.chapter, time);
    this.questionClipId = null;
    if (previousIndex !== index) {
      this.pending.push({ type: 'chapterchange', chapterIndex: index, previousIndex });
    } else {
      this.pending.push({ type: 'seek', time: this.time });
    }
    if (this.chapter.quiz) {
      this.time = 0;
      this.status = this.seen[index] ? (this.hasNext ? 'waiting' : 'ended') : 'quiz';
    } else if (['quiz', 'waiting', 'ended', 'question'].includes(this.status)) {
      this.status = 'paused';
    }
  }

  private markSeen(index: number) {
    if (this.seen[index]) return;
    const wasComplete = isCourseComplete(this.course, this.seen);
    this.seen[index] = true;
    this.pending.push({ type: 'chapterseen', chapterIndex: index });
    if (!wasComplete && isCourseComplete(this.course, this.seen))
      this.pending.push({ type: 'complete' });
  }

  private flush() {
    const events = this.pending;
    this.pending = [];
    const state = this.state;
    for (const listener of this.listeners) listener(state, events);
  }
}
