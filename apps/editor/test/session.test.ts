// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { createEmptyCourse, type ProjectStorage } from '@clipcourse/editor-core';
import { describe, expect, test } from 'vitest';
import { createBrowserStorage } from '../src/platform/browser.js';
import { EditorSession } from '../src/session.js';

const noStorage = {} as ProjectStorage;
const bytes = (s: string) => new TextEncoder().encode(s);

describe('EditorSession', () => {
  test('imports files as undoable assets with unique paths', async () => {
    const session = new EditorSession(createEmptyCourse(), noStorage);
    const result = await session.importFiles(
      [
        { name: 'Photo.PNG', mime: 'image/png', data: bytes('a') },
        { name: 'photo.png', mime: 'image/png', data: bytes('b') },
        { name: 'clip.mp4', mime: 'video/mp4', data: bytes('c') },
        { name: 'virus.exe', mime: 'application/octet-stream', data: bytes('d') },
      ],
      async () => 4200,
    );
    expect(result.errors).toHaveLength(1);
    const assets = session.store.getState().course.assets;
    expect(Object.values(assets).map((a) => a.src)).toEqual([
      'assets/photo.png',
      'assets/photo-2.png',
      'assets/clip.mp4',
    ]);
    expect(assets.clip?.duration).toBe(4200);
    expect([...session.files.keys()]).toHaveLength(3);
    session.store.getState().undo();
    expect(Object.keys(session.store.getState().course.assets)).toHaveLength(2);
  });

  test('newId is unique in the document', () => {
    const session = new EditorSession(createEmptyCourse(), noStorage);
    const ids = new Set(Array.from({ length: 200 }, () => session.newId('clip')));
    expect(ids.size).toBe(200);
  });
});

describe('browser storage drafts', () => {
  test('saves, loads and clears a draft in IndexedDB', async () => {
    const storage = createBrowserStorage({} as Document, indexedDB);
    const course = createEmptyCourse();
    await storage.saveDraft({ course, files: new Map([['assets/a.png', bytes('x')]]) });
    const draft = await storage.loadDraft();
    expect(draft?.course).toEqual(course);
    expect(new TextDecoder().decode(draft?.files.get('assets/a.png'))).toBe('x');
    await storage.clearDraft();
    expect(await storage.loadDraft()).toBeNull();
  });

  test('ignores an invalid stored draft', async () => {
    const storage = createBrowserStorage({} as Document, indexedDB);
    await storage.saveDraft({ course: { broken: true } as never, files: new Map() });
    expect(await storage.loadDraft()).toBeNull();
  });
});
