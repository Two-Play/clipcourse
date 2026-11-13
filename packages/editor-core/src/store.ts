// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Editor state with undo/redo.
 *
 * The document is immutable. Every change runs a recipe through Immer and
 * stores the resulting patches, so undo/redo is cheap even for large
 * courses. Drags use transactions: many previews, one history entry.
 *
 * View state (playhead, selection, zoom) is not part of the history.
 */
import type { Course } from '@clipcourse/format';
import { applyPatches, enablePatches, produce, produceWithPatches, type Patch } from 'immer';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Recipe } from './commands.js';
import { findClip, getChapter } from './document.js';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  selectionBefore: string[];
  selectionAfter: string[];
  /** Consecutive entries with the same key within MERGE_WINDOW are merged. */
  mergeKey?: string;
  time: number;
}

export interface EditorState {
  course: Course;
  /** The chapter shown in the timeline. */
  chapterId: string;
  /** Playhead position in the current chapter, ms. */
  playhead: number;
  /** Selected clip ids. */
  selection: string[];
  /** Timeline zoom in pixels per second. */
  zoom: number;
  snapping: boolean;
  playing: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Increments with every document change (also undo/redo). */
  revision: number;
  /** Revision at the last save. */
  savedRevision: number;
  /** Label of the running transaction, if any. */
  transaction: string | null;
}

export interface ExecuteOptions {
  mergeKey?: string;
  /** Selection after the command. Default: keep (minus deleted clips). */
  select?: string[];
}

export interface EditorActions {
  /** Applies a recipe as one undoable step. Returns false if nothing changed. */
  execute(label: string, recipe: Recipe, options?: ExecuteOptions): boolean;
  undo(): void;
  redo(): void;
  /** Starts a transaction (e.g. a drag). */
  begin(label: string): void;
  /** Replaces the transaction's pending change with `recipe` applied to the start state. */
  preview(recipe: Recipe): void;
  /** Ends the transaction as one history entry. */
  commit(options?: ExecuteOptions): void;
  /** Ends the transaction and restores the start state. */
  cancel(): void;
  /** Replaces the whole document and clears history. */
  load(course: Course, chapterId?: string): void;
  markSaved(): void;
  setChapter(chapterId: string): void;
  setPlayhead(time: number): void;
  select(ids: string[]): void;
  setZoom(pxPerSecond: number): void;
  setSnapping(enabled: boolean): void;
  setPlaying(playing: boolean): void;
}

export type EditorStore = StoreApi<EditorState & EditorActions>;

export const MIN_ZOOM = 5;
export const MAX_ZOOM = 1000;
export const HISTORY_LIMIT = 300;
const MERGE_WINDOW = 1500;

export function createEditorStore(initial: Course, now: () => number = Date.now): EditorStore {
  let transactionBase: Course | null = null;
  let transactionRecipe: Recipe | null = null;
  let transactionSelection: string[] = [];

  return createStore<EditorState & EditorActions>()((set, get) => {
    /** Removes ids that no longer exist and clamps the playhead. */
    const normalizeView = (course: Course, state: Partial<EditorState>) => {
      const chapterId = state.chapterId ?? get().chapterId;
      const chapter = course.chapters.find((c) => c.id === chapterId) ?? course.chapters[0]!;
      const selection = (state.selection ?? get().selection).filter(
        (id) => findClip(course, id) !== null,
      );
      const playhead = Math.min(state.playhead ?? get().playhead, chapter.duration);
      return { chapterId: chapter.id, selection, playhead };
    };

    const pushEntry = (entry: HistoryEntry, course: Course) => {
      const { past, revision } = get();
      const last = past[past.length - 1];
      let nextPast: HistoryEntry[];
      if (
        last &&
        entry.mergeKey &&
        last.mergeKey === entry.mergeKey &&
        entry.time - last.time < MERGE_WINDOW
      ) {
        nextPast = [
          ...past.slice(0, -1),
          {
            ...last,
            patches: [...last.patches, ...entry.patches],
            inversePatches: [...entry.inversePatches, ...last.inversePatches],
            selectionAfter: entry.selectionAfter,
            time: entry.time,
          },
        ];
      } else {
        nextPast = [...past, entry].slice(-HISTORY_LIMIT);
      }
      const view = normalizeView(course, { selection: entry.selectionAfter });
      set({ course, past: nextPast, future: [], revision: revision + 1, ...view });
    };

    return {
      course: initial,
      chapterId: initial.chapters[0]!.id,
      playhead: 0,
      selection: [],
      zoom: 100,
      snapping: true,
      playing: false,
      past: [],
      future: [],
      revision: 0,
      savedRevision: 0,
      transaction: null,

      execute(label, recipe, options = {}) {
        if (get().transaction) throw new Error('Cannot execute during a transaction');
        const before = get().course;
        const [course, patches, inversePatches] = produceWithPatches(before, recipe);
        if (patches.length === 0) {
          if (options.select) set({ selection: options.select });
          return false;
        }
        const selectionBefore = get().selection;
        pushEntry(
          {
            label,
            patches,
            inversePatches,
            selectionBefore,
            selectionAfter: options.select ?? selectionBefore,
            ...(options.mergeKey !== undefined ? { mergeKey: options.mergeKey } : {}),
            time: now(),
          },
          course,
        );
        return true;
      },

      undo() {
        const { past, future, course, revision, transaction } = get();
        if (transaction) return;
        const entry = past[past.length - 1];
        if (!entry) return;
        const restored = applyPatches(course, entry.inversePatches);
        set({
          course: restored,
          past: past.slice(0, -1),
          future: [entry, ...future],
          revision: revision + 1,
          ...normalizeView(restored, { selection: entry.selectionBefore }),
        });
      },

      redo() {
        const { past, future, course, revision, transaction } = get();
        if (transaction) return;
        const entry = future[0];
        if (!entry) return;
        const restored = applyPatches(course, entry.patches);
        set({
          course: restored,
          past: [...past, entry],
          future: future.slice(1),
          revision: revision + 1,
          ...normalizeView(restored, { selection: entry.selectionAfter }),
        });
      },

      begin(label) {
        if (get().transaction) get().cancel();
        transactionBase = get().course;
        transactionRecipe = null;
        transactionSelection = get().selection;
        set({ transaction: label });
      },

      preview(recipe) {
        if (!transactionBase) throw new Error('No transaction');
        transactionRecipe = recipe;
        set({ course: produce(transactionBase, recipe) });
      },

      commit(options = {}) {
        const label = get().transaction;
        if (!label || !transactionBase) return;
        const base = transactionBase;
        const recipe = transactionRecipe;
        transactionBase = null;
        transactionRecipe = null;
        set({ transaction: null });
        if (!recipe) {
          set({ course: base });
          return;
        }
        const [course, patches, inversePatches] = produceWithPatches(base, recipe);
        if (patches.length === 0) {
          set({ course: base });
          return;
        }
        pushEntry(
          {
            label,
            patches,
            inversePatches,
            selectionBefore: transactionSelection,
            selectionAfter: options.select ?? get().selection,
            time: now(),
          },
          course,
        );
      },

      cancel() {
        if (transactionBase) set({ course: transactionBase });
        transactionBase = null;
        transactionRecipe = null;
        set({ transaction: null });
      },

      load(course, chapterId) {
        transactionBase = null;
        transactionRecipe = null;
        const id =
          chapterId && course.chapters.some((c) => c.id === chapterId)
            ? chapterId
            : course.chapters[0]!.id;
        set({
          course,
          chapterId: id,
          playhead: 0,
          selection: [],
          past: [],
          future: [],
          revision: 0,
          savedRevision: 0,
          transaction: null,
          playing: false,
        });
      },

      markSaved() {
        set({ savedRevision: get().revision });
      },

      setChapter(chapterId) {
        getChapter(get().course, chapterId);
        set({ chapterId, playhead: 0, selection: [], playing: false });
      },

      setPlayhead(time) {
        const chapter = getChapter(get().course, get().chapterId);
        const t = Math.min(Math.max(Math.round(time), 0), chapter.duration);
        if (t !== get().playhead) set({ playhead: t });
      },

      select(ids) {
        set({ selection: [...new Set(ids)] });
      },

      setZoom(pxPerSecond) {
        set({ zoom: Math.min(Math.max(pxPerSecond, MIN_ZOOM), MAX_ZOOM) });
      },

      setSnapping(enabled) {
        set({ snapping: enabled });
      },

      setPlaying(playing) {
        set({ playing });
      },
    };
  });
}

/** Convenience selectors. */
export const selectChapter = (s: EditorState) => getChapter(s.course, s.chapterId);
export const selectCanUndo = (s: EditorState) => s.past.length > 0 && s.transaction === null;
export const selectCanRedo = (s: EditorState) => s.future.length > 0 && s.transaction === null;
export const selectDirty = (s: EditorState) => s.revision !== s.savedRevision;
