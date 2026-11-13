// SPDX-License-Identifier: MIT
/** Creates DOM elements for clips. Only plain text is ever inserted. */
import type {
  Asset,
  Clip,
  Frame,
  GlossaryEntry,
  ImageFit,
  TextStyle,
  VisualClip,
} from '@clipcourse/format';
import type { TextPart } from '../core/interactions.js';

export type AssetResolver = (asset: Asset, assetId: string) => string;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ClipView {
  clip: Clip;
  /** Positioned wrapper (visual clips) or the media element (audio). */
  root: HTMLElement;
  media: HTMLMediaElement | null;
}

export interface ClipViewExtras {
  /** Makes buttons and clickable clips work; without it they are static (editor). */
  onAction?: (clip: VisualClip, trigger: HTMLElement) => void;
  /** Marks glossary terms in text. */
  glossary?: ((text: string) => TextPart[]) | null;
  /** Opens a glossary term; without it terms are only underlined. */
  onTerm?: (entry: GlossaryEntry, trigger: HTMLElement) => void;
  /** Read after the label of buttons that open a new window. */
  newWindowHint?: string;
}

/** Accessible name of a clickable clip. */
export function actionLabel(clip: VisualClip, assets: Record<string, Asset>): string {
  if (clip.actionLabel) return clip.actionLabel;
  switch (clip.type) {
    case 'button':
    case 'text':
      return clip.text;
    case 'box':
      return clip.text ?? '';
    case 'image':
      return clip.alt ?? assets[clip.assetId]?.alt ?? '';
    case 'highlight':
      return clip.label ?? '';
    default:
      return '';
  }
}

/** Plain text with glossary terms as buttons (or underlined spans when static). */
function fillText(doc: Document, el: HTMLElement, text: string, extras: ClipViewExtras) {
  if (!extras.glossary) {
    el.textContent = text;
    return;
  }
  for (const part of extras.glossary(text)) {
    if (typeof part === 'string') {
      el.append(doc.createTextNode(part));
      continue;
    }
    const term = doc.createElement(extras.onTerm ? 'button' : 'span');
    term.className = 'ccp-term';
    term.textContent = part.text;
    if (term instanceof HTMLButtonElement) {
      term.type = 'button';
      term.setAttribute('aria-haspopup', 'dialog');
      const { entry } = part;
      term.addEventListener('click', (event) => {
        event.stopPropagation();
        extras.onTerm!(entry, term);
      });
    }
    el.append(term);
  }
}

export function createClipView(
  doc: Document,
  clip: Clip,
  assets: Record<string, Asset>,
  resolve: AssetResolver,
  /** Returns an existing media element with this source to reuse, if any. */
  reuseMedia: (tag: 'video' | 'audio', src: string) => HTMLMediaElement | null = () => null,
  extras: ClipViewExtras = {},
): ClipView {
  // Text inside a clickable clip is part of its button: no nested term buttons.
  const textExtras: ClipViewExtras =
    clip.type !== 'audio' && clip.action ? { ...extras, glossary: null } : extras;
  const mediaElement = (tag: 'video' | 'audio', assetId: string) => {
    const asset = assets[assetId];
    const src = asset ? resolve(asset, assetId) : '';
    const reused = src ? reuseMedia(tag, src) : null;
    if (reused) return reused;
    const el = doc.createElement(tag);
    el.preload = 'auto';
    if (src) el.src = src;
    return el;
  };
  if (clip.type === 'audio') {
    const audio = mediaElement('audio', clip.assetId);
    audio.className = 'ccp-audio';
    return { clip, root: audio, media: audio };
  }

  const root = doc.createElement('div');
  root.className = `ccp-clip ccp-clip-${clip.type}`;
  root.dataset.clipId = clip.id;
  applyFrame(root, clip.frame);
  if (clip.opacity !== undefined) root.style.opacity = String(clip.opacity);
  let media: HTMLMediaElement | null = null;

  switch (clip.type) {
    case 'image': {
      const img = doc.createElement('img');
      const asset = assets[clip.assetId];
      if (asset) img.src = resolve(asset, clip.assetId);
      img.alt = clip.alt ?? asset?.alt ?? '';
      img.draggable = false;
      img.decoding = 'async';
      img.style.objectFit = objectFit(clip.fit);
      root.append(img);
      break;
    }
    case 'text': {
      const el = doc.createElement(clip.role === 'heading' ? 'h2' : 'p');
      el.className = 'ccp-text';
      fillText(doc, el, clip.text, textExtras);
      applyTextStyle(root, el, clip.style);
      root.append(el);
      break;
    }
    case 'button': {
      const el = doc.createElement(extras.onAction ? 'button' : 'div');
      el.className = 'ccp-button';
      if (el instanceof HTMLButtonElement) el.type = 'button';
      applyBoxStyle(el, clip.fill ?? '#4f8cff', clip.stroke, clip.strokeWidth, clip.radius ?? 16);
      const label = doc.createElement('span');
      label.className = 'ccp-text';
      label.textContent = clip.text;
      applyTextStyle(el, label, {
        align: 'center',
        color: '#ffffff',
        fontWeight: 600,
        ...clip.style,
      });
      el.append(label);
      root.append(el);
      break;
    }
    case 'box': {
      applyBoxStyle(root, clip.fill, clip.stroke, clip.strokeWidth, clip.radius);
      if (clip.padding !== undefined) root.style.padding = `${clip.padding}px`;
      if (clip.text) {
        const el = doc.createElement('p');
        el.className = 'ccp-text';
        fillText(doc, el, clip.text, textExtras);
        applyTextStyle(root, el, clip.style);
        root.append(el);
      } else {
        root.setAttribute('aria-hidden', 'true');
      }
      break;
    }
    case 'shape': {
      root.setAttribute('aria-hidden', 'true');
      if (clip.shape === 'rect' || clip.shape === 'ellipse') {
        applyBoxStyle(root, clip.fill, clip.stroke, clip.strokeWidth, clip.radius);
        if (clip.shape === 'ellipse') root.style.borderRadius = '50%';
      } else {
        root.append(
          createLineSvg(
            doc,
            clip.frame,
            clip.stroke ?? clip.fill ?? '#000',
            clip.strokeWidth ?? 4,
            clip.shape === 'arrow',
          ),
        );
      }
      break;
    }
    case 'question': {
      const host = doc.createElement('div');
      host.className = 'ccp-question-host';
      root.append(host);
      break;
    }
    case 'highlight': {
      root.setAttribute('aria-hidden', clip.label ? 'false' : 'true');
      root.classList.add(`ccp-hl-${clip.kind}`);
      const radius = clip.radius ?? 12;
      if (clip.kind === 'marker') {
        const fill = doc.createElement('div');
        fill.className = 'ccp-hl-fill';
        fill.style.background = clip.color ?? '#ffdd00';
        fill.style.borderRadius = `${radius}px`;
        root.append(fill);
      } else if (clip.kind === 'frame') {
        root.style.border = `${clip.strokeWidth ?? 8}px solid ${clip.color ?? '#ff5d73'}`;
        root.style.borderRadius = `${radius}px`;
      } else if (clip.kind === 'spotlight') {
        root.style.borderRadius = `${radius}px`;
        root.style.boxShadow = `0 0 0 100000px ${clip.color ?? 'rgba(0,0,0,0.65)'}`;
      } else {
        root.append(
          createLineSvg(doc, clip.frame, clip.color ?? '#ff5d73', clip.strokeWidth ?? 8, true),
        );
      }
      if (clip.label) {
        const label = doc.createElement('span');
        label.className = 'ccp-sr';
        label.textContent = clip.label;
        root.append(label);
      }
      break;
    }
    case 'progress': {
      root.setAttribute('role', 'progressbar');
      root.setAttribute('aria-valuemin', '0');
      root.setAttribute('aria-valuemax', '100');
      root.setAttribute('aria-label', 'Course progress');
      root.style.background = clip.background ?? 'rgba(255,255,255,0.25)';
      root.style.borderRadius = `${clip.radius ?? 999}px`;
      const fill = doc.createElement('div');
      fill.className = 'ccp-progress-fill';
      fill.style.background = clip.fill ?? '#4f8cff';
      root.append(fill);
      break;
    }
    case 'video': {
      const video = mediaElement('video', clip.assetId) as HTMLVideoElement;
      video.playsInline = true;
      video.disablePictureInPicture = true;
      video.style.objectFit = objectFit(clip.fit);
      root.append(video);
      media = video;
      break;
    }
  }

  if (clip.action && clip.type !== 'question') {
    root.classList.add('is-clickable');
    const label = actionLabel(clip, assets);
    const hint =
      clip.action.type === 'openUrl' && extras.newWindowHint ? ` (${extras.newWindowHint})` : '';
    if (clip.type === 'button') {
      const el = root.firstElementChild as HTMLElement;
      if (hint) el.setAttribute('aria-label', label + hint);
      if (extras.onAction) el.addEventListener('click', () => extras.onAction!(clip, el));
    } else if (extras.onAction) {
      // A transparent button over the clip carries name, focus and click;
      // the visual content is hidden from screen readers to avoid reading it twice.
      for (const child of [...root.children]) child.setAttribute('aria-hidden', 'true');
      const hit = doc.createElement('button');
      hit.type = 'button';
      hit.className = 'ccp-hit';
      hit.setAttribute('aria-label', (label || clip.action.type) + hint);
      if (clip.action.type === 'openPopup') hit.setAttribute('aria-haspopup', 'dialog');
      hit.addEventListener('click', () => extras.onAction!(clip, hit));
      root.removeAttribute('aria-hidden');
      root.append(hit);
    }
  }

  return { clip, root, media };
}

function objectFit(fit: ImageFit | undefined): string {
  return fit ?? 'contain';
}

function applyFrame(el: HTMLElement, frame: Frame) {
  el.style.left = `${frame.x}px`;
  el.style.top = `${frame.y}px`;
  el.style.width = `${frame.width}px`;
  el.style.height = `${frame.height}px`;
}

function applyBoxStyle(
  el: HTMLElement,
  fill: string | undefined,
  stroke: string | undefined,
  strokeWidth: number | undefined,
  radius: number | undefined,
) {
  if (fill) el.style.background = fill;
  if (stroke) el.style.border = `${strokeWidth ?? 2}px solid ${stroke}`;
  if (radius !== undefined) el.style.borderRadius = `${radius}px`;
}

function applyTextStyle(container: HTMLElement, el: HTMLElement, style: TextStyle | undefined) {
  const s = style ?? {};
  if (s.fontFamily) el.style.fontFamily = s.fontFamily;
  el.style.fontSize = `${s.fontSize ?? 48}px`;
  if (s.fontWeight) el.style.fontWeight = String(s.fontWeight);
  if (s.italic) el.style.fontStyle = 'italic';
  if (s.color) el.style.color = s.color;
  el.style.textAlign = s.align ?? 'left';
  if (s.lineHeight) el.style.lineHeight = String(s.lineHeight);
  container.style.justifyContent =
    s.verticalAlign === 'middle'
      ? 'center'
      : s.verticalAlign === 'bottom'
        ? 'flex-end'
        : 'flex-start';
}

function createLineSvg(doc: Document, frame: Frame, color: string, width: number, arrow: boolean) {
  // Lines run from the frame's left-middle to its right-middle; rotate the
  // frame to point them elsewhere.
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const w = Math.max(frame.width, 1);
  const h = Math.max(frame.height, width, 1);
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.overflow = 'visible';
  const head = arrow ? Math.min(width * 4, w / 2) : 0;
  const line = doc.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', String(h / 2));
  line.setAttribute('x2', String(w - head * 0.8));
  line.setAttribute('y2', String(h / 2));
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(width));
  line.setAttribute('stroke-linecap', arrow ? 'butt' : 'round');
  svg.append(line);
  if (arrow) {
    const tip = doc.createElementNS(SVG_NS, 'polygon');
    tip.setAttribute(
      'points',
      `${w},${h / 2} ${w - head},${h / 2 - head / 2} ${w - head},${h / 2 + head / 2}`,
    );
    tip.setAttribute('fill', color);
    svg.append(tip);
  }
  return svg;
}

export function isVisual(clip: Clip): clip is VisualClip {
  return clip.type !== 'audio';
}
