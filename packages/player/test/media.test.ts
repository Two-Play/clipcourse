// SPDX-License-Identifier: MIT
import { describe, expect, test, vi } from 'vitest';
import { isMediaStalled, syncMedia, type MediaLike, type MediaTarget } from '../src/dom/media.js';

function fakeMedia(overrides: Partial<MediaLike> = {}): MediaLike {
  const el: MediaLike = {
    paused: true,
    currentTime: 0,
    readyState: 4,
    ended: false,
    seeking: false,
    error: null,
    muted: false,
    volume: 1,
    play: vi.fn(() => {
      el.paused = false;
      return Promise.resolve();
    }),
    pause: vi.fn(() => {
      el.paused = true;
    }),
    ...overrides,
  };
  return el;
}

const target = (t: Partial<MediaTarget>): MediaTarget => ({
  active: true,
  playing: true,
  mediaTime: 0,
  muted: false,
  volume: 1,
  ...t,
});

describe('syncMedia', () => {
  test('starts playback at the expected position', () => {
    const el = fakeMedia();
    syncMedia(el, target({ mediaTime: 2500 }), vi.fn());
    expect(el.currentTime).toBe(2.5);
    expect(el.play).toHaveBeenCalled();
  });

  test('tolerates small drift while playing, corrects large drift', () => {
    const el = fakeMedia({ paused: false, currentTime: 2.6 });
    syncMedia(el, target({ mediaTime: 2500 }), vi.fn());
    expect(el.currentTime).toBe(2.6);
    syncMedia(el, target({ mediaTime: 3500 }), vi.fn());
    expect(el.currentTime).toBe(3.5);
  });

  test('pauses and seeks precisely when the timeline is paused', () => {
    const el = fakeMedia({ paused: false, currentTime: 1 });
    syncMedia(el, target({ playing: false, mediaTime: 1100 }), vi.fn());
    expect(el.pause).toHaveBeenCalled();
    expect(el.currentTime).toBe(1.1);
  });

  test('pauses inactive media', () => {
    const el = fakeMedia({ paused: false });
    syncMedia(el, target({ active: false }), vi.fn());
    expect(el.paused).toBe(true);
  });

  test('applies mute and volume', () => {
    const el = fakeMedia();
    syncMedia(el, target({ muted: true, volume: 0.5 }), vi.fn());
    expect(el).toMatchObject({ muted: true, volume: 0.5 });
  });

  test('reports blocked autoplay', async () => {
    const error = new Error('NotAllowedError');
    const el = fakeMedia({ play: vi.fn(() => Promise.reject(error)) });
    const onBlocked = vi.fn();
    syncMedia(el, target({}), onBlocked);
    await Promise.resolve();
    await Promise.resolve();
    expect(onBlocked).toHaveBeenCalledWith(error);
  });
});

describe('isMediaStalled', () => {
  test('stalls while buffering or seeking', () => {
    expect(isMediaStalled(fakeMedia({ readyState: 2 }), target({}))).toBe(true);
    expect(isMediaStalled(fakeMedia({ seeking: true }), target({}))).toBe(true);
  });

  test('never stalls when paused, inactive, ended or broken', () => {
    expect(isMediaStalled(fakeMedia({ readyState: 0 }), target({ playing: false }))).toBe(false);
    expect(isMediaStalled(fakeMedia({ readyState: 0 }), target({ active: false }))).toBe(false);
    expect(isMediaStalled(fakeMedia({ readyState: 0, ended: true }), target({}))).toBe(false);
    expect(isMediaStalled(fakeMedia({ readyState: 0, error: {} }), target({}))).toBe(false);
  });
});
