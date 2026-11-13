// SPDX-License-Identifier: MIT
// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { createManualClock } from '../src/clock.js';
import { createMemoryStore } from '../src/core/progress.js';
import { createPlayer, type Player } from '../src/player.js';
import { branchingCourse } from './fixtures.js';

let player: Player | null = null;
afterEach(() => {
  player?.destroy();
  player = null;
  document.body.innerHTML = '';
});

const withExtras = () =>
  branchingCourse({
    popups: [{ id: 'p', title: 'About', text: 'Line one\nLine two' }],
    glossary: [{ id: 'g', term: 'branch', definition: 'Another way through the course.' }],
  });

function setup(course = withExtras(), store = createMemoryStore()) {
  const host = document.createElement('div');
  document.body.append(host);
  const clock = createManualClock();
  player = createPlayer(host, course, { clock, progressStore: store });
  return { host, clock, store };
}

test('a button clip is a real button that jumps to its chapter', () => {
  const { host } = setup();
  const button = host.querySelector<HTMLButtonElement>('[data-clip-id="toSide"] button')!;
  expect(button.textContent).toBe('Side branch');
  button.click();
  expect(player!.getState()).toMatchObject({ chapterIndex: 1, status: 'playing' });
});

test('a clickable box gets a labelled button; show/hide reveals a hidden clip', () => {
  const { host } = setup();
  const tip = () => host.querySelector<HTMLElement>('[data-clip-id="tip"]')!;
  player!.play();
  expect(tip().style.display).toBe('none');
  const hit = host.querySelector<HTMLButtonElement>('[data-clip-id="reveal"] .ccp-hit')!;
  expect(hit.getAttribute('aria-label')).toBe('Show tip');
  expect(host.querySelector('[data-clip-id="reveal"] .ccp-text')!.getAttribute('aria-hidden')).toBe(
    'true',
  );
  hit.click();
  expect(player!.getState().status).toBe('paused');
  expect(tip().style.display).toBe('');
});

test('a popup is a modal dialog: focus inside, Escape closes, focus returns, playback resumes', () => {
  const course = withExtras();
  const reveal = course.chapters[0]!.tracks[0]!.clips[1]!;
  if (reveal.type === 'box') reveal.action = { type: 'openPopup', popupId: 'p' };
  const { host } = setup(course);
  player!.play();
  const hit = host.querySelector<HTMLButtonElement>('[data-clip-id="reveal"] .ccp-hit')!;
  expect(hit.getAttribute('aria-haspopup')).toBe('dialog');
  hit.focus();
  hit.click();
  const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toBe(
    'About',
  );
  expect(dialog.querySelector('.ccp-dialog-text')!.textContent).toBe('Line one\nLine two');
  expect(player!.getState().status).toBe('paused');
  expect(document.activeElement).toBe(dialog.querySelector('.ccp-dialog-close'));
  // Keys in the dialog do not reach the player's shortcuts.
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
  expect(player!.getState().chapterIndex).toBe(0);
  document.activeElement!.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(hit);
  expect(player!.getState().status).toBe('playing');
});

test('glossary terms open their definition; the contents list the glossary', () => {
  const course = withExtras();
  const tip = course.chapters[0]!.tracks[0]!.clips[2]!;
  if (tip.type === 'box') tip.text = 'Take a branch now.';
  tip.type === 'box' && (tip.startsHidden = false);
  const { host } = setup(course);
  const term = host.querySelector<HTMLButtonElement>('[data-clip-id="tip"] .ccp-term')!;
  expect(term.textContent).toBe('branch');
  term.click();
  expect(host.querySelector('.ccp-dialog-title')!.textContent).toBe('branch');
  // Clickable clips do not get nested term buttons.
  expect(host.querySelector('[data-clip-id="toSide"] .ccp-term')).toBeNull();
  expect(host.querySelector('.ccp-toc-glossary dt')!.textContent).toBe('branch');
  expect(host.querySelector<HTMLElement>('.ccp-toc-btn')!.hidden).toBe(false);
});

test('links open in a new window without access to the player', () => {
  const course = withExtras();
  const clip = course.chapters[0]!.tracks[0]!.clips[3]!;
  if (clip.type === 'button') clip.action = { type: 'openUrl', url: 'https://example.org/' };
  const open = vi.spyOn(window, 'open').mockReturnValue(null);
  const { host } = setup(course);
  const button = host.querySelector<HTMLButtonElement>('[data-clip-id="toMarker"] button')!;
  expect(button.getAttribute('aria-label')).toBe('Later part (opens in a new window)');
  button.click();
  expect(open).toHaveBeenCalledWith('https://example.org/', '_blank', 'noopener,noreferrer');
  open.mockRestore();
});

test('revealed clips are restored on the next launch', () => {
  const store = createMemoryStore();
  let { host } = setup(withExtras(), store);
  host.querySelector<HTMLButtonElement>('[data-clip-id="reveal"] .ccp-hit')!.click();
  player!.saveProgress();
  expect(store.value).toMatch(/^3~/);
  player!.destroy();
  ({ host } = setup(withExtras(), store));
  expect(host.querySelector<HTMLElement>('[data-clip-id="tip"]')!.style.display).toBe('');
});
