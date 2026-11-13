// SPDX-License-Identifier: MIT
/**
 * Public player: wires the controller (state), the stage (picture and media)
 * and the controls (chrome) together.
 */
import {
  FORMAT_VERSION,
  themeOf,
  type Asset,
  type Course,
  type GlossaryEntry,
  type Question,
  type QuestionClip,
  type VisualClip,
} from '@clipcourse/format';
import { visibilityTargets } from './core/interactions.js';
import { applyThemeVariables } from './dom/theme.js';
import { createAnimationFrameClock, type Clock } from './clock.js';
import { Controller, type ControllerEvent, type PlayerState } from './core/controller.js';
import { evaluate } from './core/evaluate.js';
import { decodeProgress, encodeProgress, type ProgressStore } from './core/progress.js';
import { collectQuestions, shuffled, type AnswerState, type Response } from './core/quiz.js';
import { renderQuestion } from './dom/question.js';
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
  /** Show the table of contents button. Default true. */
  toc?: boolean;
  /**
   * Replace slide and zoom animations by fades and stop pulsing.
   * Default: the user's "reduce motion" system setting.
   */
  reducedMotion?: boolean;
}

export type PlayerEvent =
  | ControllerEvent
  | { type: 'statechange'; state: PlayerState }
  | { type: 'mediaerror'; clipId: string };

export interface Player {
  readonly course: Course;
  readonly element: HTMLElement;
  getState(): PlayerState;
  /** Answers a question (as if the learner submitted the form). */
  answer(questionId: string, response: Response): AnswerState | null;
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

export function createPlayer(
  container: HTMLElement,
  course: Course,
  options: PlayerOptions = {},
): Player {
  if (!(course.formatVersion >= 1 && course.formatVersion <= FORMAT_VERSION)) {
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

  const questionIds = collectQuestions(course).map((ref) => ref.question.id);
  const clipsById = new Map<string, VisualClip>();
  for (const track of [
    ...(course.courseLayer?.background ?? []),
    ...(course.courseLayer?.foreground ?? []),
    ...course.chapters.flatMap((c) => c.tracks),
  ]) {
    for (const clip of track.clips) if (clip.type !== 'audio') clipsById.set(clip.id, clip);
  }
  const progressLayout = {
    questionIds,
    visibilityTargets: visibilityTargets(course).map((id) => ({
      id,
      shown: clipsById.get(id)?.startsHidden !== true,
    })),
  };
  const restored = decodeProgress(store?.load(), course.chapters.length, progressLayout);
  const controller = new Controller(course, restored);
  /** Question clip hosts currently on the stage, to re-render after answers. */
  const questionHosts = new Map<string, { clip: QuestionClip; host: HTMLElement }>();
  let started = false;
  let captionsOn = options.captions === true;
  let sinceSave = 0;
  let destroyed = false;

  const resolveAsset: AssetResolver =
    options.resolveAsset ??
    ((asset: Asset) =>
      /^https?:\/\//.test(asset.src)
        ? asset.src
        : new URL(asset.src, options.assetBaseUrl ?? doc.baseURI).href);

  // --- DOM -----------------------------------------------------------------
  const h = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
    attrs: Record<string, string> = {},
  ) => {
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

  // tabindex=-1: clicking anywhere in the player keeps keyboard shortcuts working.
  const root = h('div', 'ccp-root', { lang: course.language, tabindex: '-1' });
  applyThemeVariables(root, themeOf(course), true);
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
    strings,
    mountQuestion: (clip, host) => {
      questionHosts.set(clip.id, { clip, host });
      mountQuestionClip(clip, host, false);
    },
    onAction: (clip, trigger) => runAction(clip, trigger),
    onTerm: (entry, trigger) => openGlossaryEntry(entry, trigger),
  });

  // --- Click actions and popups --------------------------------------------------
  function runAction(clip: VisualClip, trigger: HTMLElement) {
    const action = clip.action;
    if (!action) return;
    started = true;
    if (action.type === 'openPopup') {
      const popup = course.popups?.find((p) => p.id === action.popupId);
      if (popup) {
        const asset = popup.assetId ? course.assets[popup.assetId] : undefined;
        openDialog({
          title: popup.title,
          text: popup.text,
          trigger,
          ...(asset && popup.assetId
            ? {
                image: {
                  src: resolveAsset(asset, popup.assetId),
                  alt: popup.alt ?? asset.alt ?? '',
                },
              }
            : {}),
        });
      }
    } else if (action.type === 'openUrl') {
      win.open(action.url, '_blank', 'noopener,noreferrer');
    } else {
      controller.runAction(action);
    }
  }

  function openGlossaryEntry(entry: GlossaryEntry, trigger: HTMLElement) {
    openDialog({ title: entry.term, text: entry.definition, trigger });
  }

  const dialog = h('div', 'ccp-dialog');
  dialog.hidden = true;
  let dialogReturn: { trigger: HTMLElement; resume: boolean } | null = null;

  /** A modal info window: focus stays inside, Escape closes, focus returns. */
  function openDialog(options: {
    title: string;
    text: string;
    trigger: HTMLElement;
    image?: { src: string; alt: string };
  }) {
    const resume = controller.state.status === 'playing';
    controller.pause();
    const titleId = `ccp-dlg-${Math.random().toString(36).slice(2, 8)}`;
    const panel = h('div', 'ccp-dialog-panel', {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
    });
    const heading = h('h2', 'ccp-dialog-title', { id: titleId });
    heading.textContent = options.title;
    const close = button('ccp-btn ccp-dialog-close', strings.close, ICONS.close);
    const head = h('div', 'ccp-dialog-head');
    head.append(heading, close);
    panel.append(head);
    if (options.image) {
      const img = h('img', 'ccp-dialog-image');
      img.src = options.image.src;
      img.alt = options.image.alt;
      panel.append(img);
    }
    const body = h('p', 'ccp-dialog-text');
    body.textContent = options.text;
    panel.append(body);
    close.addEventListener('click', closeDialog);
    dialog.replaceChildren(panel);
    dialog.hidden = false;
    dialogReturn = { trigger: options.trigger, resume };
    close.focus();
  }

  function closeDialog() {
    if (dialog.hidden) return;
    dialog.hidden = true;
    dialog.replaceChildren();
    const ret = dialogReturn;
    dialogReturn = null;
    if (ret?.resume) controller.play();
    // The trigger may be gone (other chapter); fall back to the player.
    (ret && ret.trigger.isConnected ? ret.trigger : root).focus();
  }

  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog();
    } else if (event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]')];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && doc.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && doc.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  function mountQuestionClip(clip: QuestionClip, host: HTMLElement, focusFeedback: boolean) {
    const state = controller.state.answers[clip.question.id];
    host.replaceChildren(
      renderQuestion(doc, {
        question: clip.question,
        state,
        strings,
        assets: course.assets,
        imageUrl: resolveAsset,
        interactive: true,
        focusFeedback,
        onSubmit: (response) => controller.answer(clip.question.id, response),
        continueLabel: strings.continue,
        onContinue: () => {
          started = true;
          controller.play();
        },
      }),
    );
  }

  // --- Quiz chapters ------------------------------------------------------------
  const quizLayer = h('div', 'ccp-quiz');
  quizLayer.hidden = true;
  let quizKey = '';

  function quizOrder(chapterIndex: number): Question[] {
    const chapter = course.chapters[chapterIndex]!;
    const questions = chapter.quiz?.questions ?? [];
    const round = controller.state.quizRetries[chapterIndex] ?? 0;
    return chapter.quiz?.shuffle ? shuffled(questions, `${chapter.id}#${round}`) : questions;
  }

  function renderQuiz(focus: boolean) {
    const state = controller.state;
    const chapter = course.chapters[state.chapterIndex]!;
    if (!chapter.quiz) {
      quizLayer.hidden = true;
      quizKey = '';
      return;
    }
    quizLayer.hidden = false;
    const order = quizOrder(state.chapterIndex);
    const answers = state.answers;
    const firstOpen = order.findIndex((q) => !answers[q.id]?.done);
    // While a question was just answered (done) we keep showing it with feedback.
    const shown =
      quizShown && order.find((q) => q.id === quizShown) && state.status === 'quiz'
        ? quizShown
        : null;
    const current = shown ? order.findIndex((q) => q.id === shown) : firstOpen;
    const key = `${state.chapterIndex}|${state.status}|${current}|${JSON.stringify(answers[order[current]?.id ?? ''] ?? null)}|${state.quizRetries[state.chapterIndex] ?? 0}`;
    if (key === quizKey) return;
    quizKey = key;
    const panel = h('div', 'ccp-quiz-panel', { role: 'region', 'aria-label': chapter.title });

    if (state.status === 'quiz' && current >= 0) {
      const question = order[current]!;
      const progressLine = h('p', 'ccp-quiz-progress');
      progressLine.textContent = format(strings.questionOf, {
        index: current + 1,
        count: order.length,
      });
      const last = order.every((q, i) => i === current || answers[q.id]?.done);
      panel.append(
        progressLine,
        renderQuestion(doc, {
          question,
          state: answers[question.id],
          strings,
          assets: course.assets,
          imageUrl: resolveAsset,
          interactive: true,
          focusFeedback: focus,
          onSubmit: (response) => {
            quizShown = question.id;
            controller.answer(question.id, response);
          },
          continueLabel: last ? strings.finishQuiz : strings.nextQuestion,
          onContinue: () => {
            quizShown = null;
            if (last) controller.finishQuiz();
            else renderQuiz(true);
          },
        }),
      );
    } else {
      // Result screen.
      const quizQuestions = chapter.quiz.questions;
      const correct = quizQuestions.filter((q) => answers[q.id]?.correct).length;
      let earned = 0;
      let possible = 0;
      for (const q of quizQuestions) {
        if (q.scored === false) continue;
        possible += q.points ?? 1;
        if (answers[q.id]?.correct) earned += q.points ?? 1;
      }
      const percent = possible ? Math.round((earned / possible) * 1000) / 10 : null;
      const heading = h('h2', 'ccp-quiz-title');
      heading.textContent = chapter.title;
      heading.tabIndex = -1;
      const result = h('p', 'ccp-quiz-result');
      result.textContent = format(strings.quizResult, { correct, count: quizQuestions.length });
      panel.append(heading, result);
      if (percent !== null) {
        const scoreLine = h('p', 'ccp-quiz-score');
        scoreLine.textContent = format(strings.quizScore, { percent });
        panel.append(scoreLine);
        if (course.assessment) {
          const verdict = h(
            'p',
            `ccp-quiz-verdict ${percent >= course.assessment.passingScore ? 'is-passed' : 'is-failed'}`,
          );
          verdict.textContent =
            percent >= course.assessment.passingScore
              ? strings.quizPassed
              : format(strings.quizFailed, { required: course.assessment.passingScore });
          panel.append(verdict);
        }
      }
      const actions = h('div', 'ccp-q-actions');
      const retriesLeft = controller.retriesLeft;
      if (retriesLeft > 0 && correct < quizQuestions.length) {
        const retry = h('button', 'ccp-q-submit', { type: 'button' });
        retry.textContent = format(strings.retryQuiz, { count: retriesLeft });
        retry.addEventListener('click', () => {
          quizShown = null;
          controller.retryQuiz();
        });
        actions.append(retry);
      }
      if (state.status === 'waiting') {
        const next = h('button', 'ccp-q-continue', { type: 'button' });
        next.textContent = strings.continue;
        next.addEventListener('click', () => {
          started = true;
          controller.play();
        });
        actions.append(next);
      }
      panel.append(actions);
      if (focus) queueMicrotask(() => heading.focus());
    }
    quizLayer.replaceChildren(panel);
  }
  let quizShown: string | null = null;
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
  stage.element.append(quizLayer);
  viewport.append(stage.element, overlay, continueButton, spinner, errorBox, dialog);

  const controls = h('div', 'ccp-controls', { role: 'group', 'aria-label': strings.controls });
  const prevButton = button('ccp-btn ccp-prev', strings.previousChapter, ICONS.previous);
  const playButton = button('ccp-btn ccp-play', strings.play, ICONS.play);
  const nextButton = button('ccp-btn ccp-next', strings.nextChapter, ICONS.next);
  const seek = h('input', 'ccp-seek', {
    type: 'range',
    min: '0',
    step: '100',
    'aria-label': strings.seek,
  });
  const time = h('span', 'ccp-time', { 'aria-hidden': 'true' });
  const title = h('span', 'ccp-title');
  const ccButton = button('ccp-btn ccp-cc', strings.captionsOn, ICONS.captions);
  const seekWrap = h('span', 'ccp-seekwrap');
  const ticks = h('span', 'ccp-ticks', { 'aria-hidden': 'true' });
  seekWrap.append(seek, ticks);
  const tocButton = button('ccp-btn ccp-toc-btn', strings.contents, ICONS.contents);
  tocButton.setAttribute('aria-expanded', 'false');
  controls.append(prevButton, playButton, nextButton, seekWrap, time, title, tocButton, ccButton);

  // Table of contents: chapters with their markers.
  const toc = h('nav', 'ccp-toc', { 'aria-label': strings.contents });
  toc.hidden = true;
  tocButton.setAttribute(
    'aria-controls',
    (toc.id = `ccp-toc-${Math.random().toString(36).slice(2, 8)}`),
  );
  const tocHead = h('div', 'ccp-toc-head');
  const tocTitle = h('h2', '');
  tocTitle.textContent = strings.contents;
  const tocClose = button('ccp-btn', strings.closeContents, ICONS.close);
  tocHead.append(tocTitle, tocClose);
  const tocList = h('ol', '');
  const tocItems: { button: HTMLButtonElement; state: HTMLElement }[] = [];
  course.chapters.forEach((chapter, index) => {
    const li = h('li', '');
    const item = h('button', 'ccp-toc-item', { type: 'button' });
    const num = h('span', 'ccp-toc-num');
    num.textContent = `${index + 1}.`;
    const name = h('span', 'ccp-toc-title');
    name.textContent = chapter.title;
    const state = h('span', 'ccp-toc-state');
    item.append(num, name, state);
    item.addEventListener('click', () => jumpTo(index, 0));
    li.append(item);
    if (chapter.markers?.length) {
      const sub = h('ol', '');
      for (const marker of [...chapter.markers].sort((a, b) => a.time - b.time)) {
        const mli = h('li', '');
        const mbutton = h('button', 'ccp-toc-item', { type: 'button' });
        mbutton.textContent = marker.title;
        mbutton.addEventListener('click', () => jumpTo(index, marker.time));
        mli.append(mbutton);
        sub.append(mli);
      }
      li.append(sub);
    }
    tocList.append(li);
    tocItems.push({ button: item, state });
  });
  toc.append(tocHead, tocList);
  if (course.glossary?.length) {
    const glossaryTitle = h('h3', 'ccp-toc-glossary-title');
    glossaryTitle.textContent = strings.glossary;
    const list = h('dl', 'ccp-toc-glossary');
    for (const entry of [...course.glossary].sort((a, b) =>
      a.term.localeCompare(b.term, course.language),
    )) {
      const dt = h('dt', '');
      dt.textContent = entry.term;
      const dd = h('dd', '');
      dd.textContent = entry.definition;
      list.append(dt, dd);
    }
    toc.append(glossaryTitle, list);
  }
  const hasToc =
    options.toc !== false &&
    (course.chapters.length > 1 ||
      course.chapters.some((c) => (c.markers?.length ?? 0) > 0) ||
      (course.glossary?.length ?? 0) > 0);
  tocButton.hidden = !hasToc;
  const reducedMotion =
    options.reducedMotion ??
    (typeof win.matchMedia === 'function' &&
      win.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const live = h('div', 'ccp-sr', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  viewport.append(toc);
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

    stage.render(
      evaluate(course, state.chapterIndex, state.time, {
        reducedMotion,
        visibility: state.visibility,
      }),
      playing,
    );
    spinner.hidden = !(playing && stage.isStalled);

    // Questions and quizzes take input directly; the start button would only block them.
    overlay.hidden = started || playing || state.status === 'quiz' || state.status === 'question';
    const startLabel =
      state.time > 0 || state.chapterIndex > 0 || state.seen.some(Boolean)
        ? strings.resume
        : strings.start;
    if (startButton.dataset.label !== startLabel) {
      startButton.dataset.label = startLabel;
      startButton.innerHTML = ICONS.play; // static SVG
      startButton.append(startLabel);
    }

    const waiting = state.status === 'waiting';
    continueButton.hidden = !waiting || !!chapter.quiz;
    renderQuiz(false);
    seek.disabled = !!chapter.quiz;
    const playIcon = playing ? 'pause' : state.status === 'ended' ? 'replay' : 'play';
    if (playButton.dataset.icon !== playIcon) {
      playButton.dataset.icon = playIcon;
      playButton.innerHTML = ICONS[playIcon];
    }
    const playLabel = playing
      ? strings.pause
      : state.status === 'ended'
        ? strings.replay
        : strings.play;
    playButton.setAttribute('aria-label', playLabel);
    playButton.title = playLabel;
    prevButton.disabled = !controller.hasPrevious;
    nextButton.disabled = !controller.hasNext;

    if (ticks.dataset.chapter !== String(state.chapterIndex)) {
      ticks.dataset.chapter = String(state.chapterIndex);
      ticks.replaceChildren(
        ...(chapter.markers ?? []).map((marker) => {
          const tick = h('span', 'ccp-tick', { title: marker.title });
          tick.style.left = `${(Math.min(marker.time, chapter.duration) / chapter.duration) * 100}%`;
          return tick;
        }),
      );
    }
    tocItems.forEach((item, index) => {
      const current = index === state.chapterIndex;
      item.button.setAttribute('aria-current', String(current));
      const label = state.seen[index] ? `✓ ${strings.completed}` : current ? strings.current : '';
      if (item.state.textContent !== label) item.state.textContent = label;
    });

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

  const saveProgress = () => store?.save(encodeProgress(controller.progress, progressLayout));

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
      } else if (event.type === 'answer') {
        saveProgress();
      }
      emit(event);
    }
    if (state.status === 'playing') clock.start(onTick);
    else {
      clock.stop();
      saveProgress();
    }
    update();
    const justSeen = events.some((e) => e.type === 'chapterseen');
    if (state.status === 'waiting' && justSeen) {
      announce(strings.chapterComplete);
      // Keep keyboard users in flow: focus Continue (now visible) if focus
      // was inside the player.
      if (root.contains(doc.activeElement)) continueButton.focus();
    }
    if (state.status === 'ended' && justSeen) announce(strings.courseComplete);
    for (const event of events) {
      if (event.type === 'answer') {
        const entry = [...questionHosts.values()].find(
          (q) => q.clip.question.id === event.questionId,
        );
        if (entry) mountQuestionClip(entry.clip, entry.host, true);
        else renderQuiz(true);
      } else if (event.type === 'question') {
        announce(strings.answerToContinue);
        const host = questionHosts.get(event.clipId)?.host;
        queueMicrotask(() => host?.querySelector<HTMLElement>('input, select, button')?.focus());
      } else if (event.type === 'chapterchange' && course.chapters[event.chapterIndex]!.quiz) {
        quizShown = null;
        renderQuiz(true);
      }
    }
    if (events.some((e) => e.type === 'chapterseen') && course.chapters[state.chapterIndex]!.quiz) {
      renderQuiz(true);
    }
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
  tocButton.addEventListener('click', () => setToc(toc.hidden !== false));
  tocClose.addEventListener('click', () => setToc(false));
  toc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setToc(false);
    }
  });

  function setToc(open: boolean) {
    toc.hidden = !open;
    tocButton.setAttribute('aria-expanded', String(open));
    if (open) {
      const current = tocItems[controller.state.chapterIndex]?.button ?? tocClose;
      current.focus();
    } else if (root.contains(doc.activeElement) || doc.activeElement === doc.body) {
      tocButton.focus();
    }
  }

  function jumpTo(chapterIndex: number, time: number) {
    controller.goToChapter(chapterIndex, time);
    setToc(false);
  }

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
      case 't':
      case 'T':
        if (hasToc) setToc(toc.hidden !== false);
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
    answer: (questionId, response) => controller.answer(questionId, response),
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
