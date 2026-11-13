// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import { validateCourse, parseCourse, migrateCourse } from '../src/validation.js';
import { migrateWith } from '../src/migrate.js';

function minimalCourse(): Record<string, unknown> {
  return {
    formatVersion: 1,
    id: 'course_1',
    title: 'Test',
    language: 'en',
    stage: { width: 1920, height: 1080, background: '#000' },
    assets: {
      img: { kind: 'image', src: 'assets/a.png', alt: 'A' },
      vid: { kind: 'video', src: 'assets/v.mp4' },
      cc: { kind: 'captions', src: 'assets/v.vtt' },
    },
    chapters: [
      {
        id: 'ch1',
        title: 'One',
        duration: 5000,
        transition: { mode: 'wait' },
        tracks: [
          {
            id: 't1',
            clips: [
              {
                id: 'c1',
                type: 'image',
                assetId: 'img',
                start: 0,
                duration: 2000,
                frame: { x: 0, y: 0, width: 100, height: 100 },
              },
              {
                id: 'c2',
                type: 'video',
                assetId: 'vid',
                captionsAssetId: 'cc',
                start: 2000,
                duration: 3000,
                frame: { x: 0, y: 0, width: 100, height: 100 },
              },
            ],
          },
        ],
      },
    ],
  };
}

type AnyObj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('validateCourse', () => {
  test('accepts a minimal valid course', () => {
    const result = validateCourse(minimalCourse());
    expect(result.ok).toBe(true);
  });

  test('rejects unknown properties', () => {
    const doc = minimalCourse() as AnyObj;
    doc.stage.foo = 1;
    expect(validateCourse(doc).ok).toBe(false);
  });

  test('rejects non-integer times', () => {
    const doc = minimalCourse() as AnyObj;
    doc.chapters[0].tracks[0].clips[0].start = 1.5;
    const result = validateCourse(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.path).toBe('/chapters/0/tracks/0/clips/0/start');
  });

  test('rejects duplicate ids and unknown assets', () => {
    const doc = minimalCourse() as AnyObj;
    doc.chapters[0].tracks[0].clips[1].id = 'c1';
    doc.chapters[0].tracks[0].clips[0].assetId = 'missing';
    const result = validateCourse(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.issues.map((i) => i.message);
      expect(messages).toContain('Duplicate clip id "c1"');
      expect(messages).toContain('Unknown asset "missing"');
    }
  });

  test('rejects asset kind mismatch', () => {
    const doc = minimalCourse() as AnyObj;
    doc.chapters[0].tracks[0].clips[0].assetId = 'vid';
    expect(validateCourse(doc).ok).toBe(false);
  });

  test.each([
    ['url(https://evil)', false],
    ['red; background: url(x)', false],
    ['#ff00aa', true],
    ['rgba(0, 0, 0, 0.5)', true],
    ['transparent', true],
  ])('color %s valid=%s', (color, valid) => {
    const doc = minimalCourse() as AnyObj;
    doc.stage.background = color;
    expect(validateCourse(doc).ok).toBe(valid);
  });

  test.each([
    ['assets/a.png', true],
    ['https://cdn.example.com/a.png', true],
    ['../secret.png', false],
    ['assets/../../x', false],
    ['/etc/passwd', false],
    ['javascript:alert(1)', false],
  ])('asset src %s valid=%s', (src, valid) => {
    const doc = minimalCourse() as AnyObj;
    doc.assets.img.src = src;
    expect(validateCourse(doc).ok).toBe(valid);
  });

  test('warns about external assets and clips past the chapter end', () => {
    const doc = minimalCourse() as AnyObj;
    doc.assets.img.src = 'https://cdn.example.com/a.png';
    doc.chapters[0].tracks[0].clips[1].duration = 9000;
    const result = validateCourse(doc);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toHaveLength(2);
  });

  test('parseCourse throws with readable details', () => {
    expect(() => parseCourse({ formatVersion: 1 })).toThrow(/Invalid course/);
  });
});

describe('migrateCourse', () => {
  test('rejects documents without a version', () => {
    const result = validateCourse({ title: 'x' });
    expect(result.ok).toBe(false);
  });

  test('rejects newer versions with a helpful message', () => {
    expect(() => migrateCourse({ formatVersion: 99 })).toThrow(/update Clipcourse/);
  });

  test('does not modify its input', () => {
    const doc = minimalCourse();
    const copy = structuredClone(doc);
    migrateCourse(doc);
    expect(doc).toEqual(copy);
  });

  test('runs migration steps in order', () => {
    const result = migrateWith(
      { formatVersion: 1, a: 1 },
      {
        1: (d) => ({ ...d, formatVersion: 2, b: (d.a as number) + 1 }),
        2: (d) => ({ ...d, formatVersion: 3, c: (d.b as number) + 1 }),
      },
      3,
    );
    expect(result).toEqual({ formatVersion: 3, a: 1, b: 2, c: 3 });
  });
});

test('warns about overlapping clips on one track', () => {
  const doc = minimalCourse() as AnyObj;
  doc.chapters[0].tracks[0].clips[1].start = 1500;
  const result = validateCourse(doc);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.warnings.map((w) => w.message).join()).toMatch(/overlap/);
});

test('migrates version 1 documents to version 2', () => {
  const result = validateCourse(minimalCourse());
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.course.formatVersion).toBe(2);
});

test('validates markers and the new clip types', () => {
  const doc = minimalCourse() as AnyObj;
  doc.chapters[0].markers = [
    { id: 'm1', time: 1000, title: 'Part 1' },
    { id: 'm2', time: 9000, title: 'Late' },
  ];
  doc.chapters[0].tracks.push({
    id: 't2',
    clips: [
      {
        id: 'h',
        type: 'highlight',
        kind: 'spotlight',
        pulse: true,
        start: 0,
        duration: 1000,
        frame: { x: 0, y: 0, width: 10, height: 10 },
        animations: { in: { type: 'slide', direction: 'left', duration: 300, easing: 'ease-out' } },
      },
      {
        id: 'p',
        type: 'progress',
        start: 1000,
        duration: 1000,
        frame: { x: 0, y: 0, width: 10, height: 2 },
      },
    ],
  });
  const result = validateCourse(doc);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.warnings.map((w) => w.message).join()).toMatch(/after the end/);
  doc.chapters[0].tracks[1].clips[0].animations.in.type = 'spin';
  expect(validateCourse(doc).ok).toBe(false);
});
