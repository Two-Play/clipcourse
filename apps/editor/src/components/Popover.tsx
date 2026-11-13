// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Floating menus and popups. They are rendered into document.body with
 * fixed positioning, so they never cause scrollbars or get clipped by a
 * scrolling container (ribbon, side panels). Position follows the anchor
 * while anything scrolls or resizes; the popup flips above the anchor when
 * there is no room below and is kept inside the window.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

const MARGIN = 6;

export interface PopoverProps {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: (reason: 'outside' | 'escape') => void;
  children: ReactNode;
  /** Align the popup's left or right edge with the anchor. */
  align?: 'start' | 'end' | undefined;
  className?: string;
  role?: string;
  id?: string;
  label?: string;
}

export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = 'start',
  className,
  role,
  id,
  label,
}: PopoverProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number } | null>(
    null,
  );

  const place = useCallback(() => {
    const anchorEl = anchor.current;
    const popup = popupRef.current;
    if (!anchorEl || !popup) return;
    const a = anchorEl.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.scrollHeight;
    const below = window.innerHeight - a.bottom - MARGIN;
    const above = a.top - MARGIN;
    const placeBelow = height <= below || below >= above;
    const maxHeight = Math.max(80, (placeBelow ? below : above) - MARGIN);
    const top = placeBelow
      ? a.bottom + 2
      : Math.max(MARGIN, a.top - 2 - Math.min(height, maxHeight));
    let left = align === 'end' ? a.right - width : a.left;
    left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
    setPosition({ top, left, maxHeight });
  }, [anchor, align]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose('outside');
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose('escape');
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, onClose, place, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={popupRef}
      id={id}
      role={role}
      aria-label={label}
      className={`popover${className ? ` ${className}` : ''}`}
      style={
        position
          ? { top: position.top, left: position.left, maxHeight: position.maxHeight }
          : { top: 0, left: 0, visibility: 'hidden' }
      }
    >
      {children}
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  selected?: boolean;
  separatorBefore?: boolean;
  /** Optional secondary action shown at the end of the row (e.g. delete). */
  aside?: ReactNode;
}

/** A menu in a popover with keyboard support (arrows, Home/End, Escape returns focus). */
export function MenuPopover({
  anchor,
  open,
  onClose,
  items,
  label,
  id,
  align,
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  items: MenuItem[];
  label: string;
  id?: string;
  align?: 'start' | 'end';
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus the selected (or first) item once the menu is in the DOM.
    const frame = requestAnimationFrame(() => {
      const root = document.getElementById(id ?? '') ?? menuRef.current?.closest('.popover');
      const target =
        root?.querySelector<HTMLButtonElement>('[role="menuitem"].is-selected') ??
        root?.querySelector<HTMLButtonElement>('[role="menuitem"]');
      target?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, id]);

  const close = (reason: 'outside' | 'escape') => {
    onClose();
    if (reason === 'escape') anchor.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const all = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const index = all.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % all.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + all.length) % all.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = all.length - 1;
    else if (event.key === 'Tab') {
      onClose();
      return;
    }
    if (next < 0) return;
    event.preventDefault();
    all[next]?.focus();
  };

  return (
    <Popover
      anchor={anchor}
      open={open}
      onClose={close}
      role="menu"
      label={label}
      align={align}
      className="menu"
      {...(id ? { id } : {})}
    >
      <div ref={menuRef} className="menu-items" onKeyDown={onKeyDown}>
        {items.map((item) => (
          <div
            key={item.label}
            className={`menu-row${item.separatorBefore ? ' has-separator' : ''}`}
          >
            <button
              type="button"
              role="menuitem"
              className={item.selected ? 'is-selected' : ''}
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
            {item.aside}
          </div>
        ))}
      </div>
    </Popover>
  );
}
