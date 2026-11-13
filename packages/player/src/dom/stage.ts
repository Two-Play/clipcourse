// SPDX-License-Identifier: MIT
/**
 * Renders a {@link SceneState} into the stage element. Elements for the
 * current chapter (and the course layer) are created once and then only
 * shown, hidden and re-stacked, so rendering any time is cheap and stateless.
 */
import type { Asset, Course, QuestionClip } from '@clipcourse/format';
import { defaultStrings, type PlayerStrings } from '../i18n.js';
import { renderQuestion } from './question.js';
import { orderedTracks, type SceneState } from '../core/evaluate.js';
import { cueTextAt, parseVtt, type Cue } from '../core/vtt.js';
import type { AnimationState } from '../core/animation.js';
import { createClipView, type AssetResolver, type ClipView } from './clips.js';
import { isMediaStalled, syncMedia, type MediaTarget } from './media.js';

export interface StageOptions {
  resolveAsset: AssetResolver;
  /** Loads text assets (captions). Defaults to fetch(). */
  loadText?: (url: string) => Promise<string>;
  onPlayBlocked: (error: unknown) => void;
  onMediaError: (clipId: string) => void;
  /**
   * Fills a question clip's host element. Without it, questions render as
   * a static (non-interactive) preview, as in the editor.
   */
  mountQuestion?: (clip: QuestionClip, host: HTMLElement) => void;
  strings?: PlayerStrings;
}

type CaptionEntry = Cue[] | 'loading' | 'error';

export class Stage {
  readonly element: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly captionBox: HTMLElement;
  private course: Course;
  private forceRebuild = false;
  /** Which clip a (possibly reused) media element currently belongs to. */
  private mediaOwner = new WeakMap<HTMLMediaElement, string>();
  private readonly options: StageOptions;
  private views = new Map<string, ClipView>();
  private chapterIndex = -1;
  private captions = new Map<string, CaptionEntry>();
  private captionsEnabled = false;
  private stalled = false;
  private lastScene: SceneState | null = null;
  private lastPlaying = false;

  constructor(doc: Document, course: Course, options: StageOptions) {
    this.course = course;
    this.options = options;
    this.element = doc.createElement('div');
    this.element.className = 'ccp-stage';
    this.applyStageSize();
    this.layer = doc.createElement('div');
    this.layer.className = 'ccp-layer';
    this.captionBox = doc.createElement('div');
    this.captionBox.className = 'ccp-captions';
    this.captionBox.hidden = true;
    this.element.append(this.layer, this.captionBox);
  }

  /**
   * Replaces the course (used by the editor while editing). The current
   * chapter is rebuilt on the next render; media elements with the same
   * source are reused, so videos keep their buffer and do not flicker.
   */
  setCourse(course: Course) {
    if (course === this.course) return;
    this.course = course;
    this.forceRebuild = true;
    this.chapterIndex = -1;
    this.applyStageSize();
  }

  private applyStageSize() {
    const { width, height, background } = this.course.stage;
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
    this.element.style.background = background;
  }

  /** True if an active media element is buffering and time should not advance. */
  get isStalled(): boolean {
    return this.stalled;
  }

  /** True if the given chapter (or the course layer) has captions. */
  hasCaptions(chapterIndex: number): boolean {
    const chapter = this.course.chapters[chapterIndex];
    if (!chapter) return false;
    return orderedTracks(this.course, chapter).some(({ track }) =>
      track.clips.some((c) => (c.type === 'video' || c.type === 'audio') && c.captionsAssetId),
    );
  }

  setCaptionsEnabled(enabled: boolean) {
    this.captionsEnabled = enabled;
    if (this.lastScene) this.renderCaptions(this.lastScene);
  }

  render(scene: SceneState, playing: boolean): void {
    if (scene.chapterIndex !== this.chapterIndex) this.buildChapter(scene.chapterIndex);
    this.lastScene = scene;
    this.lastPlaying = playing;

    const active = new Map(scene.clips.map((a) => [a.clip.id, a]));
    let stalled = false;

    for (const [id, view] of this.views) {
      const entry = active.get(id);
      if (view.root.tagName !== 'AUDIO') {
        view.root.style.display = entry ? '' : 'none';
        if (entry) {
          view.root.style.zIndex = String(entry.z);
          applyAnimation(view, entry.animation);
          if (view.clip.type === 'progress') {
            const percent = Math.round(scene.courseProgress * 1000) / 10;
            const fill = view.root.firstElementChild as HTMLElement | null;
            if (fill) fill.style.width = `${percent}%`;
            view.root.setAttribute('aria-valuenow', String(Math.round(percent)));
          }
        }
      }
      if (view.media) {
        const clip = view.clip as Extract<typeof view.clip, { type: 'video' | 'audio' }>;
        const target: MediaTarget = {
          active: entry !== undefined,
          playing,
          mediaTime: entry?.mediaTime ?? 0,
          muted: (entry?.trackMuted ?? false) || (clip.type === 'video' && clip.muted === true),
          volume: clip.volume ?? 1,
        };
        syncMedia(view.media, target, this.options.onPlayBlocked);
        if (isMediaStalled(view.media, target)) stalled = true;
      }
    }

    this.stalled = stalled;
    this.element.toggleAttribute('data-buffering', stalled);
    this.renderCaptions(scene);
  }

  /** Re-runs the last render, e.g. after captions finished loading. */
  refresh() {
    if (this.lastScene) this.render(this.lastScene, this.lastPlaying);
  }

  /** Pauses all media immediately (e.g. on destroy or page hide). */
  pauseAll() {
    for (const view of this.views.values()) view.media?.pause();
  }

  destroy() {
    for (const view of this.views.values()) {
      if (view.media) {
        view.media.pause();
        view.media.removeAttribute('src');
        view.media.load();
      }
    }
    this.views.clear();
    this.element.remove();
  }

  private buildChapter(index: number) {
    const chapter = this.course.chapters[index];
    if (!chapter) return;
    const doc = this.element.ownerDocument;
    const rebuildAll = this.forceRebuild;
    this.forceRebuild = false;
    const ordered = orderedTracks(this.course, chapter);

    // Course layer elements survive chapter changes (no flicker, media keeps
    // its buffer) unless the whole course changed.
    const old = this.views;
    this.views = new Map();
    const kept = new Set<string>();
    if (!rebuildAll) {
      for (const { track, layer } of ordered) {
        if (layer === 'chapter') continue;
        for (const clip of track.clips) if (old.has(clip.id)) kept.add(clip.id);
      }
    }

    // Media elements of removed views can be reused by new views with the
    // same source.
    const pool = new Map<string, HTMLMediaElement[]>();
    for (const [id, view] of old) {
      if (kept.has(id)) continue;
      view.root.remove();
      if (view.media) {
        const key = `${view.media.tagName}|${view.media.getAttribute('src') ?? ''}`;
        pool.set(key, [...(pool.get(key) ?? []), view.media]);
      }
    }
    const reuse = (tag: string, src: string) =>
      pool.get(`${tag.toUpperCase()}|${src}`)?.pop() ?? null;

    for (const { track } of ordered) {
      for (const clip of track.clips) {
        if (kept.has(clip.id)) {
          this.views.set(clip.id, old.get(clip.id)!);
          continue;
        }
        const view = createClipView(
          doc,
          clip,
          this.course.assets,
          this.options.resolveAsset,
          reuse,
        );
        if (view.root.tagName !== 'AUDIO') view.root.style.display = 'none';
        if (view.media) {
          if (!this.mediaOwner.has(view.media)) {
            const media = view.media;
            media.addEventListener('error', () =>
              this.options.onMediaError(this.mediaOwner.get(media) ?? ''),
            );
            media.addEventListener('canplay', () => this.refresh());
          }
          this.mediaOwner.set(view.media, clip.id);
        }
        if (clip.type === 'question') this.fillQuestion(clip, view.root);
        this.views.set(clip.id, view);
        this.layer.append(view.root);
        if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId) {
          this.loadCaptions(clip.captionsAssetId);
        }
      }
    }

    for (const elements of pool.values()) {
      for (const media of elements) {
        media.pause();
        media.removeAttribute('src');
        media.load();
      }
    }

    this.element.style.background = chapter.background ?? this.course.stage.background;
    this.chapterIndex = index;
  }

  private fillQuestion(clip: QuestionClip, root: HTMLElement) {
    const host = root.querySelector<HTMLElement>('.ccp-question-host');
    if (!host) return;
    if (this.options.mountQuestion) {
      this.options.mountQuestion(clip, host);
      return;
    }
    host.replaceChildren(
      renderQuestion(this.element.ownerDocument, {
        question: clip.question,
        state: undefined,
        strings: this.options.strings ?? defaultStrings,
        assets: this.course.assets,
        imageUrl: this.options.resolveAsset,
        interactive: false,
      }),
    );
  }

  private loadCaptions(assetId: string) {
    if (this.captions.has(assetId)) return;
    const asset: Asset | undefined = this.course.assets[assetId];
    if (!asset) return;
    this.captions.set(assetId, 'loading');
    const load = this.options.loadText ?? defaultLoadText;
    load(this.options.resolveAsset(asset, assetId))
      .then((text) => {
        this.captions.set(assetId, parseVtt(text));
        this.refresh();
      })
      .catch(() => this.captions.set(assetId, 'error'));
  }

  private renderCaptions(scene: SceneState) {
    let text = '';
    if (this.captionsEnabled) {
      const lines: string[] = [];
      for (const active of scene.clips) {
        const clip = active.clip;
        if ((clip.type !== 'video' && clip.type !== 'audio') || !clip.captionsAssetId) continue;
        const cues = this.captions.get(clip.captionsAssetId);
        if (!Array.isArray(cues) || active.mediaTime === null) continue;
        const cue = cueTextAt(cues, active.mediaTime);
        if (cue) lines.push(cue);
      }
      text = lines.join('\n');
    }
    if (this.captionBox.textContent !== text) this.captionBox.textContent = text;
    this.captionBox.hidden = text === '';
  }
}

async function defaultLoadText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** Writes opacity and transform for the animated state (only when changed). */
function applyAnimation(view: ClipView, state: AnimationState) {
  const clip = view.clip;
  if (clip.type === 'audio') return;
  const opacity = (clip.opacity ?? 1) * state.opacity;
  const rotation = clip.frame.rotation ?? 0;
  const parts: string[] = [];
  if (state.x !== 0 || state.y !== 0) parts.push(`translate(${state.x}px, ${state.y}px)`);
  if (rotation) parts.push(`rotate(${rotation}deg)`);
  if (state.scale !== 1) parts.push(`scale(${state.scale})`);
  const transform = parts.join(' ');
  const style = view.root.style;
  const opacityText = opacity === 1 ? '' : String(opacity);
  if (style.opacity !== opacityText) style.opacity = opacityText;
  if (style.transform !== transform) style.transform = transform;
}
