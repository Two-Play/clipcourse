// SPDX-License-Identifier: MIT
/**
 * Renders a {@link SceneState} into the stage element. Elements for the
 * current chapter (and the course layer) are created once and then only
 * shown, hidden and re-stacked, so rendering any time is cheap and stateless.
 */
import type { Asset, Course } from '@clipcourse/format';
import { orderedTracks, type SceneState } from '../core/evaluate.js';
import { cueTextAt, parseVtt, type Cue } from '../core/vtt.js';
import { createClipView, type AssetResolver, type ClipView } from './clips.js';
import { isMediaStalled, syncMedia, type MediaTarget } from './media.js';

export interface StageOptions {
  resolveAsset: AssetResolver;
  /** Loads text assets (captions). Defaults to fetch(). */
  loadText?: (url: string) => Promise<string>;
  onPlayBlocked: (error: unknown) => void;
  onMediaError: (clipId: string) => void;
}

type CaptionEntry = Cue[] | 'loading' | 'error';

export class Stage {
  readonly element: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly captionBox: HTMLElement;
  private readonly course: Course;
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
    this.element.style.width = `${course.stage.width}px`;
    this.element.style.height = `${course.stage.height}px`;
    this.element.style.background = course.stage.background;
    this.layer = doc.createElement('div');
    this.layer.className = 'ccp-layer';
    this.captionBox = doc.createElement('div');
    this.captionBox.className = 'ccp-captions';
    this.captionBox.hidden = true;
    this.element.append(this.layer, this.captionBox);
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
        if (entry) view.root.style.zIndex = String(entry.z);
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
    const keep = new Set<string>();
    const ordered = orderedTracks(this.course, chapter);

    for (const { track, layer } of ordered) {
      for (const clip of track.clips) {
        keep.add(clip.id);
        // Course layer elements survive chapter changes (no flicker, media
        // keeps its buffer).
        if (layer !== 'chapter' && this.views.has(clip.id)) continue;
        const view = createClipView(doc, clip, this.course.assets, this.options.resolveAsset);
        if (view.root.tagName !== 'AUDIO') view.root.style.display = 'none';
        if (view.media) {
          view.media.addEventListener('error', () => this.options.onMediaError(clip.id));
          view.media.addEventListener('canplay', () => this.refresh());
        }
        this.views.get(clip.id)?.root.remove();
        this.views.set(clip.id, view);
        this.layer.append(view.root);
        if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId) {
          this.loadCaptions(clip.captionsAssetId);
        }
      }
    }

    for (const [id, view] of this.views) {
      if (keep.has(id)) continue;
      view.media?.pause();
      view.root.remove();
      this.views.delete(id);
    }

    this.element.style.background = chapter.background ?? this.course.stage.background;
    this.chapterIndex = index;
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
