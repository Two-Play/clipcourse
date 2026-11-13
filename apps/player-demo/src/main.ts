// SPDX-License-Identifier: MIT
import { validateCourse } from '@clipcourse/format/validation';
import { createLocalStorageStore, createPlayer, type Player } from '@clipcourse/player';

declare global {
  interface Window {
    __player?: Player;
  }
}

const params = new URLSearchParams(location.search);
const courseName = params.get('course') ?? 'welcome';
if (!/^[a-z0-9-]+$/.test(courseName)) throw new Error('Invalid course name');
const courseUrl = new URL(`/${courseName}/course.json`, location.href);

const container = document.getElementById('player')!;
const errors = document.getElementById('errors')!;
const status = document.getElementById('status')!;

async function main() {
  const response = await fetch(courseUrl);
  if (!response.ok)
    throw new Error(`Could not load ${courseUrl.pathname}: HTTP ${response.status}`);
  const result = validateCourse(await response.json());
  if (!result.ok) {
    errors.textContent = result.issues.map((i) => `${i.path}: ${i.message}`).join('\n');
    container.hidden = true;
    return;
  }
  for (const warning of result.warnings) console.warn(`${warning.path}: ${warning.message}`);

  const storeKey = `clipcourse:${result.course.id}`;
  const player = createPlayer(container, result.course, {
    assetBaseUrl: courseUrl.href,
    progressStore: createLocalStorageStore(storeKey),
    captions: params.has('captions'),
  });
  window.__player = player;

  const showStatus = () => {
    const s = player.getState();
    const seen = s.seen.map((v) => (v ? '■' : '□')).join('');
    status.textContent = `${s.status} · ch ${s.chapterIndex + 1} · ${(s.time / 1000).toFixed(1)}s · ${seen}${s.complete ? ' · complete' : ''}`;
    status.dataset.status = s.status;
  };
  player.on((event) => {
    if (event.type === 'statechange') showStatus();
    if (event.type === 'complete') console.info('Course complete');
  });
  showStatus();

  document.getElementById('reset')!.addEventListener('click', () => {
    player.destroy();
    localStorage.removeItem(storeKey);
    location.reload();
  });
}

main().catch((error: unknown) => {
  errors.textContent = String(error);
});
