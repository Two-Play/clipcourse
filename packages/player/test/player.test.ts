// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Course } from '@clipcourse/format';
import { createPlayer, type Player } from '../src/player.js';
import { createManualClock } from '../src/clock.js';
import { createMemoryStore, encodeProgress } from '../src/core/progress.js';
import { box, chapter, course } from './fixtures.js';

let container: HTMLElement;
let player: Player | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  player?.destroy();
  player = null;
  container.remove();
});

const textCourse = (): Course =>
  course([
    {
      ...chapter('one', 2000, []),
      tracks: [
        {
          id: 't',
          clips: [
            {
              id: 'title',
              type: 'text',
              text: 'Hello <b>world</b>',
              role: 'heading',
              start: 0,
              duration: 1000,
              frame: { x: 0, y: 0, width: 100, height: 50 },
            },
            {
              id: 'later',
              type: 'box',
              text: 'Later',
              start: 1000,
              duration: 1000,
              frame: { x: 0, y: 0, width: 100, height: 50 },
            },
          ],
        },
      ],
    },
    chapter('two', 1000, [box('b2', 0, 1000)]),
  ]);

const visible = (id: string) => {
  const el = container.querySelector<HTMLElement>(`[data-clip-id="${id}"]`);
  return el !== null && el.style.display !== 'none';
};
const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T;

describe('createPlayer', () => {
  test('renders text safely as plain text with heading semantics', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    const heading = q('[data-clip-id="title"] h2');
    expect(heading.textContent).toBe('Hello <b>world</b>');
    expect(heading.querySelector('b')).toBeNull();
    expect(q('.ccp-root').getAttribute('lang')).toBe('en');
  });

  test('shows the start overlay until playback starts', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    expect(q('.ccp-overlay').hidden).toBe(false);
    q<HTMLButtonElement>('.ccp-overlay button').click();
    expect(q('.ccp-overlay').hidden).toBe(true);
    expect(player.getState().status).toBe('playing');
  });

  test('plays through time with the clock and swaps clips', () => {
    const clock = createManualClock();
    player = createPlayer(container, textCourse(), { clock });
    expect(visible('title')).toBe(true);
    player.play();
    clock.step(250);
    clock.step(250);
    clock.step(250);
    clock.step(250);
    expect(player.getState().time).toBe(1000);
    expect(visible('title')).toBe(false);
    expect(visible('later')).toBe(true);
  });

  test('seek renders the exact state for that time', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    player.seek(1500);
    expect(visible('later')).toBe(true);
    player.seek(10);
    expect(visible('title')).toBe(true);
    expect(visible('later')).toBe(false);
    expect(q<HTMLInputElement>('.ccp-seek').value).toBe('10');
  });

  test('waits for Continue at the end of a chapter', () => {
    const clock = createManualClock();
    player = createPlayer(container, textCourse(), { clock });
    player.play();
    for (let i = 0; i < 10; i++) clock.step(250);
    expect(player.getState().status).toBe('waiting');
    expect(clock.running).toBe(false);
    const cont = q<HTMLButtonElement>('.ccp-continue');
    expect(cont.hidden).toBe(false);
    cont.click();
    expect(player.getState()).toMatchObject({ chapterIndex: 1, status: 'playing' });
    expect(visible('b2')).toBe(true);
    expect(container.querySelector('[data-clip-id="title"]')).toBeNull();
  });

  test('saves and restores progress', () => {
    const store = createMemoryStore();
    const clock = createManualClock();
    player = createPlayer(container, textCourse(), { clock, progressStore: store });
    player.play();
    for (let i = 0; i < 8; i++) clock.step(250);
    player.next();
    player.seek(500);
    player.pause();
    expect(store.value).toBe(encodeProgress({ chapterIndex: 1, time: 500, seen: [true, false] }));
    player.destroy();

    player = createPlayer(container, textCourse(), {
      clock: createManualClock(),
      progressStore: store,
    });
    expect(player.getState()).toMatchObject({ chapterIndex: 1, time: 500, seen: [true, false] });
    expect(q('.ccp-overlay button').textContent).toContain('Resume');
  });

  test('ignores corrupt stored progress', () => {
    player = createPlayer(container, textCourse(), {
      clock: createManualClock(),
      progressStore: createMemoryStore('not-progress'),
    });
    expect(player.getState()).toMatchObject({ chapterIndex: 0, time: 0 });
  });

  test('keyboard: space toggles, arrows seek, n/p switch chapters', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    const root = q('.ccp-root');
    const key = (k: string) =>
      root.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(' ');
    expect(player.getState().status).toBe('playing');
    key('k');
    expect(player.getState().status).toBe('paused');
    key('ArrowRight');
    expect(player.getState().time).toBe(2000);
    key('ArrowLeft');
    expect(player.getState().time).toBe(0);
    key('n');
    expect(player.getState().chapterIndex).toBe(1);
    key('p');
    expect(player.getState().chapterIndex).toBe(0);
  });

  test('disables chapter buttons at the edges', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    expect(q<HTMLButtonElement>('.ccp-prev').disabled).toBe(true);
    expect(q<HTMLButtonElement>('.ccp-next').disabled).toBe(false);
  });

  test('hides the captions button when there are no captions', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    expect(q('.ccp-cc').hidden).toBe(true);
  });

  test('emits complete once all chapters are seen', () => {
    const clock = createManualClock();
    player = createPlayer(container, textCourse(), { clock });
    const events: string[] = [];
    player.on((e) => events.push(e.type));
    player.play();
    for (let i = 0; i < 8; i++) clock.step(250);
    player.play();
    for (let i = 0; i < 4; i++) clock.step(250);
    expect(events).toContain('complete');
    expect(player.getState()).toMatchObject({ status: 'ended', complete: true });
  });

  test('applies custom strings', () => {
    player = createPlayer(container, textCourse(), {
      clock: createManualClock(),
      strings: { start: 'Los geht’s' },
    });
    expect(q('.ccp-overlay button').textContent).toContain('Los geht’s');
  });

  test('destroy removes everything', () => {
    player = createPlayer(container, textCourse(), { clock: createManualClock() });
    player.destroy();
    expect(container.children).toHaveLength(0);
  });
});
