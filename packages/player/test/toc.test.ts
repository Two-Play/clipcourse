// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { createPlayer, type Player } from '../src/player.js';
import { createManualClock } from '../src/clock.js';
import { evaluate } from '../src/core/evaluate.js';
import { Stage } from '../src/dom/stage.js';
import { box, chapter, course } from './fixtures.js';

let player: Player | null = null;
afterEach(() => {
  player?.destroy();
  player = null;
  document.body.innerHTML = '';
});

const twoChapters = () =>
  course([
    {
      ...chapter('a', 4000, [box('a1', 0, 4000)]),
      markers: [{ id: 'm1', time: 2000, title: 'Second half' }],
    },
    chapter('b', 1000, [box('b1', 0, 1000)]),
  ]);

test('table of contents lists chapters and markers and jumps', () => {
  const host = document.createElement('div');
  document.body.append(host);
  player = createPlayer(host, twoChapters(), { clock: createManualClock() });
  const tocButton = host.querySelector<HTMLButtonElement>('.ccp-toc-btn')!;
  expect(tocButton.hidden).toBe(false);
  tocButton.click();
  const nav = host.querySelector<HTMLElement>('.ccp-toc')!;
  expect(nav.hidden).toBe(false);
  expect(tocButton.getAttribute('aria-expanded')).toBe('true');
  const items = [...nav.querySelectorAll<HTMLButtonElement>('button.ccp-toc-item')];
  expect(items.map((b) => b.textContent)).toEqual([
    '1.Chapter acurrent',
    'Second half',
    '2.Chapter b',
  ]);
  items[1]!.click();
  expect(player.getState()).toMatchObject({ chapterIndex: 0, time: 2000 });
  expect(nav.hidden).toBe(true);
  tocButton.click();
  nav.querySelectorAll<HTMLButtonElement>('button.ccp-toc-item')[2]!.click();
  expect(player.getState().chapterIndex).toBe(1);
  expect(host.querySelectorAll('.ccp-tick')).toHaveLength(0);
  player.goToChapter(0);
  expect(host.querySelectorAll('.ccp-tick')).toHaveLength(1);
});

test('no table of contents for a single chapter without markers', () => {
  const host = document.createElement('div');
  document.body.append(host);
  player = createPlayer(host, course([chapter('a', 1000, [])]), { clock: createManualClock() });
  expect(host.querySelector<HTMLButtonElement>('.ccp-toc-btn')!.hidden).toBe(true);
});

test('stage applies animations and fills progress clips', () => {
  const c = course([
    {
      ...chapter('a', 2000, []),
      tracks: [
        {
          id: 't',
          clips: [
            {
              id: 'fade',
              type: 'box',
              start: 0,
              duration: 2000,
              frame: { x: 0, y: 0, width: 10, height: 10, rotation: 10 },
              animations: { in: { type: 'zoom', duration: 1000, easing: 'linear' } },
            },
            {
              id: 'bar',
              type: 'progress',
              start: 0,
              duration: 2000,
              frame: { x: 0, y: 0, width: 100, height: 4 },
            },
            {
              id: 'hl',
              type: 'highlight',
              kind: 'spotlight',
              label: 'Look here',
              start: 0,
              duration: 2000,
              frame: { x: 0, y: 0, width: 10, height: 10 },
            },
          ],
        },
      ],
    },
    chapter('b', 2000, []),
  ]);
  const stage = new Stage(document, c, {
    resolveAsset: () => '',
    onPlayBlocked: () => {},
    onMediaError: () => {},
  });
  stage.render(evaluate(c, 0, 500), false);
  const fade = stage.element.querySelector<HTMLElement>('[data-clip-id="fade"]')!;
  expect(fade.style.opacity).toBe('0.5');
  expect(fade.style.transform).toBe('rotate(10deg) scale(0.75)');
  const bar = stage.element.querySelector<HTMLElement>('[data-clip-id="bar"]')!;
  expect(bar.getAttribute('aria-valuenow')).toBe('13');
  expect((bar.firstElementChild as HTMLElement).style.width).toBe('12.5%');
  expect(stage.element.querySelector('[data-clip-id="hl"]')!.textContent).toBe('Look here');
  stage.render(evaluate(c, 0, 1500), false);
  expect(fade.style.opacity).toBe('');
  expect(fade.style.transform).toBe('rotate(10deg)');
});
