// SPDX-License-Identifier: AGPL-3.0-only
import { THEME_PRESETS } from '@clipcourse/format';
import { describe, expect, test } from 'vitest';
import { COURSE_TEMPLATES } from '../src/course-templates.js';
import { createEmptyCourse } from '../src/document.js';
import { executeOperation } from '../src/operations.js';
import { reviewCourse } from '../src/review.js';
import { createEditorStore } from '../src/store.js';
import { builtInTemplates, instantiateTemplate } from '../src/templates.js';
import { expectValid } from './helpers.js';

const counter = () => {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
};

describe.each(COURSE_TEMPLATES.map((t) => [t.id, t] as const))(
  'course template %s',
  (_id, template) => {
    test.each(THEME_PRESETS.map((p) => [p.id, p.theme] as const))(
      'is valid and readable with the %s theme',
      (_theme, theme) => {
        const course = template.create(counter(), theme);
        expectValid(course);
        const problems = reviewCourse(course).filter(
          (i) => i.severity !== 'info' && i.code !== 'empty-chapter',
        );
        expect(problems).toEqual([]);
      },
    );
  },
);

test('chapter templates are valid in every theme and keep their internal actions', () => {
  for (const preset of THEME_PRESETS) {
    const newId = counter();
    const course = createEmptyCourse(newId, 'T', preset.theme);
    for (const template of builtInTemplates(course)) {
      const { chapter } = instantiateTemplate({ course, files: new Map() }, template, newId);
      course.chapters.push(chapter);
    }
    expectValid(course);
    const lowContrast = reviewCourse(course).filter((i) => i.code === 'low-contrast');
    expect(lowContrast).toEqual([]);
  }
  expect(builtInTemplates(createEmptyCourse()).map((t) => t.name)).toEqual([
    'Blank chapter',
    'Title',
    'Title and bullet points',
    'Text and picture',
    'Quote',
    'Two columns',
    'Reveal the answer',
    'Choice (branching)',
    'Summary',
  ]);
});

test('set_theme applies a preset with an own accent; set_theme_color changes one role', () => {
  const store = createEditorStore(createEmptyCourse());
  const run = (op: Parameters<typeof executeOperation>[1]) =>
    executeOperation({ store, files: new Map() }, op);
  run({ op: 'set_theme', preset: 'warm', accent: '#7a1f5c' });
  const course = () => store.getState().course;
  expect(course().theme).toMatchObject({ preset: 'warm', colors: { accent: '#7a1f5c' } });
  expect(course().stage.background).toBe('theme:background');
  run({ op: 'set_theme_color', role: 'text', color: '#222222' });
  expect(course().theme!.colors.text).toBe('#222222');
  expect(() => run({ op: 'set_theme', preset: 'nope' })).toThrow(/Themes: dark, light/);
  expect(() => run({ op: 'set_theme_color', role: 'text', color: 'theme:muted' })).toThrow();
  expectValid(course());
});
