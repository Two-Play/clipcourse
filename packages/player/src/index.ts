// SPDX-License-Identifier: MIT
export { createPlayer } from './player.js';
export type { Player, PlayerEvent, PlayerOptions } from './player.js';
export { Controller } from './core/controller.js';
export type { ControllerEvent, PlaybackStatus, PlayerState } from './core/controller.js';
export { evaluate, isClipActive, clampTime } from './core/evaluate.js';
export type { ActiveClip, SceneState, LayerName } from './core/evaluate.js';
export {
  encodeProgress,
  decodeProgress,
  createMemoryStore,
  createLocalStorageStore,
} from './core/progress.js';
export type { Progress, ProgressStore } from './core/progress.js';
export { parseVtt, cueTextAt } from './core/vtt.js';
export type { Cue } from './core/vtt.js';
export { createAnimationFrameClock, createManualClock, MAX_FRAME_DELTA } from './clock.js';
export type { Clock } from './clock.js';
export { defaultStrings, format, formatTime } from './i18n.js';
export type { PlayerStrings } from './i18n.js';
export { Stage } from './dom/stage.js';
export type { StageOptions } from './dom/stage.js';
export type { AssetResolver } from './dom/clips.js';
export { injectStyles } from './dom/styles.js';
export { answer, collectQuestions, computeScore, isCorrect, shuffled } from './core/quiz.js';
export type { AnswerState, QuestionRef, Response, Score } from './core/quiz.js';
export { renderQuestion } from './dom/question.js';
export {
  courseProgressMeasure,
  createGlossaryMatcher,
  isClipShown,
  isCourseComplete,
  visibilityTargets,
  type TextPart,
} from './core/interactions.js';
export { applyThemeVariables, cssColor, themeVariables } from './dom/theme.js';
