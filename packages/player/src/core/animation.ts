// SPDX-License-Identifier: MIT
/**
 * Pure animation math. Everything is a function of the clip's local time,
 * so animations are as deterministic as the rest of the player: seeking
 * into the middle of a fade shows exactly that frame of the fade.
 */
import type { Animation, Easing, Stage, VisualClip } from '@clipcourse/format';

export interface AnimationState {
  opacity: number;
  /** Offset in stage pixels. */
  x: number;
  y: number;
  scale: number;
}

export const IDENTITY: AnimationState = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

/** Period of the highlight pulse, ms. */
export const PULSE_PERIOD = 1400;
/** Extra scale at the peak of a pulse. */
export const PULSE_AMOUNT = 0.05;

export function ease(easing: Easing | undefined, t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  switch (easing ?? 'ease-in-out') {
    case 'linear':
      return x;
    case 'ease-in':
      return x * x * x;
    case 'ease-out':
      return 1 - (1 - x) ** 3;
    case 'ease-in-out':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

/**
 * Applies one animation phase. `f` runs from 0 (fully "away") to 1 (normal).
 */
function applyPhase(
  state: AnimationState,
  animation: Animation,
  f: number,
  clip: VisualClip,
  stage: Stage,
  reducedMotion: boolean,
): AnimationState {
  const type = reducedMotion ? 'fade' : animation.type;
  switch (type) {
    case 'fade':
      return { ...state, opacity: state.opacity * f };
    case 'zoom':
      return { ...state, opacity: state.opacity * f, scale: state.scale * (0.5 + 0.5 * f) };
    case 'slide': {
      const { frame } = clip;
      const away = 1 - f;
      switch (animation.direction ?? 'left') {
        case 'left':
          return { ...state, x: state.x - away * (frame.x + frame.width) };
        case 'right':
          return { ...state, x: state.x + away * (stage.width - frame.x) };
        case 'up':
          return { ...state, y: state.y - away * (frame.y + frame.height) };
        case 'down':
          return { ...state, y: state.y + away * (stage.height - frame.y) };
      }
    }
  }
  return state;
}

/** The animated state of a visual clip at `localTime` (ms since clip start). */
export function animationState(
  clip: VisualClip,
  localTime: number,
  stage: Stage,
  reducedMotion = false,
): AnimationState {
  let state: AnimationState = IDENTITY;
  const { in: enter, out: exit } = clip.animations ?? {};
  if (enter || exit) {
    let inDuration = enter ? enter.duration : 0;
    let outDuration = exit ? exit.duration : 0;
    // Animations longer than the clip are shortened proportionally.
    const total = inDuration + outDuration;
    if (total > clip.duration) {
      inDuration = (inDuration / total) * clip.duration;
      outDuration = (outDuration / total) * clip.duration;
    }
    if (enter && inDuration > 0 && localTime < inDuration) {
      state = applyPhase(
        state,
        enter,
        ease(enter.easing, localTime / inDuration),
        clip,
        stage,
        reducedMotion,
      );
    }
    const outStart = clip.duration - outDuration;
    if (exit && outDuration > 0 && localTime > outStart) {
      const f = ease(exit.easing, (clip.duration - localTime) / outDuration);
      state = applyPhase(state, exit, f, clip, stage, reducedMotion);
    }
  }
  if (clip.type === 'highlight' && clip.pulse && !reducedMotion) {
    const phase = (localTime % PULSE_PERIOD) / PULSE_PERIOD;
    const bump = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    state = { ...state, scale: state.scale * (1 + PULSE_AMOUNT * bump) };
  }
  return state;
}

export function isIdentity(state: AnimationState): boolean {
  return state.opacity === 1 && state.x === 0 && state.y === 0 && state.scale === 1;
}
