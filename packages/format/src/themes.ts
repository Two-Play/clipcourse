// SPDX-License-Identifier: MIT
/**
 * Design themes. A course has one theme; clip colors can name a theme role
 * ("theme:accent") instead of a fixed color, so switching the theme restyles
 * the whole course. Fonts are system font stacks: nothing to download or
 * license, and SCORM packages stay small.
 */

export const THEME_ROLES = [
  'background',
  'surface',
  'text',
  'muted',
  'accent',
  'onAccent',
  'success',
  'error',
] as const;

export type ThemeRole = (typeof THEME_ROLES)[number];

/** A color value in a clip: a CSS color or a theme role reference. */
export type ThemeColorRef = `theme:${ThemeRole}`;

export interface Theme {
  /** Id of the built-in theme this one started from (for the editor). */
  preset?: string;
  /** Concrete CSS colors per role. */
  colors: Record<ThemeRole, string>;
  /** CSS font-family stacks. */
  headingFont: string;
  bodyFont: string;
  /** Corner radius for boxes and buttons, stage pixels. */
  radius: number;
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const HUMANIST = "Verdana, Geneva, 'DejaVu Sans', sans-serif";

export interface ThemePreset {
  id: string;
  name: string;
  theme: Theme;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: 'dark',
    name: 'Dark',
    theme: {
      preset: 'dark',
      colors: {
        background: '#101522',
        surface: '#1b2233',
        text: '#ffffff',
        muted: '#b8c0d0',
        accent: '#5b95ff',
        onAccent: '#0b0e15',
        success: '#06d6a0',
        error: '#ff8a80',
      },
      headingFont: SANS,
      bodyFont: SANS,
      radius: 16,
    },
  },
  {
    id: 'light',
    name: 'Light',
    theme: {
      preset: 'light',
      colors: {
        background: '#f7f8fa',
        surface: '#ffffff',
        text: '#1a1d23',
        muted: '#4b5563',
        accent: '#1d5fd1',
        onAccent: '#ffffff',
        success: '#157347',
        error: '#b42318',
      },
      headingFont: SANS,
      bodyFont: SANS,
      radius: 12,
    },
  },
  {
    id: 'corporate',
    name: 'Corporate',
    theme: {
      preset: 'corporate',
      colors: {
        background: '#ffffff',
        surface: '#eef3fa',
        text: '#0f2a4a',
        muted: '#3d5573',
        accent: '#0b5cad',
        onAccent: '#ffffff',
        success: '#0f7b4d',
        error: '#b3261e',
      },
      headingFont: SANS,
      bodyFont: SANS,
      radius: 6,
    },
  },
  {
    id: 'nature',
    name: 'Nature',
    theme: {
      preset: 'nature',
      colors: {
        background: '#f3f7f0',
        surface: '#ffffff',
        text: '#1e2d1f',
        muted: '#4a5d4b',
        accent: '#2e7d32',
        onAccent: '#ffffff',
        success: '#2e7d32',
        error: '#b3261e',
      },
      headingFont: SERIF,
      bodyFont: HUMANIST,
      radius: 20,
    },
  },
  {
    id: 'warm',
    name: 'Warm',
    theme: {
      preset: 'warm',
      colors: {
        background: '#fff8f0',
        surface: '#ffffff',
        text: '#3b2416',
        muted: '#6b4f3f',
        accent: '#b4461d',
        onAccent: '#ffffff',
        success: '#2f7d32',
        error: '#a51d24',
      },
      headingFont: SERIF,
      bodyFont: SANS,
      radius: 14,
    },
  },
  {
    id: 'high-contrast',
    name: 'High contrast',
    theme: {
      preset: 'high-contrast',
      colors: {
        background: '#000000',
        surface: '#000000',
        text: '#ffffff',
        muted: '#ffffff',
        accent: '#ffd400',
        onAccent: '#000000',
        success: '#00e676',
        error: '#ff6b6b',
      },
      headingFont: HUMANIST,
      bodyFont: HUMANIST,
      radius: 4,
    },
  },
];

/** The theme of courses that do not set one (matches the look before themes). */
export const DEFAULT_THEME: Theme = THEME_PRESETS[0]!.theme;

export function themePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}

export function themeOf(course: { theme?: Theme }): Theme {
  return course.theme ?? DEFAULT_THEME;
}

export function isThemeRef(value: string | undefined): value is ThemeColorRef {
  return value !== undefined && value.startsWith('theme:');
}

/** Turns a theme role reference into its color; other values pass through. */
export function resolveColor<T extends string | undefined>(value: T, theme: Theme): T | string {
  if (!isThemeRef(value)) return value;
  return theme.colors[value.slice(6) as ThemeRole] ?? value;
}
