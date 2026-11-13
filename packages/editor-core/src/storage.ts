// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Platform boundary. The editor never calls browser or Tauri file APIs
 * directly; each platform provides a ProjectStorage.
 */
import type { Project } from './project.js';
import type { ChapterTemplate } from './templates.js';

export interface PickedFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface ProjectStorage {
  /** "browser" or "desktop"; used for wording in the UI. */
  readonly platform: 'browser' | 'desktop';
  /** Lets the user pick a project. Resolves to null if cancelled. */
  openProject(): Promise<Project | null>;
  /** Saves the project (download, file dialog or existing location). */
  saveProject(project: Project, suggestedName: string): Promise<void>;
  /** Lets the user pick media files to import. */
  pickFiles(accept: string): Promise<PickedFile[]>;
  /** Crash-safe working copy, restored on the next start. */
  loadDraft(): Promise<Project | null>;
  saveDraft(project: Project): Promise<void>;
  clearDraft(): Promise<void>;
  /** User templates, shared by all projects on this device. */
  listTemplates(): Promise<ChapterTemplate[]>;
  saveTemplate(template: ChapterTemplate): Promise<void>;
  deleteTemplate(id: string): Promise<void>;
}
