// SPDX-License-Identifier: AGPL-3.0-only
/**
 * An editing session: the undoable store, the project's media files and the
 * platform storage. Media files are not part of the undo history; files
 * that no asset references any more are dropped when saving.
 */
import {
  addAsset,
  createEditorStore,
  prepareAsset,
  uniqueIdFactory,
  type EditorStore,
  type Project,
  type ProjectStorage,
} from '@clipcourse/editor-core';
import type { Asset, Course } from '@clipcourse/format';

/** Object URLs for project files, created lazily and revoked on reset. */
export class AssetUrls {
  private urls = new Map<string, { data: Uint8Array; url: string }>();

  constructor(private readonly files: Map<string, Uint8Array>) {}

  get(asset: Asset): string {
    if (/^https?:\/\//.test(asset.src)) return asset.src;
    const data = this.files.get(asset.src);
    if (!data) return '';
    const cached = this.urls.get(asset.src);
    if (cached && cached.data === data) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    const url = URL.createObjectURL(
      new Blob([data as BlobPart], asset.mime ? { type: asset.mime } : {}),
    );
    this.urls.set(asset.src, { data, url });
    return url;
  }

  clear() {
    for (const { url } of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

export interface ImportResult {
  imported: { assetId: string; asset: Asset }[];
  errors: string[];
}

export class EditorSession {
  readonly store: EditorStore;
  readonly files = new Map<string, Uint8Array>();
  readonly urls = new AssetUrls(this.files);
  private filesVersion = 0;
  /** Set by the stage view: true while media is buffering during playback. */
  stageStalled = false;
  private fileListeners = new Set<() => void>();

  constructor(
    course: Course,
    readonly storage: ProjectStorage,
  ) {
    this.store = createEditorStore(course);
  }

  /** A fresh id that is unique in the current document. */
  newId(prefix: string): string {
    return uniqueIdFactory(this.store.getState().course)(prefix);
  }

  get project(): Project {
    return { course: this.store.getState().course, files: this.files };
  }

  load(project: Project) {
    this.urls.clear();
    this.files.clear();
    for (const [path, data] of project.files) this.files.set(path, data);
    this.store.getState().load(project.course);
    this.notifyFiles();
  }

  /** Imports media files as assets (one undo step per file). */
  async importFiles(
    files: { name: string; mime: string; data: Uint8Array }[],
    probeDuration: (data: Uint8Array, mime: string) => Promise<number | null>,
  ): Promise<ImportResult> {
    const result: ImportResult = { imported: [], errors: [] };
    for (const file of files) {
      try {
        const prepared = prepareAsset(this.project, file.name, file.mime || undefined);
        if (prepared.asset.kind === 'video' || prepared.asset.kind === 'audio') {
          const duration = await probeDuration(file.data, prepared.asset.mime ?? file.mime);
          if (duration) prepared.asset.duration = Math.round(duration);
        }
        this.files.set(prepared.path, file.data);
        this.store
          .getState()
          .execute(`Import ${file.name}`, addAsset(prepared.assetId, prepared.asset));
        result.imported.push({ assetId: prepared.assetId, asset: prepared.asset });
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    this.notifyFiles();
    return result;
  }

  resolveAsset = (asset: Asset) => this.urls.get(asset);

  subscribeFiles(listener: () => void) {
    this.fileListeners.add(listener);
    return () => this.fileListeners.delete(listener);
  }

  get fileVersion() {
    return this.filesVersion;
  }

  private notifyFiles() {
    this.filesVersion++;
    for (const l of this.fileListeners) l();
  }
}

/** Reads the duration of a media file in the browser, ms. */
export function probeMediaDuration(data: Uint8Array, mime: string): Promise<number | null> {
  return new Promise((resolve) => {
    const kind = mime.startsWith('audio/') ? 'audio' : 'video';
    const el = document.createElement(kind);
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      el.removeAttribute('src');
      resolve(value);
    };
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration * 1000 : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    el.src = url;
  });
}
