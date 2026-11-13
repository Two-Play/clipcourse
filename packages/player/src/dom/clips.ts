// SPDX-License-Identifier: MIT
/** Creates DOM elements for clips. Only plain text is ever inserted. */
import type { Asset, Clip, Frame, ImageFit, TextStyle, VisualClip } from '@clipcourse/format';

export type AssetResolver = (asset: Asset, assetId: string) => string;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface ClipView {
  clip: Clip;
  /** Positioned wrapper (visual clips) or the media element (audio). */
  root: HTMLElement;
  media: HTMLMediaElement | null;
}

export function createClipView(
  doc: Document,
  clip: Clip,
  assets: Record<string, Asset>,
  resolve: AssetResolver,
  /** Returns an existing media element with this source to reuse, if any. */
  reuseMedia: (tag: 'video' | 'audio', src: string) => HTMLMediaElement | null = () => null,
): ClipView {
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
      el.textContent = clip.text;
      applyTextStyle(root, el, clip.style);
      root.append(el);
      break;
    }
    case 'box': {
      applyBoxStyle(root, clip.fill, clip.stroke, clip.strokeWidth, clip.radius);
      if (clip.padding !== undefined) root.style.padding = `${clip.padding}px`;
      if (clip.text) {
        const el = doc.createElement('p');
        el.className = 'ccp-text';
        el.textContent = clip.text;
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
