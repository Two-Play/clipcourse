// SPDX-License-Identifier: MIT
import type { Stage, VisualClip } from '@clipcourse/format';
import { describe, expect, test } from 'vitest';
import {
  animationState,
  ease,
  IDENTITY,
  PULSE_AMOUNT,
  PULSE_PERIOD,
} from '../src/core/animation.js';
import { courseProgress, evaluate } from '../src/core/evaluate.js';
import { chapter, course } from './fixtures.js';

const stage: Stage = { width: 1000, height: 500, background: '#000' };
const clip = (animations: VisualClip['animations'], extra: Partial<VisualClip> = {}): VisualClip =>
  ({
    id: 'c',
    type: 'box',
    start: 0,
    duration: 2000,
    frame: { x: 100, y: 50, width: 200, height: 100 },
    ...(animations ? { animations } : {}),
    ...extra,
  }) as VisualClip;

describe('easing', () => {
  test.each(['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const)('%s runs 0 → 1', (e) => {
    expect(ease(e, 0)).toBe(0);
    expect(ease(e, 1)).toBe(1);
    expect(ease(e, -1)).toBe(0);
    expect(ease(e, 0.5)).toBeGreaterThan(0);
  });
});

describe('animationState', () => {
  test('no animations is the identity', () => {
    expect(animationState(clip(undefined), 500, stage)).toEqual(IDENTITY);
  });

  test('fade in and out', () => {
    const c = clip({
      in: { type: 'fade', duration: 500, easing: 'linear' },
      out: { type: 'fade', duration: 500, easing: 'linear' },
    });
    expect(animationState(c, 0, stage).opacity).toBe(0);
    expect(animationState(c, 250, stage).opacity).toBeCloseTo(0.5);
    expect(animationState(c, 1000, stage).opacity).toBe(1);
    expect(animationState(c, 1750, stage).opacity).toBeCloseTo(0.5);
    expect(animationState(c, 2000, stage).opacity).toBe(0);
  });

  test('slide starts fully off stage in each direction', () => {
    const at0 = (direction: 'left' | 'right' | 'up' | 'down') =>
      animationState(clip({ in: { type: 'slide', direction, duration: 500 } }), 0, stage);
    expect(at0('left').x).toBe(-300); // x + width
    expect(at0('right').x).toBe(900); // stage width - x
    expect(at0('up').y).toBe(-150);
    expect(at0('down').y).toBe(450);
    expect(at0('left').opacity).toBe(1);
  });

  test('zoom scales from half size', () => {
    const c = clip({ in: { type: 'zoom', duration: 400, easing: 'linear' } });
    expect(animationState(c, 0, stage)).toMatchObject({ scale: 0.5, opacity: 0 });
    expect(animationState(c, 400, stage)).toEqual(IDENTITY);
  });

  test('reduced motion turns slide and zoom into fades', () => {
    const c = clip({ in: { type: 'slide', duration: 500, easing: 'linear' } });
    expect(animationState(c, 250, stage, true)).toEqual({ opacity: 0.5, x: 0, y: 0, scale: 1 });
  });

  test('animations longer than the clip are scaled down', () => {
    const c = clip({
      in: { type: 'fade', duration: 3000, easing: 'linear' },
      out: { type: 'fade', duration: 1000, easing: 'linear' },
    });
    // in: 1500 ms, out: 500 ms
    expect(animationState(c, 750, stage).opacity).toBeCloseTo(0.5);
    expect(animationState(c, 1500, stage).opacity).toBe(1);
  });

  test('pulse is periodic and off with reduced motion', () => {
    const c = clip(undefined, {
      type: 'highlight',
      kind: 'frame',
      pulse: true,
    } as Partial<VisualClip>);
    expect(animationState(c, 0, stage).scale).toBe(1);
    expect(animationState(c, PULSE_PERIOD / 2, stage).scale).toBeCloseTo(1 + PULSE_AMOUNT);
    expect(animationState(c, PULSE_PERIOD, stage).scale).toBeCloseTo(1);
    expect(animationState(c, PULSE_PERIOD / 2, stage, true).scale).toBe(1);
  });
});

describe('course progress', () => {
  const c = course([chapter('a', 1000, []), chapter('b', 3000, [])]);
  test('is based on chapter and time only', () => {
    expect(courseProgress(c, 0, 0)).toBe(0);
    expect(courseProgress(c, 1, 1000)).toBe(0.5);
    expect(evaluate(c, 1, 3000).courseProgress).toBe(1);
  });
});
