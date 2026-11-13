// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Browser implementation of ProjectStorage: projects are opened and saved
 * as .zip files, the working copy lives in IndexedDB. The Tauri build will
 * provide its own implementation with real folders (M5).
 */
import {
  exportProjectZip,
  importProjectZip,
  type PickedFile,
  type Project,
  type ProjectStorage,
} from '@clipcourse/editor-core';
import type { Course } from '@clipcourse/format';
import { validateCourse } from '@clipcourse/format/validation';

const DB_NAME = 'clipcourse-editor';
const DB_STORE = 'drafts';
const DRAFT_KEY = 'current';

interface StoredDraft {
  course: Course;
  files: [string, Uint8Array][];
  savedAt: number;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, mode);
    const request = run(transaction.objectStore(DB_STORE));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Opens a native file picker. Resolves with [] if the user cancels. */
function pickWithInput(doc: Document, accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      resolve([...(input.files ?? [])]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    doc.body.append(input);
    input.click();
  });
}

export function downloadBytes(doc: Document, data: Uint8Array, fileName: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = fileName;
  a.style.display = 'none';
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function createBrowserStorage(
  doc: Document = document,
  idb: IDBFactory | undefined = globalThis.indexedDB,
): ProjectStorage {
  let dbPromise: Promise<IDBDatabase> | null = null;
  const db = () => {
    if (!idb) return Promise.reject(new Error('IndexedDB is not available'));
    dbPromise ??= openDb(idb);
    return dbPromise;
  };

  return {
    platform: 'browser',

    async openProject() {
      const [file] = await pickWithInput(doc, '.zip,application/zip', false);
      if (!file) return null;
      return importProjectZip(new Uint8Array(await file.arrayBuffer()));
    },

    async saveProject(project, suggestedName) {
      downloadBytes(doc, exportProjectZip(project), `${suggestedName}.zip`, 'application/zip');
    },

    async pickFiles(accept) {
      const files = await pickWithInput(doc, accept, true);
      return Promise.all(
        files.map(async (f): Promise<PickedFile> => ({
          name: f.name,
          mime: f.type,
          data: new Uint8Array(await f.arrayBuffer()),
        })),
      );
    },

    async loadDraft() {
      try {
        const stored = await tx<StoredDraft | undefined>(await db(), 'readonly', (s) =>
          s.get(DRAFT_KEY),
        );
        if (!stored) return null;
        const result = validateCourse(stored.course);
        if (!result.ok) return null;
        return { course: result.course, files: new Map(stored.files) };
      } catch {
        return null;
      }
    },

    async saveDraft(project: Project) {
      const draft: StoredDraft = {
        course: project.course,
        files: [...project.files],
        savedAt: Date.now(),
      };
      await tx(await db(), 'readwrite', (s) => s.put(draft, DRAFT_KEY));
    },

    async clearDraft() {
      await tx(await db(), 'readwrite', (s) => s.delete(DRAFT_KEY));
    },
  };
}
