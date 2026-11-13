// SPDX-License-Identifier: MIT
/**
 * Theme to CSS: the stage and the player root carry the theme as CSS
 * variables, and role references ("theme:accent") become var(--cct-accent).
 * Rendering stays a pure function of the course; a new theme only changes
 * the variables.
 */
import { isThemeRef, THEME_ROLES, type Theme } from '@clipcourse/format';

/** CSS value for a clip color: a role becomes its variable, other colors pass through. */
export function cssColor(value: string): string;
export function cssColor(value: string | undefined): string | undefined;
export function cssColor(value: string | undefined): string | undefined {
  return isThemeRef(value) ? `var(--cct-${value.slice(6)})` : value;
}

export function themeVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const role of THEME_ROLES) vars[`--cct-${role}`] = theme.colors[role];
  vars['--cct-heading'] = theme.headingFont;
  vars['--cct-body'] = theme.bodyFont;
  vars['--cct-radius'] = `${theme.radius}px`;
  vars['--ccp-accent'] = theme.colors.accent;
  return vars;
}

export function applyThemeVariables(el: HTMLElement, theme: Theme, chrome = false): void {
  const vars = themeVariables(theme);
  if (chrome) {
    // The control bar and contents panel follow the theme too.
    vars['--ccp-bar'] = theme.colors.surface;
    vars['--ccp-fg'] = theme.colors.text;
    vars['--ccp-muted'] = theme.colors.muted;
  }
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value);
}
