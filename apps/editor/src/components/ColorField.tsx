// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Color input that offers the course theme's roles first ("Accent",
 * "Text", …) and a custom color below. Role colors follow the theme when it
 * changes; custom colors stay fixed.
 */
import { isThemeRef, resolveColor, THEME_ROLES, themeOf, type ThemeRole } from '@clipcourse/format';
import { useId } from 'react';
import { useEditor } from '../context.js';
import { t, type MessageKey } from '../i18n.js';

export const ROLE_LABEL: Record<ThemeRole, MessageKey> = {
  background: 'roleBackground',
  surface: 'roleSurface',
  text: 'roleText',
  muted: 'roleMuted',
  accent: 'roleAccent',
  onAccent: 'roleOnAccent',
  success: 'roleSuccess',
  error: 'roleError',
};

/** #rgb → #rrggbb; anything else that is not #rrggbb → null. */
export function toHex(value: string | undefined): string | null {
  if (!value) return null;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  if (/^#[0-9a-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map((c) => c + c).join('');
  return null;
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const theme = useEditor((s) => themeOf(s.course));
  const resolved = toHex(resolveColor(value, theme)) ?? '#000000';
  const role = isThemeRef(value) ? value : 'custom';
  return (
    <div className="field color-field">
      <label htmlFor={id}>{label}</label>
      <div className="color-field-row">
        <span className="color-swatch" style={{ background: resolved }} aria-hidden />
        <select
          id={id}
          value={role}
          onChange={(e) => onChange(e.target.value === 'custom' ? resolved : e.target.value)}
        >
          <optgroup label={t('themeColors')}>
            {THEME_ROLES.map((r) => (
              <option key={r} value={`theme:${r}`}>
                {t(ROLE_LABEL[r])}
              </option>
            ))}
          </optgroup>
          <option value="custom">{t('customColor')}</option>
        </select>
        {role === 'custom' && (
          <input
            type="color"
            aria-label={`${label}: ${t('customColor')}`}
            value={resolved}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    </div>
  );
}
