// SPDX-License-Identifier: MIT
/**
 * Source of elapsed time. The player only asks "how many ms passed since the
 * last tick"; the timeline itself stays the master clock.
 */
export interface Clock {
  /** Starts calling `tick(deltaMs)` on every frame. */
  start(tick: (delta: number) => void): void;
  stop(): void;
}

/**
 * Longest step taken in one frame. Larger gaps (background tab, debugger,
 * slow device) are not "caught up", so the learner never misses content.
 */
export const MAX_FRAME_DELTA = 250;

export function createAnimationFrameClock(win: Window = window): Clock {
  let handle: number | null = null;
  let last = 0;
  return {
    start(tick) {
      if (handle !== null) return;
      last = win.performance.now();
      const loop = (now: number) => {
        const delta = Math.min(Math.max(now - last, 0), MAX_FRAME_DELTA);
        last = now;
        handle = win.requestAnimationFrame(loop);
        tick(delta);
      };
      handle = win.requestAnimationFrame(loop);
    },
    stop() {
      if (handle !== null) win.cancelAnimationFrame(handle);
      handle = null;
    },
  };
}

/** A clock driven by hand, for tests and tools. */
export function createManualClock(): Clock & { step(delta: number): void; running: boolean } {
  let tick: ((delta: number) => void) | null = null;
  const clock = {
    running: false,
    start(fn: (delta: number) => void) {
      tick = fn;
      clock.running = true;
    },
    stop() {
      tick = null;
      clock.running = false;
    },
    step(delta: number) {
      tick?.(delta);
    },
  };
  return clock;
}
