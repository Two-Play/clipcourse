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
      'add_marker',
      'add_track',
      'create_project',
      'delete_chapter',
      'delete_clips',
      'delete_marker',
      'delete_media',
      'delete_track',
      'duplicate_chapter',
      'duplicate_clip',
      'export_scorm',
      'get_course',
      'import_media',
      'list_projects',
      'list_templates',
      'move_chapter',
      'move_clip',
      'redo',
      'review_course',
      'set_course',
      'split_clip',
      'trim_clip',
      'undo',
      'update_chapter',
      'update_clip',
      'update_marker',
      'update_media',
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
