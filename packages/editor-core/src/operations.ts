// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Operations: a small, serializable editing API on top of the commands.
 *
 * The MCP server (projects on disk) and the editor's live mode (an AI
 * assistant editing the open project) both execute these. Every operation
 * is one undo step. After each one the course is validated; an operation
 * that would make it invalid is undone and reported as an error, so
 * automated edits can never corrupt a project.
 */
import type {
  Asset,
  Chapter,
  Clip,
  ClipType,
  Course,
  GlossaryEntry,
  Popup,
  Question,
  ThemeRole,
} from '@clipcourse/format';
import { themeOf as themeOfCourse, themePreset, THEME_PRESETS } from '@clipcourse/format';
import { validateCourse } from '@clipcourse/format/validation';
import { current, isDraft } from 'immer';
import * as cmd from './commands.js';
import {
  collectIds,
  COURSE_LAYER_DURATION,
  createClip,
  findClip,
  findTrack,
  getChapter,
  uniqueIdFactory,
  type IdFactory,
} from './document.js';
import { fits } from './placement.js';
import { prepareAsset } from './project.js';
import { createQuestion } from './questions.js';
import type { EditorStore } from './store.js';
import { builtInTemplates, instantiateTemplate, type ChapterTemplate } from './templates.js';

/** Partial clip properties. `null` removes an optional property. */
export type ClipProps = Record<string, unknown>;

export type Operation =
  | { op: 'set_course'; title?: string; language?: string; stageBackground?: string }
  | {
      op: 'add_chapter';
      title?: string;
      index?: number;
      duration?: number;
      transition?: 'wait' | 'auto';
      template?: string;
    }
  | {
      op: 'update_chapter';
      chapterId: string;
      title?: string;
      duration?: number;
      transition?: 'wait' | 'auto';
      background?: string | null;
      optional?: boolean;
      goal?: boolean;
    }
  | { op: 'fit_chapter'; chapterId: string }
  | { op: 'move_chapter'; chapterId: string; index: number }
  | { op: 'duplicate_chapter'; chapterId: string }
  | { op: 'delete_chapter'; chapterId: string }
  | { op: 'add_marker'; chapterId: string; time: number; title: string }
  | { op: 'update_marker'; chapterId: string; markerId: string; time?: number; title?: string }
  | { op: 'delete_marker'; chapterId: string; markerId: string }
  | {
      op: 'add_track';
      chapterId?: string;
      layer?: 'background' | 'foreground';
      name?: string;
      position?: 'front' | 'back';
    }
  | { op: 'update_track'; trackId: string; name?: string; hidden?: boolean; muted?: boolean }
  | { op: 'move_track'; trackId: string; index: number }
  | { op: 'delete_track'; trackId: string }
  | {
      op: 'add_clip';
      type: ClipType;
      chapterId?: string;
      trackId?: string;
      start?: number;
      duration?: number;
      assetId?: string;
      props?: ClipProps;
    }
  | { op: 'update_clip'; clipId: string; props: ClipProps }
  | { op: 'move_clip'; clipId: string; start: number; trackId?: string }
  | { op: 'trim_clip'; clipId: string; edge: 'start' | 'end'; time: number }
  | { op: 'split_clip'; clipId: string; time: number }
  | { op: 'duplicate_clip'; clipId: string }
  | { op: 'delete_clips'; clipIds: string[] }
  | {
      op: 'add_asset';
      fileName: string;
      mime?: string;
      data: Uint8Array;
      alt?: string;
      duration?: number;
      sourceUrl?: string;
    }
  | { op: 'update_asset'; assetId: string; alt?: string | null }
  | { op: 'delete_asset'; assetId: string }
  | { op: 'set_assessment'; passingScore: number | null }
  | { op: 'set_quiz'; chapterId: string; enabled?: boolean; shuffle?: boolean; retries?: number }
  | { op: 'add_quiz_question'; chapterId: string; question: Question; index?: number }
  | {
      op: 'update_quiz_question';
      chapterId: string;
      questionId: string;
      props: Record<string, unknown>;
    }
  | { op: 'delete_quiz_question'; chapterId: string; questionId: string }
  | { op: 'move_quiz_question'; chapterId: string; questionId: string; index: number }
  | { op: 'set_completion'; mode: 'required' | 'goal' }
  | { op: 'add_popup'; title: string; text: string; assetId?: string; alt?: string }
  | {
      op: 'update_popup';
      popupId: string;
      title?: string;
      text?: string;
      assetId?: string | null;
      alt?: string | null;
    }
  | { op: 'delete_popup'; popupId: string }
  | { op: 'add_glossary_entry'; term: string; definition: string; variants?: string[] }
  | {
      op: 'update_glossary_entry';
      entryId: string;
      term?: string;
      definition?: string;
      variants?: string[] | null;
    }
  | { op: 'delete_glossary_entry'; entryId: string }
  | { op: 'set_theme'; preset: string; accent?: string; useBackground?: boolean }
  | { op: 'set_theme_color'; role: ThemeRole; color: string }
  | { op: 'undo' }
  | { op: 'redo' };

export type OperationName = Operation['op'];

export interface OperationContext {
  store: EditorStore;
  /** Project media files; `add_asset` and templates add to it. */
  files: Map<string, Uint8Array>;
  /** User templates available to `add_chapter`. */
  templates?: ChapterTemplate[];
  newId?: IdFactory;
}

export interface OperationResult {
  /** Human-readable summary for the AI and the UI. */
  message: string;
  /** Ids of created objects, e.g. { clipId: "clip_x1" }. */
  created?: Record<string, string>;
  /** False if the operation did not change anything. */
  changed: boolean;
}

export class OperationError extends Error {
  override name = 'OperationError';
}

/** Extension key under which asset source URLs are kept (for licensing). */
export const SOURCES_EXTENSION = 'clipcourse.assetSources';

const FORBIDDEN_PROPS = ['id', 'type'];
const MERGED_PROPS = ['style', 'frame', 'animations', 'question'];

/**
 * Applies a partial property patch to a clip. Objects listed in
 * MERGED_PROPS are merged one level deep; `null` deletes a property.
 */
export function patchClip(clip: Clip, props: ClipProps) {
  const target = clip as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_PROPS.includes(key)) throw new OperationError(`"${key}" cannot be changed`);
    if (key === 'start' || key === 'duration') continue; // handled by move/trim
    if (value === null || value === undefined) {
      delete target[key];
    } else if (
      key === 'question' &&
      typeof value === 'object' &&
      'kind' in (value as object) &&
      (value as { kind: unknown }).kind !==
        (target.question as { kind?: unknown } | undefined)?.kind
    ) {
      // A different kind has different fields: replace instead of merging
      // (keeping the question id unless a new one is given).
      const previousId = (target.question as { id?: string } | undefined)?.id;
      target[key] = { ...(previousId ? { id: previousId } : {}), ...structuredClone(value) };
    } else if (MERGED_PROPS.includes(key) && typeof value === 'object' && !Array.isArray(value)) {
      const base = (target[key] ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...(isDraft(base) ? current(base) : base) };
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      if (Object.keys(merged).length === 0) delete target[key];
      else target[key] = merged;
    } else {
      target[key] = structuredClone(value);
    }
  }
}

function describeIssues(course: Course): string | null {
  const result = validateCourse(course);
  if (result.ok) return null;
  return result.issues
    .slice(0, 5)
    .map((i) => `${i.path}: ${i.message}`)
    .join('; ');
}

function chapterOf(course: Course, chapterId: string | undefined): Chapter {
  if (chapterId) return getChapter(course, chapterId);
  if (course.chapters.length === 1) return course.chapters[0]!;
  throw new OperationError('chapterId is required when the course has more than one chapter');
}

function findTemplate(course: Course, name: string, user: ChapterTemplate[]): ChapterTemplate {
  const all = [...builtInTemplates(course), ...user];
  const wanted = name.trim().toLowerCase();
  const found = all.find((t) => t.name.toLowerCase() === wanted || t.id.toLowerCase() === wanted);
  if (!found) {
    throw new OperationError(
      `Unknown template "${name}". Available: ${all.map((t) => t.name).join(', ')}`,
    );
  }
  return found;
}

/** Runs an operation as one undoable step and validates the result. */
export function executeOperation(ctx: OperationContext, operation: Operation): OperationResult {
  const { store, files } = ctx;
  const state = () => store.getState();
  const newId: IdFactory = ctx.newId ?? ((prefix) => uniqueIdFactory(state().course)(prefix));

  if (operation.op === 'undo' || operation.op === 'redo') {
    const before = state().course;
    if (operation.op === 'undo') state().undo();
    else state().redo();
    const changed = state().course !== before;
    return { changed, message: changed ? `${operation.op} done` : `Nothing to ${operation.op}` };
  }

  const created: Record<string, string> = {};
  let label = operation.op.replace(/_/g, ' ');
  let recipe: cmd.Recipe;
  let message = 'Done';

  try {
    const course = state().course;
    switch (operation.op) {
      case 'set_course': {
        recipe = (d) => {
          cmd.setCourseProps({
            ...(operation.title !== undefined ? { title: operation.title } : {}),
            ...(operation.language !== undefined ? { language: operation.language } : {}),
          })(d);
          if (operation.stageBackground !== undefined)
            d.stage.background = operation.stageBackground;
        };
        message = 'Course updated';
        break;
      }
      case 'add_chapter': {
        const index = operation.index ?? course.chapters.length;
        let chapter: Chapter;
        let assets: Record<string, Asset> = {};
        let popups: Popup[] = [];
        if (operation.template) {
          const template = findTemplate(course, operation.template, ctx.templates ?? []);
          const result = instantiateTemplate({ course, files }, template, newId);
          chapter = result.chapter;
          assets = result.assets;
          popups = result.popups;
          for (const [path, data] of result.files) files.set(path, data);
        } else {
          chapter = {
            id: newId('chapter'),
            title: 'New chapter',
            duration: 10000,
            transition: { mode: 'wait' },
            tracks: [{ id: newId('track'), name: 'Text', clips: [] }],
          };
        }
        if (operation.title) chapter.title = operation.title;
        if (operation.duration) chapter.duration = Math.round(operation.duration);
        if (operation.transition) chapter.transition = { mode: operation.transition };
        recipe = (d) => {
          Object.assign(d.assets, assets);
          for (const popup of popups) cmd.addPopup(popup)(d);
          cmd.addChapter(chapter, index)(d);
        };
        created.chapterId = chapter.id;
        message = `Added chapter "${chapter.title}"`;
        break;
      }
      case 'update_chapter': {
        const { chapterId, title, duration, transition, background, optional, goal } = operation;
        recipe = cmd.setChapterProps(chapterId, {
          ...(title !== undefined ? { title } : {}),
          ...(duration !== undefined ? { duration } : {}),
          ...(transition !== undefined ? { transition: { mode: transition } } : {}),
          ...(background !== undefined ? { background } : {}),
          ...(optional !== undefined ? { optional } : {}),
          ...(goal !== undefined ? { goal } : {}),
        });
        message = 'Chapter updated';
        break;
      }
      case 'fit_chapter':
        recipe = cmd.fitChapterToContent(operation.chapterId);
        message = 'Chapter length set to its content';
        break;
      case 'move_chapter':
        recipe = cmd.moveChapter(operation.chapterId, operation.index);
        message = 'Chapter moved';
        break;
      case 'duplicate_chapter':
        recipe = cmd.duplicateChapter(operation.chapterId, newId, (id) => (created.chapterId = id));
        message = 'Chapter duplicated';
        break;
      case 'delete_chapter':
        recipe = cmd.removeChapter(operation.chapterId);
        message = 'Chapter deleted';
        break;
      case 'add_marker': {
        const id = newId('marker');
        recipe = cmd.addMarker(operation.chapterId, {
          id,
          time: operation.time,
          title: operation.title,
        });
        created.markerId = id;
        message = `Added marker "${operation.title}"`;
        break;
      }
      case 'update_marker':
        recipe = cmd.updateMarker(operation.chapterId, operation.markerId, {
          ...(operation.time !== undefined ? { time: operation.time } : {}),
          ...(operation.title !== undefined ? { title: operation.title } : {}),
        });
        message = 'Marker updated';
        break;
      case 'delete_marker':
        recipe = cmd.removeMarker(operation.chapterId, operation.markerId);
        message = 'Marker deleted';
        break;
      case 'add_track': {
        const id = newId('track');
        const name = operation.name;
        if (operation.layer) {
          const layer = operation.layer;
          const count = course.courseLayer?.[layer].length ?? 0;
          recipe = cmd.addCourseTrack(
            layer,
            { id, ...(name ? { name } : {}) },
            operation.position === 'back' ? 0 : count,
          );
        } else {
          const chapter = chapterOf(course, operation.chapterId);
          recipe = cmd.addTrack(
            chapter.id,
            { id, ...(name ? { name } : {}) },
            operation.position === 'back' ? 0 : undefined,
          );
        }
        created.trackId = id;
        message = 'Track added';
        break;
      }
      case 'update_track':
        recipe = cmd.updateTrack(operation.trackId, {
          ...(operation.name !== undefined ? { name: operation.name } : {}),
          ...(operation.hidden !== undefined ? { hidden: operation.hidden } : {}),
          ...(operation.muted !== undefined ? { muted: operation.muted } : {}),
        });
        message = 'Track updated';
        break;
      case 'move_track':
        recipe = cmd.moveTrack(operation.trackId, operation.index);
        message = 'Track moved';
        break;
      case 'delete_track':
        recipe = (d) => {
          cmd.removeTrack(operation.trackId)(d);
          cmd.pruneCourseLayer()(d);
        };
        message = 'Track deleted';
        break;
      case 'add_clip': {
        const id = newId('clip');
        const asset = operation.assetId ? course.assets[operation.assetId] : undefined;
        if (operation.assetId && !asset)
          throw new OperationError(`Unknown asset "${operation.assetId}"`);
        const start = Math.max(0, Math.round(operation.start ?? 0));
        const clip = createClip(course, operation.type, {
          id,
          start,
          ...(operation.duration !== undefined ? { duration: operation.duration } : {}),
          ...(operation.assetId ? { assetId: operation.assetId } : {}),
          ...(asset ? { asset } : {}),
          ...(operation.chapterId ? { chapterId: operation.chapterId } : {}),
        });
        let trackId = operation.trackId;
        let newTrack: { chapterId: string; name: string } | null = null;
        if (trackId) {
          const location = findTrack(course, trackId);
          if (!location) throw new OperationError(`Unknown track "${trackId}"`);
          if (
            location.scope.kind === 'course' &&
            operation.duration === undefined &&
            !asset?.duration
          ) {
            clip.duration = COURSE_LAYER_DURATION;
          }
        } else {
          const chapter = chapterOf(course, operation.chapterId);
          trackId = [...chapter.tracks].reverse().find((t) => fits(t, start, clip.duration))?.id;
          if (!trackId) {
            trackId = newId('track');
            newTrack = {
              chapterId: chapter.id,
              name: operation.type === 'audio' ? 'Audio' : 'Track',
            };
          }
        }
        const target = trackId;
        recipe = (d) => {
          if (newTrack) cmd.addTrack(newTrack.chapterId, { id: target, name: newTrack.name })(d);
          const placed = structuredClone(clip);
          if (operation.props) patchClip(placed, operation.props);
          cmd.addClip(target, placed)(d);
        };
        created.clipId = id;
        if (newTrack) created.trackId = target;
        message = `Added ${operation.type} clip`;
        break;
      }
      case 'update_clip': {
        const { clipId, props } = operation;
        const location = findClip(course, clipId);
        if (!location) throw new OperationError(`Unknown clip "${clipId}"`);
        recipe = (d) => {
          cmd.updateClip(clipId, (clip) => patchClip(clip, props))(d);
          if (typeof props.start === 'number') cmd.moveClip(clipId, props.start)(d);
          if (typeof props.duration === 'number') {
            const clip = findClip(d, clipId)!.clip;
            cmd.resizeClip(clipId, 'end', clip.start + props.duration)(d);
          }
        };
        message = 'Clip updated';
        break;
      }
      case 'move_clip':
        recipe = cmd.moveClip(operation.clipId, operation.start, operation.trackId);
        message = 'Clip moved';
        break;
      case 'trim_clip':
        recipe = cmd.resizeClip(operation.clipId, operation.edge, operation.time);
        message = 'Clip trimmed';
        break;
      case 'split_clip': {
        const id = newId('clip');
        recipe = cmd.splitClip(operation.clipId, operation.time, id);
        created.clipId = id;
        message = 'Clip split';
        break;
      }
      case 'duplicate_clip': {
        const id = newId('clip');
        recipe = cmd.duplicateClip(operation.clipId, id);
        created.clipId = id;
        message = 'Clip duplicated';
        break;
      }
      case 'delete_clips': {
        const missing = operation.clipIds.filter((id) => !findClip(course, id));
        if (missing.length) throw new OperationError(`Unknown clip(s): ${missing.join(', ')}`);
        recipe = cmd.removeClips(operation.clipIds);
        message = `Deleted ${operation.clipIds.length} clip(s)`;
        break;
      }
      case 'add_asset': {
        const prepared = prepareAsset({ course, files }, operation.fileName, operation.mime, {
          ...(operation.alt !== undefined ? { alt: operation.alt } : {}),
          ...(operation.duration !== undefined ? { duration: operation.duration } : {}),
        });
        files.set(prepared.path, operation.data);
        recipe = (d) => {
          cmd.addAsset(prepared.assetId, prepared.asset)(d);
          if (operation.sourceUrl) {
            const extensions = (d.extensions ??= {});
            const sources = {
              ...((extensions[SOURCES_EXTENSION] as Record<string, string>) ?? {}),
            };
            sources[prepared.assetId] = operation.sourceUrl;
            extensions[SOURCES_EXTENSION] = sources;
          }
        };
        created.assetId = prepared.assetId;
        label = `Import ${operation.fileName}`;
        message = `Imported ${prepared.asset.kind} "${operation.fileName}" as ${prepared.assetId}`;
        break;
      }
      case 'update_asset': {
        const { assetId, alt } = operation;
        if (!course.assets[assetId]) throw new OperationError(`Unknown asset "${assetId}"`);
        recipe = (d) => {
          const asset = d.assets[assetId]!;
          if (alt === null) delete asset.alt;
          else if (alt !== undefined) asset.alt = alt;
        };
        message = 'Asset updated';
        break;
      }
      case 'set_assessment':
        recipe = cmd.setAssessment(operation.passingScore);
        message =
          operation.passingScore === null
            ? 'Assessment removed'
            : `Passing score set to ${operation.passingScore} %`;
        break;
      case 'set_quiz': {
        const { chapterId, enabled, shuffle, retries } = operation;
        const chapter = getChapter(course, chapterId);
        if (enabled === false) {
          recipe = cmd.setQuiz(chapterId, null);
          message = 'Quiz removed from the chapter';
        } else {
          const questions = chapter.quiz
            ? undefined
            : [createQuestion('single', newId('question'))];
          recipe = cmd.setQuiz(chapterId, {
            ...(questions ? { questions } : {}),
            ...(shuffle !== undefined ? { shuffle } : {}),
            ...(retries !== undefined ? { retries } : {}),
          });
          message = chapter.quiz
            ? 'Quiz settings updated'
            : 'Chapter is now a quiz chapter (with one example question)';
          if (questions) created.questionId = questions[0]!.id;
        }
        break;
      }
      case 'add_quiz_question': {
        const question = { ...operation.question, id: operation.question.id || newId('question') };
        if (collectIds(course).has(question.id) || questionIdsOf(course).has(question.id)) {
          question.id = newId('question');
        }
        recipe = cmd.addQuizQuestion(operation.chapterId, question, operation.index);
        created.questionId = question.id;
        message = 'Question added to the quiz';
        break;
      }
      case 'update_quiz_question':
        recipe = cmd.updateQuizQuestion(operation.chapterId, operation.questionId, (question) => {
          const base = structuredClone(isDraft(question) ? current(question) : question);
          // Another kind has other fields: start over instead of mixing them.
          const kindChange = 'kind' in operation.props && operation.props.kind !== base.kind;
          const patched = (kindChange ? { id: base.id } : { ...base }) as Record<string, unknown>;
          for (const [key, value] of Object.entries(operation.props)) {
            if (key === 'id') throw new OperationError('"id" cannot be changed');
            if (value === null) delete patched[key];
            else patched[key] = structuredClone(value);
          }
          return patched as unknown as Question;
        });
        message = 'Question updated';
        break;
      case 'delete_quiz_question':
        recipe = cmd.removeQuizQuestion(operation.chapterId, operation.questionId);
        message = 'Question deleted';
        break;
      case 'move_quiz_question':
        recipe = cmd.moveQuizQuestion(operation.chapterId, operation.questionId, operation.index);
        message = 'Question moved';
        break;
      case 'set_theme': {
        const preset = themePreset(operation.preset);
        if (!preset)
          throw new OperationError(
            `Unknown theme "${operation.preset}". Themes: ${THEME_PRESETS.map((p) => p.id).join(', ')}`,
          );
        const theme = structuredClone(preset.theme);
        if (operation.accent) theme.colors.accent = operation.accent;
        recipe = cmd.setTheme(theme, { useBackground: operation.useBackground !== false });
        message = `Theme "${preset.name}" applied`;
        break;
      }
      case 'set_theme_color':
        recipe = (d) => {
          if (!d.theme) cmd.setTheme(themeOfCourse(d))(d);
          cmd.setThemeColor(operation.role, operation.color)(d);
        };
        message = `Theme color "${operation.role}" changed`;
        break;
      case 'set_completion':
        recipe = cmd.setCompletion(operation.mode);
        message =
          operation.mode === 'goal'
            ? 'The course is completed when a goal chapter is reached'
            : 'The course is completed when all required chapters are seen';
        break;
      case 'add_popup': {
        const popup: Popup = {
          id: newId('popup'),
          title: operation.title,
          text: operation.text,
          ...(operation.assetId ? { assetId: operation.assetId } : {}),
          ...(operation.alt !== undefined ? { alt: operation.alt } : {}),
        };
        recipe = cmd.addPopup(popup);
        created.popupId = popup.id;
        message = `Popup "${popup.title}" added`;
        break;
      }
      case 'update_popup': {
        const { popupId, title, text, assetId, alt } = operation;
        recipe = cmd.updatePopup(popupId, { title, text, assetId, alt });
        message = 'Popup updated';
        break;
      }
      case 'delete_popup':
        recipe = cmd.removePopup(operation.popupId);
        message = 'Popup deleted';
        break;
      case 'add_glossary_entry': {
        const entry: GlossaryEntry = {
          id: newId('term'),
          term: operation.term,
          definition: operation.definition,
          ...(operation.variants?.length ? { variants: operation.variants } : {}),
        };
        recipe = cmd.addGlossaryEntry(entry);
        created.glossaryId = entry.id;
        message = `Glossary entry "${entry.term}" added`;
        break;
      }
      case 'update_glossary_entry': {
        const { entryId, term, definition, variants } = operation;
        recipe = cmd.updateGlossaryEntry(entryId, { term, definition, variants });
        message = 'Glossary entry updated';
        break;
      }
      case 'delete_glossary_entry':
        recipe = cmd.removeGlossaryEntry(operation.entryId);
        message = 'Glossary entry deleted';
        break;
      case 'delete_asset':
        recipe = cmd.removeAsset(operation.assetId);
        message = 'Asset deleted';
        break;
    }
  } catch (error) {
    throw toOperationError(error);
  }

  // Snapshot to restore exactly (without a redo entry) if validation fails.
  const { course: courseBefore, past, future, revision, selection } = state();
  let changed: boolean;
  try {
    changed = state().execute(label, recipe!);
  } catch (error) {
    throw toOperationError(error);
  }
  if (changed) {
    const problems = describeIssues(state().course);
    if (problems) {
      store.setState({ course: courseBefore, past, future, revision, selection });
      throw new OperationError(`The change would make the course invalid: ${problems}`);
    }
  }
  return {
    changed,
    message: changed ? message : 'Nothing changed',
    ...(Object.keys(created).length ? { created } : {}),
  };
}

/** All question ids (question clips and quiz chapters). */
function questionIdsOf(course: Course): Set<string> {
  const ids = new Set<string>();
  for (const chapter of course.chapters) {
    for (const track of chapter.tracks)
      for (const clip of track.clips) if (clip.type === 'question') ids.add(clip.question.id);
    for (const question of chapter.quiz?.questions ?? []) ids.add(question.id);
  }
  return ids;
}

function toOperationError(error: unknown): OperationError {
  if (error instanceof OperationError) return error;
  return new OperationError(error instanceof Error ? error.message : String(error));
}
