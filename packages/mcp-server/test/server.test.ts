// SPDX-License-Identifier: AGPL-3.0-only
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mp4Duration } from '../src/media.js';
import { createServer } from '../src/server.js';
import { Workspace } from '../src/workspace.js';

const examples = fileURLToPath(new URL('../../../examples/welcome/', import.meta.url));

let root: string;
let outside: string;
let client: Client;

async function connect(workspace: Workspace) {
  const server = createServer({ workspace, runtime: () => '/* runtime */' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const c = new Client({ name: 'test', version: '1.0.0' });
  await c.connect(clientTransport);
  return c;
}

type CallResult = { isError?: boolean; content: { type: string; text: string }[] };
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallResult;
  const text = result.content[0]?.text ?? '';
  if (result.isError) throw new Error(text);
  try {
    return JSON.parse(text) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  } catch {
    return { text } as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'cc-mcp-root-'));
  outside = mkdtempSync(join(tmpdir(), 'cc-mcp-outside-'));
  client = await connect(new Workspace({ roots: [root] }));
});

afterEach(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

describe('tools', () => {
  test('lists the expected tools with described inputs', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'add_chapter',
      'add_clip',
      'add_glossary_entry',
      'add_marker',
      'add_popup',
      'add_quiz_question',
      'add_track',
      'create_project',
      'delete_chapter',
      'delete_clips',
      'delete_glossary_entry',
      'delete_marker',
      'delete_media',
      'delete_popup',
      'delete_quiz_question',
      'delete_track',
      'duplicate_chapter',
      'duplicate_clip',
      'export_scorm',
      'get_course',
      'import_media',
      'list_projects',
      'list_templates',
      'list_themes',
      'move_chapter',
      'move_clip',
      'move_quiz_question',
      'redo',
      'review_course',
      'set_assessment',
      'set_completion',
      'set_course',
      'set_quiz',
      'set_stage_size',
      'set_theme',
      'set_theme_color',
      'split_clip',
      'trim_clip',
      'undo',
      'update_chapter',
      'update_clip',
      'update_glossary_entry',
      'update_marker',
      'update_media',
      'update_popup',
      'update_quiz_question',
      'update_track',
    ]);
    const addClip = tools.find((t) => t.name === 'add_clip')!;
    expect(JSON.stringify(addClip.inputSchema)).toContain('stage pixels');
    expect(tools.find((t) => t.name === 'delete_chapter')!.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'review_course')!.annotations?.readOnlyHint).toBe(true);
  });

  test('builds, reviews and exports a course end to end, saving every step', async () => {
    const created = await call('create_project', {
      path: 'safety',
      title: 'Safety basics',
      language: 'de',
    });
    expect(created.project).toBe('safety');
    const chapterId = created.chapterId as string;

    const text = await call('add_clip', {
      project: 'safety',
      type: 'text',
      chapterId,
      start: 0,
      duration: 4000,
      props: {
        text: 'Willkommen',
        role: 'heading',
        style: { fontSize: 96 },
        animations: { in: { type: 'fade', duration: 500 } },
      },
    });
    expect(text.created.clipId).toMatch(/^clip_/);
    await call('add_chapter', {
      project: 'safety',
      title: 'Regeln',
      template: 'Title and bullet points',
    });
    await call('add_marker', { project: 'safety', chapterId, time: 2000, title: 'Teil 2' });

    // Saved to disk after every change.
    const onDisk = JSON.parse(readFileSync(join(root, 'safety', 'course.json'), 'utf8'));
    expect(onDisk.chapters).toHaveLength(2);
    expect(onDisk.chapters[0].markers[0].title).toBe('Teil 2');

    const outline = await call('get_course', { project: 'safety' });
    expect(outline.text).toContain('Chapter 2 "Regeln"');
    expect(outline.text).toContain('text "Willkommen" anim[in:fade]');

    const review = await call('review_course', { project: 'safety' });
    expect(review.summary).toBe('No issues found');

    const exported = await call('export_scorm', { project: 'safety', version: '2004' });
    expect(exported.file).toBe(join('safety', 'exports', 'Safety_basics-scorm2004.zip'));
    const files = unzipSync(readFileSync(join(root, exported.file)));
    expect(strFromU8(files['imsmanifest.xml']!)).toContain('2004 4th Edition');
    expect(strFromU8(files['clipcourse-runtime.js']!)).toBe('/* runtime */');

    const listed = await call('list_projects');
    expect(listed.projects).toEqual([
      { project: 'safety', title: 'Safety basics', chapters: 2, open: true },
    ]);
  });

  test('builds question clips, a quiz chapter and a passing score', async () => {
    const { chapterId } = await call('create_project', { path: 'quiz', title: 'Quiz' });
    await call('add_clip', {
      project: 'quiz',
      type: 'text',
      chapterId,
      start: 0,
      duration: 4000,
      props: { text: 'Fire safety', role: 'heading' },
    });
    const clip = await call('add_clip', {
      project: 'quiz',
      type: 'question',
      chapterId,
      start: 4000,
      props: {
        question: {
          kind: 'multiple',
          prompt: 'Which extinguishers work on electrical fires?',
          choices: [
            { id: 'co2', text: 'CO2' },
            { id: 'water', text: 'Water' },
            { id: 'powder', text: 'Powder' },
          ],
          correct: ['co2', 'powder'],
          attempts: 2,
          feedback: { incorrect: 'Water conducts electricity.' },
        },
      },
    });
    const clipId = clip.created.clipId as string;
    await call('update_clip', { project: 'quiz', clipId, props: { question: { points: 2 } } });

    const quizChapter = (await call('add_chapter', { project: 'quiz', title: 'Final test' }))
      .created.chapterId as string;
    const quiz = await call('set_quiz', { project: 'quiz', chapterId: quizChapter, retries: 1 });
    const sample = quiz.created.questionId as string;
    await call('update_quiz_question', {
      project: 'quiz',
      chapterId: quizChapter,
      questionId: sample,
      props: { kind: 'text', prompt: 'Emergency number in the EU?', answers: ['112'] },
    });
    const order = await call('add_quiz_question', {
      project: 'quiz',
      chapterId: quizChapter,
      question: {
        kind: 'order',
        prompt: 'Put the steps in order',
        items: [
          { id: 'alarm', text: 'Raise the alarm' },
          { id: 'leave', text: 'Leave the building' },
          { id: 'meet', text: 'Go to the meeting point' },
        ],
      },
    });
    await call('move_quiz_question', {
      project: 'quiz',
      chapterId: quizChapter,
      questionId: order.created.questionId,
      index: 0,
    });

    // Without a passing score the review suggests one.
    let review = await call('review_course', { project: 'quiz' });
    expect(review.issues.map((i: { code: string }) => i.code)).toContain('no-passing-score');
    await call('set_assessment', { project: 'quiz', passingScore: 75 });
    review = await call('review_course', { project: 'quiz' });
    expect(review.summary).toBe('No issues found');

    const saved = JSON.parse(readFileSync(join(root, 'quiz', 'course.json'), 'utf8'));
    expect(saved.assessment).toEqual({ passingScore: 75 });
    const savedClip = saved.chapters[0].tracks
      .flatMap((t: { clips: unknown[] }) => t.clips)
      .find((c: { id: string }) => c.id === clipId);
    expect(savedClip.question).toMatchObject({ kind: 'multiple', points: 2, attempts: 2 });
    expect(saved.chapters[1].quiz.retries).toBe(1);
    expect(saved.chapters[1].quiz.questions.map((q: { kind: string }) => q.kind)).toEqual([
      'order',
      'text',
    ]);
    // A kind change replaces the question instead of mixing fields.
    expect(saved.chapters[1].quiz.questions[1]).toEqual({
      id: sample,
      kind: 'text',
      prompt: 'Emergency number in the EU?',
      answers: ['112'],
    });

    const outline = (await call('get_course', { project: 'quiz' })).text as string;
    expect(outline).toContain('passing score 75 %');
    expect(outline).toContain(
      'question: multiple "Which extinguishers work on electrical fires?" (2 pt, attempts 2) ✓co2:"CO2" ·water:"Water" ✓powder:"Powder"',
    );
    expect(outline).toContain('quiz chapter: 2 question(s), 1 retry');
    expect(outline).toContain(
      '2. text "Emergency number in the EU?" (1 pt, attempts 1) accepts "112"',
    );

    // Invalid answers are rejected and nothing changes.
    await expect(
      call('update_quiz_question', {
        project: 'quiz',
        chapterId: quizChapter,
        questionId: sample,
        props: { answers: [] },
      }),
    ).rejects.toThrow();
    await expect(
      call('add_clip', {
        project: 'quiz',
        type: 'question',
        chapterId,
        props: {
          question: {
            kind: 'single',
            prompt: 'X',
            choices: [
              { id: 'a', text: 'A' },
              { id: 'b', text: 'B' },
            ],
            correct: 'zzz',
          },
        },
      }),
    ).rejects.toThrow(/zzz|correct/);

    const exported = await call('export_scorm', { project: 'quiz', version: '2004' });
    const files = unzipSync(readFileSync(join(root, exported.file)));
    expect(strFromU8(files['course.js']!)).toContain('"passingScore":75');
  });

  test('builds a branching course with buttons, a reveal, a popup and a glossary', async () => {
    const { chapterId: intro } = await call('create_project', { path: 'branch', title: 'Branch' });
    const basics = (await call('add_chapter', { project: 'branch', title: 'Basics' })).created
      .chapterId as string;
    const advanced = (await call('add_chapter', { project: 'branch', title: 'Advanced' })).created
      .chapterId as string;
    await call('update_chapter', { project: 'branch', chapterId: basics, optional: true });
    const popup = (
      await call('add_popup', { project: 'branch', title: 'Why two paths?', text: 'Pick yours.' })
    ).created.popupId as string;
    await call('add_glossary_entry', {
      project: 'branch',
      term: 'branch',
      definition: 'One of several ways through the course.',
    });
    await call('add_clip', {
      project: 'branch',
      type: 'text',
      chapterId: intro,
      start: 0,
      duration: 4000,
      props: { text: 'Choose a branch', role: 'heading' },
    });
    for (const [text, target] of [
      ['Basics', basics],
      ['Advanced', advanced],
    ] as const) {
      await call('add_clip', {
        project: 'branch',
        type: 'button',
        chapterId: intro,
        start: 0,
        duration: 4000,
        props: { text, action: { type: 'goToChapter', chapterId: target } },
      });
    }
    const answer = (
      await call('add_clip', {
        project: 'branch',
        type: 'text',
        chapterId: intro,
        start: 0,
        duration: 4000,
        props: { text: 'Both paths end with a summary.', startsHidden: true },
      })
    ).created.clipId as string;
    const reveal = (
      await call('add_clip', {
        project: 'branch',
        type: 'box',
        chapterId: intro,
        start: 0,
        duration: 4000,
        props: {
          text: 'Help',
          action: { type: 'setClipVisibility', clipId: answer, visible: 'toggle', pause: true },
        },
      })
    ).created.clipId as string;
    await call('update_clip', {
      project: 'branch',
      clipId: reveal,
      props: { action: { type: 'openPopup', popupId: popup }, actionLabel: 'Why two paths?' },
    });

    // References are protected and links are restricted.
    await expect(call('delete_popup', { project: 'branch', popupId: popup })).rejects.toThrow(
      /target of "Help"/,
    );
    await expect(call('delete_chapter', { project: 'branch', chapterId: basics })).rejects.toThrow(
      /Chapter "Basics" is the target/,
    );
    await expect(
      call('update_clip', {
        project: 'branch',
        clipId: reveal,
        props: { action: { type: 'openUrl', url: 'javascript:alert(1)' } },
      }),
    ).rejects.toThrow();

    const outline = (await call('get_course', { project: 'branch' })).text as string;
    expect(outline).toContain('Chapter 2 "Basics"');
    expect(outline).toMatch(/Basics" \{[^}]+\}, 10\.0s, at the end: wait for Continue, optional/);
    expect(outline).toContain(`button "Advanced" on click: go to chapter "Advanced" {${advanced}}`);
    expect(outline).toContain('(starts hidden)');
    expect(outline).toContain(`on click: open popup "Why two paths?" {${popup}}`);
    expect(outline).toContain('Glossary:\n  branch: One of several ways through the course.');

    let review = await call('review_course', { project: 'branch' });
    expect(review.issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(['empty-chapter']),
    );
    expect(review.issues.map((i: { code: string }) => i.code)).not.toContain(
      'clickable-without-name',
    );
    await call('update_clip', {
      project: 'branch',
      clipId: reveal,
      props: { actionLabel: null, text: '' },
    });
    review = await call('review_course', { project: 'branch' });
    expect(review.issues.map((i: { code: string }) => i.code)).toContain('clickable-without-name');

    await call('set_completion', { project: 'branch', mode: 'goal' });
    await call('update_chapter', { project: 'branch', chapterId: advanced, goal: true });
    const saved = JSON.parse(readFileSync(join(root, 'branch', 'course.json'), 'utf8'));
    expect(saved.completion).toEqual({ mode: 'goal' });
    expect(saved.chapters[2].goal).toBe(true);
    expect(saved.glossary[0].term).toBe('branch');
  });

  test('creates a course from a template with a theme and switches themes', async () => {
    const themes = (await call('list_themes')) as unknown as { id: string }[];
    expect(themes.map((t) => t.id)).toEqual([
      'dark',
      'light',
      'corporate',
      'nature',
      'warm',
      'high-contrast',
    ]);
    const created = await call('create_project', {
      path: 'safety2',
      template: 'compliance',
      title: 'Fire safety',
    });
    let saved = JSON.parse(readFileSync(join(root, 'safety2', 'course.json'), 'utf8'));
    expect(saved.title).toBe('Fire safety');
    expect(saved.theme.preset).toBe('corporate');
    expect(saved.assessment).toEqual({ passingScore: 80 });
    expect(saved.chapters.map((c: { title: string }) => c.title)).toContain('Case study');
    expect(created.project).toBe('safety2');

    await call('set_theme', { project: 'safety2', preset: 'high-contrast', accent: '#ffcc00' });
    await call('set_theme_color', { project: 'safety2', role: 'text', color: '#f0f0f0' });
    saved = JSON.parse(readFileSync(join(root, 'safety2', 'course.json'), 'utf8'));
    expect(saved.theme).toMatchObject({
      preset: 'high-contrast',
      colors: { accent: '#ffcc00', text: '#f0f0f0' },
    });
    const outline = (await call('get_course', { project: 'safety2' })).text as string;
    expect(outline).toContain('theme high-contrast (accent #ffcc00)');
    const review = await call('review_course', { project: 'safety2' });
    expect(review.issues.map((i: { code: string }) => i.code)).not.toContain('low-contrast');

    await expect(
      call('set_theme_color', { project: 'safety2', role: 'accent', color: 'theme:text' }),
    ).rejects.toThrow();
    await expect(call('create_project', { path: 'x', template: 'nope' })).rejects.toThrow();

    // The stage format can change later; clips scale with it.
    await call('set_stage_size', { project: 'safety2', width: 1080, height: 1920 });
    const portrait = JSON.parse(readFileSync(join(root, 'safety2', 'course.json'), 'utf8'));
    expect(portrait.stage).toMatchObject({ width: 1080, height: 1920 });

    // Small stages scale the template layout.
    await call('create_project', { path: 'small', template: 'micro', width: 960, height: 540 });
    const small = JSON.parse(readFileSync(join(root, 'small', 'course.json'), 'utf8'));
    const frames = small.chapters[0].tracks.flatMap(
      (t: { clips: { frame: { x: number; width: number } }[] }) => t.clips.map((c) => c.frame),
    );
    expect(
      Math.max(...frames.map((f: { x: number; width: number }) => f.x + f.width)),
    ).toBeLessThanOrEqual(960);
  });

  test('undo reverts the last change on disk', async () => {
    await call('create_project', { path: 'p' });
    await call('set_course', { project: 'p', title: 'Changed' });
    expect(JSON.parse(readFileSync(join(root, 'p', 'course.json'), 'utf8')).title).toBe('Changed');
    await call('undo', { project: 'p' });
    expect(JSON.parse(readFileSync(join(root, 'p', 'course.json'), 'utf8')).title).toBe(
      'Untitled course',
    );
  });

  test('imports local media, reads MP4 duration, places it', async () => {
    await call('create_project', { path: 'p' });
    mkdirSync(join(root, 'media'));
    copyFileSync(
      join(examples, 'assets', 'testpattern.mp4'),
      join(root, 'media', 'Test Pattern.mp4'),
    );
    copyFileSync(join(examples, 'assets', 'logo.svg'), join(root, 'media', 'logo.svg'));
    const video = await call('import_media', { project: 'p', path: 'media/Test Pattern.mp4' });
    expect(video).toMatchObject({ assetId: 'test_pattern', duration: 8000 });
    const logo = await call('import_media', { project: 'p', path: 'media/logo.svg', alt: 'Logo' });
    const clip = await call('add_clip', {
      project: 'p',
      type: 'video',
      assetId: video.assetId,
      start: 0,
    });
    const course = await call('get_course', { project: 'p', format: 'json' });
    const placed = course.chapters[0].tracks
      .flatMap((t: { clips: { id: string }[] }) => t.clips)
      .find((c: { id: string }) => c.id === clip.created.clipId);
    expect(placed.duration).toBe(8000);
    expect(course.assets[logo.assetId]).toMatchObject({
      kind: 'image',
      alt: 'Logo',
      src: 'assets/logo.svg',
    });
    expect(existsSync(join(root, 'p', 'assets', 'test-pattern.mp4'))).toBe(true);
  });

  test('reports problems as tool errors the AI can read', async () => {
    await call('create_project', { path: 'p' });
    await expect(
      call('update_clip', { project: 'p', clipId: 'nope', props: { text: 'x' } }),
    ).rejects.toThrow(/Unknown clip "nope"/);
    await expect(call('get_course', { project: 'missing' })).rejects.toThrow(
      /No Clipcourse project at missing/,
    );
    await expect(call('add_chapter', { project: 'p', template: 'nope' })).rejects.toThrow(
      /Available:/,
    );
    await expect(call('create_project', { path: 'p' })).rejects.toThrow(/already a project/);
    await expect(
      call('add_clip', { project: 'p', type: 'box', props: { fill: 'url(x)' } }),
    ).rejects.toThrow(/invalid/);
    await expect(call('import_media', { project: 'p' })).rejects.toThrow(/exactly one/);
  });
});

describe('security', () => {
  test('refuses paths outside the roots', async () => {
    await expect(call('create_project', { path: '../escape' })).rejects.toThrow(
      /outside the allowed folders/,
    );
    await expect(call('create_project', { path: outside })).rejects.toThrow(
      /outside the allowed folders/,
    );
    await call('create_project', { path: 'p' });
    writeFileSync(join(outside, 'secret.png'), 'x');
    await expect(
      call('import_media', { project: 'p', path: join(outside, 'secret.png') }),
    ).rejects.toThrow(/outside/);
    await expect(
      call('export_scorm', { project: 'p', outputPath: join(outside, 'x.zip') }),
    ).rejects.toThrow(/outside/);
  });

  test('symlinks cannot escape a root', async () => {
    await call('create_project', { path: 'p' });
    writeFileSync(join(outside, 'secret.png'), 'x');
    symlinkSync(outside, join(root, 'link'));
    await expect(call('import_media', { project: 'p', path: 'link/secret.png' })).rejects.toThrow(
      /outside/,
    );
  });

  test('a project with asset paths leaving its folder is rejected', async () => {
    await call('create_project', { path: 'p' });
    const file = join(root, 'p', 'course.json');
    const course = JSON.parse(readFileSync(file, 'utf8'));
    course.assets.x = { kind: 'image', src: 'assets/../../../etc/passwd' };
    writeFileSync(file, JSON.stringify(course));
    const fresh = await connect(new Workspace({ roots: [root] }));
    const result = (await fresh.callTool({
      name: 'get_course',
      arguments: { project: 'p' },
    })) as CallResult;
    expect(result.isError).toBe(true);
    await fresh.close();
  });
});

test('serves the format guide and schema as resources', async () => {
  const { resources } = await client.listResources();
  expect(resources.map((r) => r.uri).sort()).toEqual([
    'clipcourse://format/guide',
    'clipcourse://format/schema',
  ]);
  const guide = await client.readResource({ uri: 'clipcourse://format/guide' });
  expect((guide.contents[0] as { text: string }).text).toContain('# Clipcourse course format');
});

test('mp4Duration ignores non-MP4 data', () => {
  expect(mp4Duration(new Uint8Array([1, 2, 3]))).toBeNull();
  expect(mp4Duration(new Uint8Array(readFileSync(join(examples, 'assets', 'chord.m4a'))))).toBe(
    6000,
  );
});

test('import_media by URL records the source and is off without a downloader', async () => {
  const workspace = new Workspace({ roots: [root] });
  const server = createServer({
    workspace,
    runtime: () => '',
    download: async () => ({ fileName: 'cat.png', mime: 'image/png', data: new Uint8Array([1]) }),
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const withDownloads = new Client({ name: 't', version: '1' });
  await withDownloads.connect(a);
  await withDownloads.callTool({ name: 'create_project', arguments: { path: 'web' } });
  const result = (await withDownloads.callTool({
    name: 'import_media',
    arguments: { project: 'web', url: 'https://example.com/cat.png' },
  })) as CallResult;
  expect(JSON.parse(result.content[0]!.text).assetId).toBe('cat');
  const course = JSON.parse(readFileSync(join(root, 'web', 'course.json'), 'utf8'));
  expect(course.extensions['clipcourse.assetSources']).toEqual({
    cat: 'https://example.com/cat.png',
  });
  await withDownloads.close();

  // The default test client has no downloader: the url parameter does not exist.
  const { tools } = await client.listTools();
  expect(JSON.stringify(tools.find((t) => t.name === 'import_media')!.inputSchema)).not.toContain(
    '"url"',
  );
});
