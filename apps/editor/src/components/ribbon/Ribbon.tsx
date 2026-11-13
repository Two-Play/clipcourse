// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Office-style ribbon: tabs with named groups of large and small buttons.
 * Accessible: tabs are a WAI-ARIA tablist (arrow keys, Home/End), groups
 * are labelled, every button has a visible label or an aria-label.
 */
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { MenuPopover, type MenuItem } from '../Popover.js';
import { t } from '../../i18n.js';

export interface RibbonTab {
  id: string;
  label: string;
  /** Contextual tabs (for the selection) are highlighted. */
  contextual?: boolean;
  content: ReactNode;
}

export function Ribbon({
  tabs,
  active,
  onActivate,
  collapsed,
  onToggleCollapsed,
}: {
  tabs: RibbonTab[];
  active: string;
  onActivate: (id: string) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]!;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === current.id);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const tab = tabs[next]!;
    onActivate(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  return (
    <div className={`ribbon${collapsed ? ' is-collapsed' : ''}`}>
      <div className="ribbon-tabs" role="tablist" aria-label={t('ribbon')} onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === current.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.id, el);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              className={`ribbon-tab${tab.contextual ? ' is-contextual' : ''}`}
              onClick={() => {
                if (collapsed) onToggleCollapsed();
                onActivate(tab.id);
              }}
            >
              {tab.label}
            </button>
          );
        })}
        <button
          type="button"
          className="ribbon-collapse"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t('ribbonExpand') : t('ribbonCollapse')}
          title={collapsed ? t('ribbonExpand') : t('ribbonCollapse')}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
        </button>
      </div>
      {!collapsed && (
        <div
          className={`ribbon-panel${current.contextual ? ' is-contextual' : ''}`}
          role="tabpanel"
          id={`${baseId}-panel`}
          aria-labelledby={`${baseId}-tab-${current.id}`}
        >
          {current.content}
        </div>
      )}
    </div>
  );
}

export function RibbonGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ribbon-group" role="group" aria-label={label}>
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label" aria-hidden="true">
        {label}
      </div>
    </div>
  );
}

/** A column of small buttons inside a group. */
export function RibbonStack({ children }: { children: ReactNode }) {
  return <div className="ribbon-stack">{children}</div>;
}

interface ButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  size?: 'large' | 'small' | 'icon';
  disabled?: boolean;
  /** Toggle buttons show their state. */
  pressed?: boolean;
  /** Tooltip, e.g. with the keyboard shortcut. */
  hint?: string;
  primary?: boolean;
}

export function RibbonButton({
  icon: Icon,
  label,
  onClick,
  size = 'large',
  disabled,
  pressed,
  hint,
  primary,
}: ButtonProps) {
  const iconOnly = size === 'icon';
  return (
    <button
      type="button"
      className={`ribbon-button is-${size}${primary ? ' is-primary' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={iconOnly ? label : undefined}
      title={hint ?? label}
    >
      <Icon
        size={size === 'large' ? 24 : 16}
        strokeWidth={size === 'large' ? 1.6 : 2}
        aria-hidden
      />
      {!iconOnly && <span className="ribbon-button-label">{label}</span>}
    </button>
  );
}

/** A button that opens a menu of choices (rendered as a floating popover). */
export function RibbonMenu({
  icon: Icon,
  label,
  items,
  size = 'large',
}: {
  icon: LucideIcon;
  label: string;
  size?: 'large' | 'small';
  items: MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`ribbon-button is-${size} has-menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        title={label}
      >
        <Icon
          size={size === 'large' ? 24 : 16}
          strokeWidth={size === 'large' ? 1.6 : 2}
          aria-hidden
        />
        <span className="ribbon-button-label">
          {label}
          <ChevronDown size={12} aria-hidden />
        </span>
      </button>
      <MenuPopover
        anchor={ref}
        open={open}
        onClose={() => setOpen(false)}
        items={items}
        label={label}
        id={menuId}
      />
    </>
  );
}

/** A small color picker with an icon; the bar below the icon shows the color. */
export function RibbonColor({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const id = useId();
  const hex = /^#[0-9a-f]{6}$/i.test(value)
    ? value
    : /^#[0-9a-f]{3}$/i.test(value)
      ? '#' + [...value.slice(1)].map((c) => c + c).join('')
      : '#000000';
  return (
    <label className="ribbon-color" htmlFor={id} title={label}>
      <Icon size={16} aria-hidden />
      <span className="ribbon-color-bar" style={{ background: hex }} aria-hidden />
      <span className="ribbon-button-label">{label}</span>
      <input
        id={id}
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </label>
  );
}
