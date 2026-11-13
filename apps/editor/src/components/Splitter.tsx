// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resizable editor panels. Sizes live in CSS variables on .app and are kept
 * per browser. A splitter is a focusable separator: drag it, or use the
 * arrow keys (Shift: bigger steps), Home/End for min/max; double-click or
 * Enter resets the default.
 */
import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { t } from '../i18n.js';

export type PanelName = 'sidebar' | 'inspector' | 'timeline';
export type PanelSizes = Partial<Record<PanelName, number>>;

const KEY = 'clipcourse:layout';

export const PANEL_LIMITS: Record<PanelName, () => { min: number; max: number }> = {
  sidebar: () => ({ min: 140, max: Math.max(160, Math.min(520, window.innerWidth * 0.4)) }),
  inspector: () => ({ min: 200, max: Math.max(220, Math.min(560, window.innerWidth * 0.45)) }),
  timeline: () => ({ min: 120, max: Math.max(140, window.innerHeight - 280) }),
};

const clampSize = (panel: PanelName, size: number) => {
  const { min, max } = PANEL_LIMITS[panel]();
  return Math.round(Math.min(max, Math.max(min, size)));
};

function load(): PanelSizes {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? '{}') as PanelSizes;
    return typeof value === 'object' && value ? value : {};
  } catch {
    return {};
  }
}

/** Panel sizes (null entries = default CSS size), persisted per browser. */
export function usePanelSizes() {
  const [sizes, setSizes] = useState<PanelSizes>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(sizes));
    } catch {
      // per-browser convenience only
    }
  }, [sizes]);
  const set = useCallback((panel: PanelName, size: number | null) => {
    setSizes((s) => {
      const next = { ...s };
      if (size === null) delete next[panel];
      else next[panel] = clampSize(panel, size);
      return next;
    });
  }, []);
  const reset = useCallback(() => setSizes({}), []);
  const style = Object.fromEntries(
    Object.entries(sizes).map(([panel, size]) => [`--${panel}-size`, `${size}px`]),
  );
  return { sizes, set, reset, style };
}

const LABEL: Record<PanelName, Parameters<typeof t>[0]> = {
  sidebar: 'panelSidebar',
  inspector: 'panelProperties',
  timeline: 'panelTimeline',
};

export function Splitter({
  panel,
  size,
  measure,
  onResize,
}: {
  panel: PanelName;
  size: number | undefined;
  /** Current size in pixels (when no size is stored yet). */
  measure: () => number;
  onResize: (size: number | null) => void;
}) {
  const vertical = panel !== 'timeline';
  const sign = panel === 'sidebar' ? 1 : -1;
  const limits = PANEL_LIMITS[panel]();
  const value = size ?? measure();

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = vertical ? event.clientX : event.clientY;
    const startSize = size ?? measure();
    const el = event.currentTarget;
    el.setPointerCapture(event.pointerId);
    el.classList.add('is-dragging');
    const move = (e: globalThis.PointerEvent) => {
      const delta = (vertical ? e.clientX : e.clientY) - start;
      onResize(startSize + sign * delta);
    };
    const up = () => {
      el.classList.remove('is-dragging');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 50 : 10;
    const grow = vertical ? (panel === 'sidebar' ? 'ArrowRight' : 'ArrowLeft') : 'ArrowUp';
    const shrink = vertical ? (panel === 'sidebar' ? 'ArrowLeft' : 'ArrowRight') : 'ArrowDown';
    let next: number | null | undefined;
    if (event.key === grow) next = value + step;
    else if (event.key === shrink) next = value - step;
    else if (event.key === 'Home') next = limits.min;
    else if (event.key === 'End') next = limits.max;
    else if (event.key === 'Enter') next = null;
    if (next === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    onResize(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-label={t('resizePanel', { panel: t(LABEL[panel]) })}
      aria-valuenow={Math.round(value)}
      aria-valuemin={limits.min}
      aria-valuemax={Math.round(limits.max)}
      className={`splitter splitter-${panel}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onResize(null)}
      title={t('resizePanel', { panel: t(LABEL[panel]) })}
    />
  );
}
