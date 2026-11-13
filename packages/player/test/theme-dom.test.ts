// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import { THEME_PRESETS, type Clip } from '@clipcourse/format';
import { afterEach, expect, test } from 'vitest';
import { createManualClock } from '../src/clock.js';
import { createPlayer, type Player } from '../src/player.js';
import { chapter, course } from './fixtures.js';

let player: Player | null = null;
afterEach(() => {
  player?.destroy();
  player = null;
  document.body.innerHTML = '';
});

const light = THEME_PRESETS.find((p) => p.id === 'light')!.theme;

const box: Clip = {
  id: 'b',
  type: 'box',
  start: 0,
  duration: 1000,
  frame: { x: 0, y: 0, width: 10, height: 10 },
  fill: 'theme:surface',
  stroke: '#ff0000',
  text: 'Hi',
  style: { color: 'theme:text' },
};

function render(theme = light) {
  const host = document.createElement('div');
  document.body.append(host);
  const c = course([chapter('a', 1000, [box])], {
    theme,
    stage: { width: 1920, height: 1080, background: 'theme:background' },
  });
  player = createPlayer(host, c, { clock: createManualClock() });
  return host;
}

test('role colors become theme variables; the stage and the controls carry the theme', () => {
  const host = render();
  const stage = host.querySelector<HTMLElement>('.ccp-stage')!;
  expect(stage.style.getPropertyValue('--cct-accent')).toBe(light.colors.accent);
  expect(stage.style.getPropertyValue('--cct-body')).toBe(light.bodyFont);
  expect(stage.style.background).toContain('var(--cct-background)');
  const clip = host.querySelector<HTMLElement>('[data-clip-id="b"]')!;
  expect(clip.style.background).toContain('var(--cct-surface)');
  expect(clip.querySelector<HTMLElement>('.ccp-text')!.style.color).toBe('var(--cct-text)');
  const root = host.querySelector<HTMLElement>('.ccp-root')!;
  expect(root.style.getPropertyValue('--ccp-bar')).toBe(light.colors.surface);
  expect(root.style.getPropertyValue('--ccp-accent')).toBe(light.colors.accent);
});

test('courses without a theme get the default dark theme', () => {
  const host = document.createElement('div');
  document.body.append(host);
  player = createPlayer(host, course([chapter('a', 1000, [])]), { clock: createManualClock() });
  const stage = host.querySelector<HTMLElement>('.ccp-stage')!;
  expect(stage.style.getPropertyValue('--cct-text')).toBe('#ffffff');
});
