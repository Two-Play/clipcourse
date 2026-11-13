// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The editor's own right-click menu. Opened with the mouse (right click) or
 * the keyboard (context menu key, Shift+F10); arrows, Home/End and the
 * first letter move between items, Enter runs one, Escape closes and
 * returns focus. Rendered into body with fixed positioning and kept inside
 * the window, so it never causes scrollbars.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n.js';

export interface ContextItem {
  label: string;
  onSelect: () => void;
  shortcut?: string;
  disabled?: boolean;
  /** Draws a line above the item. */
  separatorBefore?: boolean;
  /** For "danger" styling (delete). */
  danger?: boolean;
}

interface OpenMenu {
  x: number;
  y: number;
  items: ContextItem[];
  label: string;
  /** Focus goes back here when the menu closes without running an item. */
  returnFocus: HTMLElement | null;
}

let current: OpenMenu | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function closeContextMenu() {
  if (!current) return;
  current = null;
  emit();
}

/**
 * Opens a menu for a contextmenu event. Keyboard-opened events (no mouse
 * position) place the menu at the target element. Prevents the browser menu.
 */
export function openContextMenu(
  event: {
    preventDefault(): void;
    stopPropagation(): void;
    clientX: number;
    clientY: number;
    currentTarget: EventTarget;
  },
  label: string,
  items: ContextItem[],
) {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  let { clientX: x, clientY: y } = event;
  if (x === 0 && y === 0) {
    const rect = target.getBoundingClientRect();
    x = rect.left + Math.min(24, rect.width / 2);
    y = rect.top + Math.min(24, rect.height / 2);
  }
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : target;
  current = { x, y, items, label, returnFocus: active };
  emit();
}

export function useContextMenuOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current !== null,
  );
}

const MARGIN = 6;

/** Mount once (in App). */
export function ContextMenuHost() {
  const menu = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) {
      setPosition(null);
      return;
    }
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    const left = Math.max(MARGIN, Math.min(menu.x, window.innerWidth - w - MARGIN));
    // Open upwards when there is no room below.
    const top = menu.y + h + MARGIN > window.innerHeight ? Math.max(MARGIN, menu.y - h) : menu.y;
    setPosition({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const frame = requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus(),
    );
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    const close = () => closeContextMenu();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  if (!menu) return null;

  const escape = () => {
    const back = menu.returnFocus;
    closeContextMenu();
    back?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const all = [
      ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
    ];
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % all.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + all.length) % all.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = all.length - 1;
    else if (e.key === 'Escape' || (e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      e.preventDefault();
      e.stopPropagation();
      escape();
      return;
    } else if (e.key === 'Tab') {
      e.preventDefault();
      escape();
      return;
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      const letter = e.key.toLowerCase();
      const start = index + 1;
      const order = [...all.slice(start), ...all.slice(0, start)];
      const hit = order.find((b) => b.dataset.label?.toLowerCase().startsWith(letter));
      if (hit) next = all.indexOf(hit);
    }
    // Keys in the menu never reach the editor shortcuts.
    e.stopPropagation();
    if (next < 0) return;
    e.preventDefault();
    all[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={menu.label}
      className="popover menu context-menu"
      style={position ? position : { left: menu.x, top: menu.y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="menu-items">
        {menu.items.map((item) => (
          <div
            key={item.label}
            className={`menu-row${item.separatorBefore ? ' has-separator' : ''}`}
          >
            <button
              type="button"
              role="menuitem"
              data-label={item.label}
              className={item.danger ? 'is-danger' : ''}
              disabled={item.disabled}
              aria-disabled={item.disabled}
              aria-keyshortcuts={item.shortcut?.replace(/\+/g, '+')}
              onClick={() => {
                const back = menu.returnFocus;
                closeContextMenu();
                item.onSelect();
                // Keep keyboard users where they were if the item did not move focus.
                if (document.activeElement === document.body) back?.focus();
              }}
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <kbd className="menu-shortcut" aria-hidden>
                  {item.shortcut}
                </kbd>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** For aria-label of the menu, e.g. "Clip menu". */
export const menuLabel = (what: string) => t('contextMenuOf', { what });
