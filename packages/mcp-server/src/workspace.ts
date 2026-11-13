// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The set of projects the server works on. A project is addressed by its
 * folder path; it is opened on first use and kept in memory (with its undo
 * history) for the rest of the session. Every change is saved at once.
 */
import { existsSync, statSync } from 'node:fs';
import {
  createEditorStore,
  executeOperation,
  type ChapterTemplate,
  type EditorStore,
  type Operation,
  type OperationResult,
  type Project,
} from '@clipcourse/editor-core';
import type { Course } from '@clipcourse/format';
import {
  createProjectFolder,
  findProjects,
  isProjectFolder,
  loadProjectFolder,
  saveProjectFolder,
} from './folder.js';
import { displayPath, normalizeRoots, PathError, resolveInRoots } from './paths.js';

/** Something the tools can edit: a folder on disk or (later) a live editor. */
export interface ProjectTarget {
  /** The id the AI uses to address it (folder path or "editor:…"). */
  readonly id: string;
  readonly kind: 'folder' | 'editor';
  course(): Course;
  files(): Map<string, Uint8Array>;
  execute(operation: Operation): Promise<OperationResult>;
}

export class FolderProject implements ProjectTarget {
  readonly kind = 'folder';
  readonly store: EditorStore;
  private readonly fileMap: Map<string, Uint8Array>;
  private readonly written = new Map<string, Uint8Array>();

  constructor(
    readonly id: string,
    readonly dir: string,
    project: Project,
    private readonly templates: () => ChapterTemplate[],
  ) {
    this.store = createEditorStore(project.course);
    this.fileMap = project.files;
    for (const [path, data] of project.files) this.written.set(path, data);
  }

  course() {
    return this.store.getState().course;
  }

  files() {
    return this.fileMap;
  }

  async execute(operation: Operation): Promise<OperationResult> {
    const result = executeOperation(
      { store: this.store, files: this.fileMap, templates: this.templates() },
      operation,
    );
    if (result.changed) this.save();
    return result;
  }

  save() {
    saveProjectFolder(this.dir, { course: this.course(), files: this.fileMap }, this.written);
    this.store.getState().markSaved();
  }
}

export interface WorkspaceOptions {
  roots: string[];
  /** User templates available to add_chapter. */
  templates?: () => ChapterTemplate[];
}

export class Workspace {
  readonly roots: string[];
  private readonly projects = new Map<string, FolderProject>();
  private readonly extraTargets = new Map<string, ProjectTarget>();
  private readonly templates: () => ChapterTemplate[];

  constructor(options: WorkspaceOptions) {
    this.roots = normalizeRoots(options.roots);
    this.templates = options.templates ?? (() => []);
  }

  resolve(path: string): string {
    return resolveInRoots(this.roots, path);
  }

  display(path: string): string {
    return displayPath(this.roots, path);
  }

  /** Project folders below the roots. */
  list(): { project: string; title: string; chapters: number; open: boolean }[] {
    const result = [];
    for (const root of this.roots) {
      for (const dir of findProjects(root)) {
        const open = this.projects.get(dir);
        let title: string;
        let chapters = 0;
        try {
          const course = open ? open.course() : loadProjectFolder(dir).course;
          title = course.title;
          chapters = course.chapters.length;
        } catch {
          title = '(invalid project)';
        }
        result.push({ project: this.display(dir), title, chapters, open: !!open });
      }
    }
    return result;
  }

  /** Opens (or returns the already open) project at `path`. */
  open(path: string): ProjectTarget {
    const extra = this.extraTargets.get(path);
    if (extra) return extra;
    const dir = this.resolve(path);
    const existing = this.projects.get(dir);
    if (existing) return existing;
    if (!existsSync(dir) || !statSync(dir).isDirectory() || !isProjectFolder(dir)) {
      throw new PathError(`No Clipcourse project at ${path}. Use list_projects or create_project.`);
    }
    const project = new FolderProject(
      this.display(dir),
      dir,
      loadProjectFolder(dir),
      this.templates,
    );
    this.projects.set(dir, project);
    return project;
  }

  create(
    path: string,
    options: { title?: string; language?: string; width?: number; height?: number },
  ): ProjectTarget {
    const dir = this.resolve(path);
    const project = new FolderProject(
      this.display(dir),
      dir,
      createProjectFolder(dir, options),
      this.templates,
    );
    this.projects.set(dir, project);
    return project;
  }

  /** Registers a non-folder target, e.g. a connected editor (step 3). */
  addTarget(target: ProjectTarget) {
    this.extraTargets.set(target.id, target);
  }

  removeTarget(id: string) {
    this.extraTargets.delete(id);
  }

  targets(): ProjectTarget[] {
    return [...this.extraTargets.values()];
  }
}
