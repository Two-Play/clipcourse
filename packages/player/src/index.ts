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
export { defaultStrings, formatTime } from './i18n.js';
export type { PlayerStrings } from './i18n.js';
