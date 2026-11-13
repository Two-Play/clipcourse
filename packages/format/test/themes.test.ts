// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import { DEFAULT_THEME, resolveColor, THEME_PRESETS, themeOf, type Theme } from '../src/index.js';
import { validateCourse } from '../src/validation.js';

/** WCAG 2.x relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(THEME_PRESETS.map((p) => [p.id, p.theme] as [string, Theme]))(
  'theme %s',
  (_id, theme) => {
    const c = theme.colors;
    test('text is readable (4.5:1) on background and surface', () => {
      for (const bg of [c.background, c.surface]) {
        expect(contrast(c.text, bg)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.muted, bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
    test('accent text is readable on accent (4.5:1); accent, success and error stand out (3:1)', () => {
      expect(contrast(c.onAccent, c.accent)).toBeGreaterThanOrEqual(4.5);
      for (const color of [c.accent, c.success, c.error]) {
        expect(contrast(color, c.background)).toBeGreaterThanOrEqual(3);
        expect(contrast(color, c.surface)).toBeGreaterThanOrEqual(3);
      }
    });
  },
);

test('roles resolve against the course theme, other colors pass through', () => {
  const light = THEME_PRESETS.find((p) => p.id === 'light')!.theme;
  expect(resolveColor('theme:accent', light)).toBe(light.colors.accent);
  expect(resolveColor('#123456', light)).toBe('#123456');
  expect(resolveColor(undefined, light)).toBeUndefined();
  expect(themeOf({})).toBe(DEFAULT_THEME);
});

test('a course with a theme and role colors is valid; the theme itself needs real colors', () => {
  const doc = {
    formatVersion: 5,
    id: 'c',
    title: 'T',
    language: 'en',
    stage: { width: 100, height: 100, background: 'theme:background' },
    assets: {},
    theme: structuredClone(THEME_PRESETS[1]!.theme),
    chapters: [
      {
        id: 'a',
        title: 'A',
        duration: 1000,
        transition: { mode: 'wait' },
        tracks: [
          {
            id: 't',
            clips: [
              {
                id: 'b',
                type: 'box',
                start: 0,
                duration: 1000,
                frame: { x: 0, y: 0, width: 1, height: 1 },
                fill: 'theme:surface',
                style: { color: 'theme:text' },
              },
            ],
          },
        ],
      },
    ],
  };
  expect(validateCourse(doc).ok).toBe(true);
  (doc.theme.colors as Record<string, string>).accent = 'theme:text';
  expect(validateCourse(doc).ok).toBe(false);
  doc.theme.colors.accent = '#000';
  (doc.chapters[0]!.tracks[0]!.clips[0] as Record<string, unknown>).fill = 'theme:nope';
  expect(validateCourse(doc).ok).toBe(false);
});
