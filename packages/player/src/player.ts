// SPDX-License-Identifier: MIT
/**
 * Public player: wires the controller (state), the stage (picture and media)
 * and the controls (chrome) together.
 */
import type { Asset, Course } from '@clipcourse/format';
import { createAnimationFrameClock, type Clock } from './clock.js';
import { Controller, type ControllerEvent, type PlayerState } from './core/controller.js';
import { evaluate } from './core/evaluate.js';
import { decodeProgress, encodeProgress, type ProgressStore } from './core/progress.js';
import type { AssetResolver } from './dom/clips.js';
import { Stage } from './dom/stage.js';
import { ICONS, injectStyles } from './dom/styles.js';
import { defaultStrings, format, formatTime, type PlayerStrings } from './i18n.js';

export interface PlayerOptions {
  /** Base URL for relative asset paths. Defaults to the document's base URI. */
  assetBaseUrl?: string;
  /** Full control over asset URLs (e.g. blob: URLs in the editor preview). */
  resolveAsset?: AssetResolver;
  /** Loads caption files. Defaults to fetch(). */
  loadText?: (url: string) => Promise<string>;
  /** Where progress is loaded from and saved to. */
  progressStore?: ProgressStore;
  /** Show captions from the start. Default false. */
  captions?: boolean;
  /** Override UI strings (i18n). */
  strings?: Partial<PlayerStrings>;
  /** Time source. Defaults to requestAnimationFrame. */
  clock?: Clock;
  /** Pause when the page is hidden. Default true. */
  pauseWhenHidden?: boolean;
}

export type PlayerEvent =
  | ControllerEvent
  | { type: 'statechange'; state: PlayerState }
  | { type: 'mediaerror'; clipId: string };

export interface Player {
  readonly course: Course;
  readonly element: HTMLElement;
  getState(): PlayerState;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(time: number): void;
  goToChapter(index: number, time?: number): void;
  next(): void;
  previous(): void;
  setCaptions(enabled: boolean): void;
  /** Writes the current progress to the store immediately. */
  saveProgress(): void;
  on(listener: (event: PlayerEvent) => void): () => void;
  destroy(): void;
}

/** How often progress is saved while playing, ms. */
const SAVE_INTERVAL = 5000;
const SEEK_STEP = 5000;

export function createPlayer(container: HTMLElement, course: Course, options: PlayerOptions = {}): Player {
  if (course.formatVersion !== 1) {
    throw new Error(`Unsupported course format version ${String(course.formatVersion)}`);
  }
  const doc = container.ownerDocument;
  const win = doc.defaultView ?? window;
  const strings: PlayerStrings = { ...defaultStrings, ...options.strings };
  const clock = options.clock ?? createAnimationFrameClock(win);
  const store = options.progressStore;
  const listeners = new Set<(event: PlayerEvent) => void>();
  const emit = (event: PlayerEvent) => listeners.forEach((l) => l(event));

  injectStyles(doc);

  const restored = decodeProgress(store?.load(), course.chapters.length);
  const controller = new Controller(course, restored);
  let started = false;
  let captionsOn = options.captions === true;
  let sinceSave = 0;
  let destroyed = false;

  const resolveAsset: AssetResolver =
    options.resolveAsset ??
    ((asset: Asset) =>
      /^https?:\/\//.test(asset.src) ? asset.src : new URL(asset.src, options.assetBaseUrl ?? doc.baseURI).href);

  // --- DOM -----------------------------------------------------------------
  const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, attrs: Record<string, string> = {}) => {
    const el = doc.createElement(tag);
    el.className = className;
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  const button = (className: string, label: string, iconHtml: string) => {
    const b = h('button', className, { type: 'button', 'aria-label': label, title: label });
    b.innerHTML = iconHtml; // static, trusted SVG markup from ICONS
    return b;
  };

  const root = h('div', 'ccp-root', { lang: course.language });
  const viewport = h('div', 'ccp-viewport');
  const stage = new Stage(doc, course, {
    resolveAsset,
    ...(options.loadText ? { loadText: options.loadText } : {}),
    onPlayBlocked: () => {
      // Autoplay policy: wait for a user gesture.
      controller.pause();
      started = false;
      update();
    },
    onMediaError: (clipId) => {
      errorBox.hidden = false;
      emit({ type: 'mediaerror', clipId });
    },
  });
  stage.element.setAttribute('role', 'region');
  stage.element.setAttribute('aria-label', course.title);

  const overlay = h('div', 'ccp-overlay');
  const startButton = h('button', 'ccp-big', { type: 'button' });
  overlay.append(startButton);
  const continueButton = h('button', 'ccp-big ccp-continue', { type: 'button' });
  continueButton.textContent = strings.continue;
  continueButton.hidden = true;
  const spinner = h('div', 'ccp-spinner', { role: 'status', 'aria-label': strings.loading });
  spinner.hidden = true;
  const errorBox = h('div', 'ccp-error', { role: 'alert' });
  errorBox.textContent = strings.mediaError;
  errorBox.hidden = true;
  viewport.append(stage.element, overlay, continueButton, spinner, errorBox);

  const controls = h('div', 'ccp-controls', { role: 'group', 'aria-label': strings.controls });
  const prevButton = button('ccp-btn ccp-prev', strings.previousChapter, ICONS.previous);
  const playButton = button('ccp-btn ccp-play', strings.play, ICONS.play);
  const nextButton = button('ccp-btn ccp-next', strings.nextChapter, ICONS.next);
  const seek = h('input', 'ccp-seek', { type: 'range', min: '0', step: '100', 'aria-label': strings.seek });
  const time = h('span', 'ccp-time', { 'aria-hidden': 'true' });
  const title = h('span', 'ccp-title');
  const ccButton = button('ccp-btn ccp-cc', strings.captionsOn, ICONS.captions);
  controls.append(prevButton, playButton, nextButton, seek, time, title, ccButton);

  const live = h('div', 'ccp-sr', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.append(viewport, controls, live);
  container.append(root);

  // --- Scaling ---------------------------------------------------------------
  const fit = () => {
    const w = viewport.clientWidth;
    const hh = viewport.clientHeight;
    if (!w || !hh) return;
    const scale = Math.min(w / course.stage.width, hh / course.stage.height);
    const x = (w - course.stage.width * scale) / 2;
    const y = (hh - course.stage.height * scale) / 2;
    stage.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  };
  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
  resizeObserver?.observe(viewport);
  fit();

  // --- Rendering -----------------------------------------------------------
  let lastChapterLabel = '';
  function update() {
    if (destroyed) return;
    const state = controller.state;
    const chapter = course.chapters[state.chapterIndex]!;
    const playing = state.status === 'playing';

    stage.render(evaluate(course, state.chapterIndex, state.time), playing);
    spinner.hidden = !(playing && stage.isStalled);

    overlay.hidden = started || playing;
    const startLabel =
      state.time > 0 || state.chapterIndex > 0 || state.seen.some(Boolean) ? strings.resume : strings.start;
    if (startButton.dataset.label !== startLabel) {
      startButton.dataset.label = startLabel;
      startButton.innerHTML = ICONS.play; // static SVG
      startButton.append(startLabel);
    }

    const waiting = state.status === 'waiting';
    continueButton.hidden = !waiting;
    const playIcon = playing ? 'pause' : state.status === 'ended' ? 'replay' : 'play';
    if (playButton.dataset.icon !== playIcon) {
      playButton.dataset.icon = playIcon;
      playButton.innerHTML = ICONS[playIcon];
    }
    const playLabel = playing ? strings.pause : state.status === 'ended' ? strings.replay : strings.play;
    playButton.setAttribute('aria-label', playLabel);
    playButton.title = playLabel;
    prevButton.disabled = !controller.hasPrevious;
    nextButton.disabled = !controller.hasNext;

    seek.max = String(chapter.duration);
    seek.value = String(state.time);
    const timeText = format(strings.timeOf, {
      current: formatTime(state.time),
      total: formatTime(chapter.duration),
    });
    seek.setAttribute('aria-valuetext', timeText);
    time.textContent = `${formatTime(state.time)} / ${formatTime(chapter.duration)}`;

    const chapterLabel = format(strings.chapterLabel, {
      index: state.chapterIndex + 1,
      count: course.chapters.length,
      title: chapter.title,
    });
    if (chapterLabel !== lastChapterLabel) {
      title.textContent = chapterLabel;
      lastChapterLabel = chapterLabel;
    }

    const hasCaptions = stage.hasCaptions(state.chapterIndex);
    ccButton.hidden = !hasCaptions;
    ccButton.setAttribute('aria-pressed', String(captionsOn));
    const ccLabel = captionsOn ? strings.captionsOff : strings.captionsOn;
    ccButton.setAttribute('aria-label', ccLabel);
    ccButton.title = ccLabel;
  }

  const announce = (text: string) => {
    live.textContent = '';
    // Re-set in a new task so screen readers announce repeated messages.
    win.setTimeout(() => (live.textContent = text), 50);
  };

  const saveProgress = () => store?.save(encodeProgress(controller.progress));

  controller.subscribe((state, events) => {
    for (const event of events) {
      if (event.type === 'chapterchange') {
        const chapter = course.chapters[event.chapterIndex]!;
        announce(
          format(strings.chapterLabel, {
            index: event.chapterIndex + 1,
            count: course.chapters.length,
            title: chapter.title,
          }),
        );
        saveProgress();
      } else if (event.type === 'chapterseen') {
        saveProgress();
      }
      emit(event);
    }
    if (state.status === 'waiting' && events.some((e) => e.type === 'chapterseen')) {
      announce(strings.chapterComplete);
      if (root.contains(doc.activeElement)) continueButton.focus();
    }
    if (state.status === 'ended' && events.some((e) => e.type === 'chapterseen')) {
      announce(strings.courseComplete);
    }
    if (state.status === 'playing') clock.start(onTick);
    else {
      clock.stop();
      saveProgress();
    }
    update();
    emit({ type: 'statechange', state });
  });

  function onTick(delta: number) {
    if (stage.isStalled) {
      update();
      return;
    }
    sinceSave += delta;
    controller.advance(delta);
    if (sinceSave >= SAVE_INTERVAL) {
      sinceSave = 0;
      saveProgress();
    }
  }

  // --- Input -----------------------------------------------------------------
  const play = () => {
    started = true;
    controller.play();
  };
  startButton.addEventListener('click', play);
  continueButton.addEventListener('click', play);
  playButton.addEventListener('click', () => {
    started = true;
    controller.toggle();
  });
  prevButton.addEventListener('click', () => controller.previous());
  nextButton.addEventListener('click', () => controller.next());
  seek.addEventListener('input', () => controller.seek(Number(seek.value)));
  ccButton.addEventListener('click', () => setCaptions(!captionsOn));

  root.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onButton = target.tagName === 'BUTTON';
    const onRange = target === seek;
    let handled = true;
    switch (event.key) {
      case ' ':
      case 'k':
      case 'K':
        if (onButton && event.key === ' ') return; // native button activation
        started = true;
        controller.toggle();
        break;
      case 'ArrowLeft':
        if (onRange) return;
        controller.seek(controller.state.time - SEEK_STEP);
        break;
      case 'ArrowRight':
        if (onRange) return;
        controller.seek(controller.state.time + SEEK_STEP);
        break;
      case 'n':
      case 'N':
        controller.next();
        break;
      case 'p':
      case 'P':
        controller.previous();
        break;
      case 'c':
      case 'C':
        if (stage.hasCaptions(controller.state.chapterIndex)) setCaptions(!captionsOn);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  });

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      if (options.pauseWhenHidden !== false) controller.pause();
      saveProgress();
    }
  };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', saveProgress);

  function setCaptions(enabled: boolean) {
    captionsOn = enabled;
    stage.setCaptionsEnabled(enabled);
    update();
  }

  setCaptions(captionsOn);

  return {
    course,
    element: root,
    getState: () => controller.state,
    play,
    pause: () => controller.pause(),
    toggle: () => {
      started = true;
      controller.toggle();
    },
    seek: (t) => controller.seek(t),
    goToChapter: (i, t = 0) => controller.goToChapter(i, t),
    next: () => controller.next(),
    previous: () => controller.previous(),
    setCaptions,
    saveProgress,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      saveProgress();
      destroyed = true;
      clock.stop();
      resizeObserver?.disconnect();
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pagehide', saveProgress);
      stage.destroy();
      root.remove();
      listeners.clear();
    },
  };
}
