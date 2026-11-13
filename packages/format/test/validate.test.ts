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

test('migrates version 1 documents to the current version', () => {
  const result = validateCourse(minimalCourse());
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.course.formatVersion).toBe(4);
});

describe('questions (v3)', () => {
  const withQuestions = () => {
    const doc = minimalCourse() as AnyObj;
    doc.assessment = { passingScore: 80 };
    doc.chapters[0].tracks.push({
      id: 'tq',
      clips: [
        {
          id: 'qc',
          type: 'question',
          start: 0,
          duration: 2000,
          frame: { x: 0, y: 0, width: 800, height: 600 },
          question: {
            id: 'q1',
            kind: 'single',
            prompt: 'Which?',
            choices: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correct: 'b',
            attempts: 2,
            feedback: { correct: 'Yes', incorrect: 'No' },
          },
        },
      ],
    });
    doc.chapters.push({
      id: 'test',
      title: 'Test',
      duration: 1000,
      transition: { mode: 'wait' },
      tracks: [],
      quiz: {
        shuffle: true,
        retries: 1,
        questions: [
          {
            id: 'q2',
            kind: 'multiple',
            prompt: 'Pick',
            choices: [
              { id: 'x', text: 'X' },
              { id: 'y', text: 'Y' },
            ],
            correct: ['x', 'y'],
          },
          { id: 'q3', kind: 'text', prompt: 'Capital?', answers: ['Bern'] },
          {
            id: 'q4',
            kind: 'order',
            prompt: 'Order',
            items: [
              { id: 'i1', text: '1' },
              { id: 'i2', text: '2' },
            ],
          },
          {
            id: 'q5',
            kind: 'match',
            prompt: 'Match',
            pairs: [
              { id: 'p1', left: 'a', right: 'b' },
              { id: 'p2', left: 'c', right: 'd' },
            ],
          },
          {
            id: 'q6',
            kind: 'hotspot',
            prompt: 'Where?',
            assetId: 'img',
            areas: [{ id: 'h1', label: 'Top', x: 0, y: 0, width: 0.5, height: 0.5 }],
            correct: ['h1'],
          },
        ],
      },
    });
    return doc;
  };

  test('accepts all question kinds, quiz chapters and an assessment', () => {
    const result = validateCourse(withQuestions());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
  });

  test('rejects broken answers and duplicate question ids', () => {
    const doc = withQuestions();
    doc.chapters[0].tracks[1].clips[0].question.correct = 'zzz';
    doc.chapters[1].quiz.questions[1].id = 'q2';
    doc.chapters[1].quiz.questions[4].assetId = 'vid';
    const result = validateCourse(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/unknown choice "zzz"/);
      expect(messages).toMatch(/Duplicate question id "q2"/);
      expect(messages).toMatch(/has kind "video", expected image/);
    }
  });

  test('rejects a single choice question with one option and a passing score above 100', () => {
    const doc = withQuestions();
    doc.chapters[0].tracks[1].clips[0].question.choices.pop();
    expect(validateCourse(doc).ok).toBe(false);
    const doc2 = withQuestions();
    doc2.assessment.passingScore = 120;
    expect(validateCourse(doc2).ok).toBe(false);
  });
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

describe('interactions (v4)', () => {
  const interactive = () => {
    const doc = minimalCourse() as AnyObj;
    doc.formatVersion = 4;
    doc.completion = { mode: 'goal' };
    doc.popups = [{ id: 'info', title: 'More', text: 'Details', assetId: 'img' }];
    doc.glossary = [{ id: 'g1', term: 'SCORM', variants: ['SCORMs'], definition: 'A standard.' }];
    doc.chapters[0].markers = [{ id: 'm1', time: 1000, title: 'Mid' }];
    doc.chapters[0].goal = true;
    doc.chapters.push({
      id: 'ch2',
      title: 'Side branch',
      duration: 1000,
      transition: { mode: 'wait' },
      optional: true,
      tracks: [],
    });
    doc.chapters[0].tracks.push({
      id: 'tb',
      clips: [
        {
          id: 'b1',
          type: 'button',
          text: 'Go',
          start: 0,
          duration: 1000,
          frame: { x: 0, y: 0, width: 300, height: 100 },
          action: { type: 'goToChapter', chapterId: 'ch2' },
        },
        {
          id: 'b2',
          type: 'box',
          start: 1000,
          duration: 1000,
          frame: { x: 0, y: 0, width: 300, height: 100 },
          actionLabel: 'Show details',
          action: { type: 'setClipVisibility', clipId: 'secret', visible: 'show', pause: true },
        },
        {
          id: 'secret',
          type: 'text',
          text: 'Revealed',
          startsHidden: true,
          start: 2000,
          duration: 1000,
          frame: { x: 0, y: 0, width: 300, height: 100 },
          action: { type: 'openPopup', popupId: 'info' },
        },
        {
          id: 'link',
          type: 'button',
          text: 'Web',
          start: 3000,
          duration: 1000,
          frame: { x: 0, y: 0, width: 300, height: 100 },
          action: { type: 'goToMarker', chapterId: 'ch1', markerId: 'm1' },
        },
      ],
    });
    return doc;
  };

  test('a course with buttons, actions, popups, glossary and goals is valid', () => {
    const result = validateCourse(interactive());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.warnings).toEqual([]);
  });

  test('actions must point to existing chapters, markers, popups and clips', () => {
    const cases: [string, (d: AnyObj) => void, RegExp][] = [
      [
        'chapter',
        (d) => (d.chapters[0].tracks[1].clips[0].action.chapterId = 'nope'),
        /unknown chapter/,
      ],
      ['marker', (d) => (d.chapters[0].tracks[1].clips[3].action.markerId = 'nope'), /no marker/],
      ['popup', (d) => (d.chapters[0].tracks[1].clips[2].action.popupId = 'nope'), /unknown popup/],
      ['clip', (d) => (d.chapters[0].tracks[1].clips[1].action.clipId = 'nope'), /unknown clip/],
      ['popup id', (d) => d.popups.push({ ...d.popups[0] }), /Duplicate popup/],
      ['popup image', (d) => (d.popups[0].assetId = 'vid'), /expected image/],
    ];
    for (const [, change, message] of cases) {
      const doc = interactive();
      change(doc);
      const result = validateCourse(doc);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues.map((i) => i.message).join()).toMatch(message);
    }
  });

  test('only http(s) and mailto links; buttons need an action; no action on questions', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      const doc = interactive();
      doc.chapters[0].tracks[1].clips[3].action = { type: 'openUrl', url };
      expect(validateCourse(doc).ok).toBe(false);
    }
    const ok = interactive();
    ok.chapters[0].tracks[1].clips[3].action = { type: 'openUrl', url: 'mailto:help@example.org' };
    expect(validateCourse(ok).ok).toBe(true);
    const noAction = interactive();
    delete noAction.chapters[0].tracks[1].clips[0].action;
    expect(validateCourse(noAction).ok).toBe(false);
  });

  test('warns when the completion rule cannot be met', () => {
    const doc = interactive();
    delete doc.chapters[0].goal;
    let result = validateCourse(doc);
    expect(result.ok && result.warnings.map((w) => w.message).join()).toMatch(
      /no chapter is a goal/,
    );
    doc.completion = { mode: 'required' };
    doc.chapters[0].optional = true;
    result = validateCourse(doc);
    expect(result.ok && result.warnings.map((w) => w.message).join()).toMatch(
      /All chapters are optional/,
    );
  });
});
