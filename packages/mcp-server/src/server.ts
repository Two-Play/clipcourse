// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The MCP server: tools to create, edit, review and export Clipcourse
 * courses. All edits go through the shared operations of editor-core, so
 * the AI gets the same guarantees as the editor (valid documents, no
 * overlapping clips, undo).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  builtInTemplates,
  describeTimeline,
  reviewCourse,
  COURSE_TEMPLATES,
  type Operation,
} from '@clipcourse/editor-core';
import { exportScorm, packageFileName } from '@clipcourse/exporter';
import schema from '@clipcourse/format/schema/course.v5.schema.json' with { type: 'json' };
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FORMAT_GUIDE } from './guide.js';
import { THEME_PRESETS, THEME_ROLES } from '@clipcourse/format';
import { readLocalMedia } from './media.js';
import type { ProjectTarget, Workspace } from './workspace.js';

export interface ServerOptions {
  workspace: Workspace;
  /** The built SCORM runtime (clipcourse-runtime.js) used by export_scorm. */
  runtime: () => string;
  /** Downloads media from URLs (step 2). Undefined disables URL imports. */
  download?: (
    url: string,
  ) => Promise<{ fileName: string; mime: string; data: Uint8Array; duration?: number }>;
  version?: string;
  /** Live bridge to open editors (pair_editor). */
  bridge?: { url: string; createPairingCode(): { code: string; expiresAt: number } };
}

// --- Schemas -------------------------------------------------------------------------

const project = z
  .string()
  .describe(
    'Project folder (relative to the first root, or absolute inside a root), or an id like "editor:1" from list_projects',
  );
const ms = (what: string) => z.number().int().min(0).describe(`${what} in milliseconds`);
const color = z
  .string()
  .describe(
    'CSS color (#rrggbb, #rgb, rgb(), rgba(), a color name) or a theme role: theme:background, theme:surface, theme:text, theme:muted, theme:accent, theme:onAccent, theme:success, theme:error (preferred: follows the theme)',
  );
const id = (what: string) => z.string().describe(`${what} id (from get_course)`);

const animation = z
  .object({
    type: z.enum(['fade', 'slide', 'zoom']),
    duration: z.number().int().positive().describe('ms'),
    direction: z
      .enum(['left', 'right', 'up', 'down'])
      .optional()
      .describe('for slide: where the clip comes from (in) or goes to (out)'),
    easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional(),
  })
  .strict();

// --- Questions ------------------------------------------------------------------------

const answerId = z
  .string()
  .min(1)
  .max(100)
  .describe('short id, unique within the question, e.g. "a"');
const questionCommon = {
  id: z
    .string()
    .optional()
    .describe('question id; leave out to get a generated one (used for LMS interactions)'),
  prompt: z.string().min(1).max(2000).describe('the question text'),
  points: z.number().min(0).max(1000).optional().describe('default 1'),
  scored: z.boolean().optional().describe('false: practice question, not counted in the score'),
  attempts: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe('attempts allowed, default 1; 0 = unlimited (until correct)'),
  showSolution: z.boolean().optional().describe('show the solution when done (default true)'),
  feedback: z
    .object({
      correct: z.string().max(2000).optional(),
      incorrect: z.string().max(2000).optional(),
    })
    .strict()
    .optional()
    .describe('own feedback texts instead of "Correct!" / "Not quite."'),
};
const choice = z.object({ id: answerId, text: z.string().min(1).max(1000) }).strict();
const question = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('single'),
        ...questionCommon,
        choices: z.array(choice).min(2).max(20),
        correct: z.string().describe('id of the one correct choice'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('multiple'),
        ...questionCommon,
        choices: z.array(choice).min(2).max(20),
        correct: z.array(z.string()).min(1).describe('ids of all correct choices'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('text'),
        ...questionCommon,
        answers: z
          .array(z.string().min(1).max(500))
          .min(1)
          .describe('accepted answers; spaces and (unless caseSensitive) case are ignored'),
        caseSensitive: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal('order'),
        ...questionCommon,
        items: z.array(choice).min(2).max(20).describe('in the CORRECT order; shown shuffled'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('match'),
        ...questionCommon,
        pairs: z
          .array(
            z
              .object({
                id: answerId,
                left: z.string().min(1).max(500),
                right: z.string().min(1).max(500),
              })
              .strict(),
          )
          .min(2)
          .max(20)
          .describe('matching pairs; the right sides are shown shuffled'),
      })
      .strict(),
    z
      .object({
        kind: z.literal('hotspot'),
        ...questionCommon,
        assetId: z.string().describe('image asset (from import_media)'),
        alt: z.string().max(2000).optional().describe('describes the image'),
        areas: z
          .array(
            z
              .object({
                id: answerId,
                label: z
                  .string()
                  .min(1)
                  .max(200)
                  .describe('name of the area; also a button for keyboard and screen reader users'),
                x: z.number().min(0).max(1),
                y: z.number().min(0).max(1),
                width: z.number().min(0).max(1),
                height: z.number().min(0).max(1),
              })
              .strict()
              .describe('rectangle in fractions of the image (0–1)'),
          )
          .min(1)
          .max(20),
        correct: z.array(z.string()).min(1).describe('ids of the areas that count as correct'),
      })
      .strict(),
  ])
  .describe(
    'A question. Kinds: single (one correct choice), multiple (all correct choices), text (typed answer), order (put items in order), match (pairs), hotspot (click the right area of an image).',
  );
const questionPatch = z
  .record(z.string(), z.unknown())
  .describe(
    'Fields to change (same names as in the question; null removes an optional field). Lists such as choices replace the whole list. To change the kind, give a complete question.',
  );

// --- Click actions --------------------------------------------------------------------

const clipAction = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('goToChapter'), chapterId: id('chapter') }).strict(),
    z
      .object({ type: z.literal('goToMarker'), chapterId: id('chapter'), markerId: id('marker') })
      .strict(),
    z.object({ type: z.literal('openPopup'), popupId: id('popup') }).strict(),
    z
      .object({
        type: z.literal('setClipVisibility'),
        clipId: id('clip'),
        visible: z.enum(['show', 'hide', 'toggle']),
        pause: z.boolean().optional().describe('pause playback when clicked'),
      })
      .strict(),
    z
      .object({
        type: z.literal('openUrl'),
        url: z.string().max(2048).describe('http(s):// or mailto: only; opens in a new window'),
      })
      .strict(),
  ])
  .describe(
    'What a click does: jump to a chapter or marker (starts playing there), open a popup, show/hide/toggle a clip (e.g. reveal an answer), or open a link',
  );

const clipProps = z
  .object({
    text: z.string().describe('text and box clips; plain text, line breaks kept'),
    role: z
      .enum(['heading', 'paragraph'])
      .nullable()
      .describe('text clips: semantic role for screen readers'),
    style: z
      .object({
        fontFamily: z.string().nullable(),
        fontSize: z
          .number()
          .positive()
          .nullable()
          .describe('stage pixels; 48 is a good body size on a 1920×1080 stage'),
        fontWeight: z.number().int().min(100).max(900).nullable(),
        italic: z.boolean().nullable(),
        color: color.nullable(),
        align: z.enum(['left', 'center', 'right']).nullable(),
        verticalAlign: z.enum(['top', 'middle', 'bottom']).nullable(),
        lineHeight: z.number().positive().nullable(),
      })
      .partial()
      .strict()
      .describe('text style (merged into the existing style; null removes a field)'),
    frame: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number().min(0),
        height: z.number().min(0),
        rotation: z.number().nullable().describe('degrees, clockwise'),
      })
      .partial()
      .strict()
      .describe('position and size in stage pixels (merged)'),
    opacity: z.number().min(0).max(1).nullable(),
    animations: z
      .object({ in: animation.nullable(), out: animation.nullable() })
      .partial()
      .strict()
      .nullable()
      .describe('entrance (in) and exit (out) animations; null removes'),
    fill: color.nullable().describe('box, shape: fill color'),
    stroke: color.nullable().describe('box, shape: outline color'),
    strokeWidth: z.number().min(0).nullable(),
    radius: z.number().min(0).nullable().describe('corner radius'),
    padding: z.number().min(0).nullable().describe('box: inner padding'),
    shape: z.enum(['rect', 'ellipse', 'line', 'arrow']).describe('shape clips'),
    kind: z.enum(['marker', 'frame', 'arrow', 'spotlight']).describe('highlight clips'),
    color: color.nullable().describe('highlight color'),
    pulse: z.boolean().nullable().describe('highlight: pulse gently'),
    label: z.string().nullable().describe('highlight: text read by screen readers'),
    alt: z.string().nullable().describe('image: alternative text; "" marks it decorative'),
    fit: z.enum(['contain', 'cover', 'fill']).nullable(),
    volume: z.number().min(0).max(1).nullable(),
    muted: z.boolean().nullable(),
    captionsAssetId: z.string().nullable().describe('video/audio: id of a captions (.vtt) asset'),
    trimStart: z
      .number()
      .int()
      .min(0)
      .nullable()
      .describe('video/audio: ms skipped at the start of the media'),
    action: clipAction
      .nullable()
      .describe('click action (buttons always need one; null removes it from other clips)'),
    actionLabel: z
      .string()
      .max(500)
      .nullable()
      .describe(
        'name of a clickable clip for screen readers, if its text/alt does not say what the click does',
      ),
    startsHidden: z
      .boolean()
      .nullable()
      .describe('not shown until a setClipVisibility action shows it'),
    start: z.number().int().min(0).describe('update_clip only: new start in ms (moves the clip)'),
    duration: z.number().int().positive().describe('update_clip only: new duration in ms'),
    question: z
      .union([question, questionPatch])
      .describe(
        'question clips: a complete question (add_clip; or update_clip to replace it), or a patch of some fields (update_clip)',
      ),
  })
  .partial()
  .strict();

const clipType = z.enum([
  'text',
  'box',
  'shape',
  'image',
  'video',
  'audio',
  'highlight',
  'progress',
  'question',
  'button',
]);

// --- Helpers -------------------------------------------------------------------------

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });
const json = (value: unknown): ToolResult => text(JSON.stringify(value, null, 2));
const failure = (error: unknown): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
});

/** Optional properties without `undefined` (for exactOptionalPropertyTypes). */
type Defined<T> = { [K in keyof T as undefined extends T[K] ? never : K]: T[K] } & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Removes properties whose value is undefined. */
function defined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Defined<T>;
}

export const SERVER_INSTRUCTIONS = `Clipcourse builds e-learning courses on a timeline and exports them as SCORM packages.
A course has chapters; each chapter has its own timeline (starting at 0 ms) with tracks and clips.
Typical workflow: list_projects or create_project → get_course (outline) → add_chapter / add_clip / update_clip → questions (add_clip type question, set_quiz, add_quiz_question, set_assessment) → interactions (add_clip type button, props.action, add_popup, add_glossary_entry, set_completion) → review_course → export_scorm.
All times are milliseconds, all positions are stage pixels (default stage 1920×1080). Clips on one track never overlap; the server moves them to the nearest free spot.
Every change is saved immediately and can be undone with undo. Read clipcourse://format/guide for the course format.`;

export function createServer(options: ServerOptions): McpServer {
  const { workspace } = options;
  const server = new McpServer(
    { name: 'clipcourse', version: options.version ?? '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  type Shape = Record<string, z.ZodType>;
  const tool = <S extends Shape>(
    name: string,
    description: string,
    shape: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult> | ToolResult,
    annotations: {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      openWorldHint?: boolean;
    } = {},
  ) => {
    server.registerTool(
      name,
      { description, inputSchema: shape, annotations: { openWorldHint: false, ...annotations } },
      (async (args: z.infer<z.ZodObject<S>>) => {
        try {
          return await handler(args);
        } catch (error) {
          return failure(error);
        }
      }) as never,
    );
  };

  /** A tool that runs one editing operation on a project. */
  const op = <S extends Shape>(
    name: string,
    description: string,
    shape: S,
    toOperation: (args: z.infer<z.ZodObject<S>>) => Operation,
    destructive = false,
  ) =>
    tool(
      name,
      description,
      { project, ...shape },
      async (args) => {
        const target = workspace.open((args as { project: string }).project);
        const result = await target.execute(toOperation(args as never));
        return json(
          defined({ message: result.message, created: result.created, changed: result.changed }),
        );
      },
      { destructiveHint: destructive },
    );

  // --- Projects --------------------------------------------------------------------

  tool(
    'list_projects',
    'Lists course projects in the allowed folders (and connected editors).',
    {},
    () =>
      json({
        roots: workspace.roots,
        projects: workspace.list(),
        editors: workspace.targets().map((t) => ({ project: t.id, title: t.course().title })),
      }),
    { readOnlyHint: true },
  );

  tool(
    'create_project',
    'Creates a new course project in a new or empty folder: empty, or from a course template, with a design theme.',
    {
      path: z.string().describe('folder for the project, relative to the first root'),
      title: z.string().min(1).max(500).optional(),
      language: z.string().optional().describe('BCP 47 language of the content, e.g. "en" or "de"'),
      width: z.number().int().min(16).max(8192).optional().describe('stage width, default 1920'),
      height: z.number().int().min(16).max(8192).optional().describe('stage height, default 1080'),
      template: z
        .enum(COURSE_TEMPLATES.map((t) => t.id) as [string, ...string[]])
        .optional()
        .describe(
          `start from a course template: ${COURSE_TEMPLATES.map((t) => `${t.id} (${t.description})`).join('; ')}`,
        ),
      theme: z
        .enum(THEME_PRESETS.map((p) => p.id) as [string, ...string[]])
        .optional()
        .describe("design theme (see list_themes); default: dark, or the template's theme"),
    },
    (args) => {
      const suggested = args.template
        ? COURSE_TEMPLATES.find((t) => t.id === args.template)?.theme
        : undefined;
      const target = workspace.create(
        args.path,
        defined({
          title: args.title,
          language: args.language,
          width: args.width,
          height: args.height,
          template: args.template,
          theme: args.theme ?? suggested,
        }),
      );
      return json({
        project: target.id,
        chapterId: target.course().chapters[0]!.id,
        message: 'Project created with one empty chapter',
      });
    },
  );

  tool(
    'get_course',
    'Shows a course: "outline" (readable timeline of every chapter, with all ids) or "json" (the full course document, or one chapter).',
    {
      project,
      format: z.enum(['outline', 'json']).default('outline'),
      chapterId: z.string().optional().describe('limit to one chapter'),
    },
    (args) => {
      const course = workspace.open(args.project).course();
      if (args.format === 'outline') return text(describeTimeline(course, args.chapterId));
      if (args.chapterId) {
        const chapter = course.chapters.find((c) => c.id === args.chapterId);
        if (!chapter) throw new Error(`Unknown chapter "${args.chapterId}"`);
        return json(chapter);
      }
      return json(course);
    },
    { readOnlyHint: true },
  );

  tool(
    'review_course',
    'Checks a course: validity, accessibility (alt text, captions, contrast, font size), readability (text shown too briefly) and structure. Returns issues with suggested fixes.',
    { project },
    (args) => {
      const issues = reviewCourse(workspace.open(args.project).course());
      return json({
        summary: issues.length ? `${issues.length} issue(s)` : 'No issues found',
        issues,
      });
    },
    { readOnlyHint: true },
  );

  tool(
    'list_templates',
    'Lists chapter templates usable with add_chapter (course templates: see create_project).',
    { project },
    (args) => json(builtInTemplates(workspace.open(args.project).course()).map((t) => t.name)),
    { readOnlyHint: true },
  );

  tool(
    'list_themes',
    'Lists the design themes: colors per role and fonts. Clip colors can use a role ("theme:accent") so they follow the theme.',
    {},
    () =>
      json(
        THEME_PRESETS.map((p) => ({
          id: p.id,
          name: p.name,
          colors: p.theme.colors,
          headingFont: p.theme.headingFont,
          bodyFont: p.theme.bodyFont,
        })),
      ),
    { readOnlyHint: true },
  );

  op(
    'set_theme',
    'Applies a design theme to the whole course (colors and fonts of everything that uses theme roles). The stage background follows the theme.',
    {
      preset: z.enum(THEME_PRESETS.map((p) => p.id) as [string, ...string[]]),
      accent: color.optional().describe('own accent color (e.g. brand color); keep it readable'),
    },
    (a) => ({ op: 'set_theme', preset: a.preset, ...defined({ accent: a.accent }) }),
  );

  op(
    'set_theme_color',
    'Changes one color of the course theme, e.g. the accent to a brand color.',
    {
      role: z.enum(THEME_ROLES),
      color: z.string().describe('a real CSS color (#rrggbb), not a role'),
    },
    (a) => ({ op: 'set_theme_color', role: a.role, color: a.color }),
  );

  op(
    'set_course',
    'Changes course title, language or stage background.',
    {
      title: z.string().min(1).max(500).optional(),
      language: z.string().optional(),
      stageBackground: color.optional(),
    },
    (a) => ({
      op: 'set_course',
      ...defined({ title: a.title, language: a.language, stageBackground: a.stageBackground }),
    }),
  );

  // --- Chapters --------------------------------------------------------------------

  op(
    'add_chapter',
    'Adds a chapter, optionally from a template (see list_templates).',
    {
      title: z.string().min(1).max(500).optional(),
      index: z.number().int().min(0).optional().describe('position, default: at the end'),
      duration: ms('chapter length').optional(),
      transition: z
        .enum(['wait', 'auto'])
        .optional()
        .describe('at the end: wait for "Continue" (default) or continue automatically'),
      template: z.string().optional(),
    },
    (a) => ({
      op: 'add_chapter',
      ...defined({
        title: a.title,
        index: a.index,
        duration: a.duration,
        transition: a.transition,
        template: a.template,
      }),
    }),
  );

  op(
    'update_chapter',
    'Changes a chapter: title, length, transition, background.',
    {
      chapterId: id('chapter'),
      title: z.string().min(1).max(500).optional(),
      duration: ms('chapter length').optional(),
      fitToContent: z.boolean().optional().describe('set the length to the end of the last clip'),
      transition: z.enum(['wait', 'auto']).optional(),
      background: color.nullable().optional().describe('null: use the stage background'),
      optional: z
        .boolean()
        .optional()
        .describe('not needed for completion (side branches, extras); rule "required"'),
      goal: z.boolean().optional().describe('reaching its end completes the course; rule "goal"'),
    },
    (a) =>
      a.fitToContent
        ? { op: 'fit_chapter', chapterId: a.chapterId }
        : {
            op: 'update_chapter',
            chapterId: a.chapterId,
            ...defined({
              title: a.title,
              duration: a.duration,
              transition: a.transition,
              background: a.background,
              optional: a.optional,
              goal: a.goal,
            }),
          },
  );

  op(
    'move_chapter',
    'Moves a chapter to another position (0 = first).',
    { chapterId: id('chapter'), index: z.number().int().min(0) },
    (a) => ({ op: 'move_chapter', chapterId: a.chapterId, index: a.index }),
  );
  op(
    'duplicate_chapter',
    'Copies a chapter (with new ids) right after it.',
    { chapterId: id('chapter') },
    (a) => ({ op: 'duplicate_chapter', chapterId: a.chapterId }),
  );
  op(
    'delete_chapter',
    'Deletes a chapter and its clips (undo restores it).',
    { chapterId: id('chapter') },
    (a) => ({ op: 'delete_chapter', chapterId: a.chapterId }),
    true,
  );

  op(
    'add_marker',
    'Adds a marker (jump point shown in the table of contents) to a chapter.',
    {
      chapterId: id('chapter'),
      time: ms('position'),
      title: z.string().min(1).max(500),
    },
    (a) => ({ op: 'add_marker', chapterId: a.chapterId, time: a.time, title: a.title }),
  );
  op(
    'update_marker',
    'Moves or renames a marker.',
    {
      chapterId: id('chapter'),
      markerId: id('marker'),
      time: ms('position').optional(),
      title: z.string().min(1).max(500).optional(),
    },
    (a) => ({
      op: 'update_marker',
      chapterId: a.chapterId,
      markerId: a.markerId,
      ...defined({ time: a.time, title: a.title }),
    }),
  );
  op(
    'delete_marker',
    'Deletes a marker.',
    { chapterId: id('chapter'), markerId: id('marker') },
    (a) => ({ op: 'delete_marker', chapterId: a.chapterId, markerId: a.markerId }),
    true,
  );

  // --- Quizzes and scoring ----------------------------------------------------------------

  op(
    'set_assessment',
    'Sets the passing score of the course (percent of the points of all scored questions). The LMS then gets passed/failed once all scored questions are answered. null removes it (the LMS still gets the score).',
    {
      passingScore: z.number().min(0).max(100).nullable().describe('0–100, or null to remove'),
    },
    (a) => ({ op: 'set_assessment', passingScore: a.passingScore }),
  );

  op(
    'set_quiz',
    'Turns a chapter into a quiz chapter (questions one after another, then a result; no timeline playback) or changes its settings. A new quiz gets one sample question; replace it with update_quiz_question or add more with add_quiz_question. enabled=false turns it back into a normal chapter.',
    {
      chapterId: id('chapter'),
      enabled: z.boolean().optional().describe('false removes the quiz and its questions'),
      shuffle: z.boolean().optional().describe('show the questions in a shuffled order'),
      retries: z
        .number()
        .int()
        .min(0)
        .max(20)
        .optional()
        .describe('how often the learner may restart the whole quiz (default 0)'),
    },
    (a) => ({
      op: 'set_quiz',
      chapterId: a.chapterId,
      ...defined({ enabled: a.enabled, shuffle: a.shuffle, retries: a.retries }),
    }),
    false,
  );

  op(
    'add_quiz_question',
    'Adds a question to a quiz chapter (see set_quiz).',
    {
      chapterId: id('chapter'),
      question,
      index: z.number().int().min(0).optional().describe('position, default: at the end'),
    },
    (a) => ({
      op: 'add_quiz_question',
      chapterId: a.chapterId,
      question: { ...a.question, id: a.question.id ?? '' } as never,
      ...defined({ index: a.index }),
    }),
  );

  op(
    'update_quiz_question',
    'Changes a question of a quiz chapter. Give the fields to change; a complete question with another kind replaces it.',
    {
      chapterId: id('chapter'),
      questionId: id('question'),
      props: questionPatch,
    },
    (a) => ({
      op: 'update_quiz_question',
      chapterId: a.chapterId,
      questionId: a.questionId,
      props: a.props,
    }),
  );

  op(
    'move_quiz_question',
    'Moves a question within its quiz (0 = first).',
    { chapterId: id('chapter'), questionId: id('question'), index: z.number().int().min(0) },
    (a) => ({
      op: 'move_quiz_question',
      chapterId: a.chapterId,
      questionId: a.questionId,
      index: a.index,
    }),
  );

  op(
    'delete_quiz_question',
    'Deletes a question from a quiz (a quiz keeps at least one question).',
    { chapterId: id('chapter'), questionId: id('question') },
    (a) => ({ op: 'delete_quiz_question', chapterId: a.chapterId, questionId: a.questionId }),
    true,
  );

  // --- Branching, popups, glossary -----------------------------------------------------

  op(
    'set_completion',
    'Sets when the course counts as completed: "required" (default) = all chapters seen except those marked optional; "goal" = a chapter marked as goal has been reached (for branching courses with several endings).',
    { mode: z.enum(['required', 'goal']) },
    (a) => ({ op: 'set_completion', mode: a.mode }),
  );

  op(
    'add_popup',
    'Adds a popup (info window with title, text and an optional image) that click actions can open (action type openPopup).',
    {
      title: z.string().min(1).max(500),
      text: z.string().max(10000).describe('plain text, line breaks kept'),
      assetId: z.string().optional().describe('image asset shown above the text'),
      alt: z.string().max(1000).optional().describe('alt text of the image'),
    },
    (a) => ({
      op: 'add_popup',
      title: a.title,
      text: a.text,
      ...defined({ assetId: a.assetId, alt: a.alt }),
    }),
  );
  op(
    'update_popup',
    'Changes a popup. null removes the image or alt text.',
    {
      popupId: id('popup'),
      title: z.string().min(1).max(500).optional(),
      text: z.string().max(10000).optional(),
      assetId: z.string().nullable().optional(),
      alt: z.string().max(1000).nullable().optional(),
    },
    (a) => ({
      op: 'update_popup',
      popupId: a.popupId,
      ...defined({ title: a.title, text: a.text, assetId: a.assetId, alt: a.alt }),
    }),
  );
  op(
    'delete_popup',
    'Deletes a popup (refused while a click action opens it).',
    { popupId: id('popup') },
    (a) => ({ op: 'delete_popup', popupId: a.popupId }),
    true,
  );

  op(
    'add_glossary_entry',
    'Adds a glossary term. The player marks its first occurrence in each text clip (whole words, any case); learners click it for the explanation. The glossary is also listed in the table of contents.',
    {
      term: z.string().min(1).max(200),
      definition: z.string().min(1).max(5000).describe('short, plain explanation'),
      variants: z
        .array(z.string().min(1).max(200))
        .max(20)
        .optional()
        .describe('other forms, e.g. plural'),
    },
    (a) => ({
      op: 'add_glossary_entry',
      term: a.term,
      definition: a.definition,
      ...defined({ variants: a.variants }),
    }),
  );
  op(
    'update_glossary_entry',
    'Changes a glossary term. variants: null removes them.',
    {
      entryId: id('glossary entry'),
      term: z.string().min(1).max(200).optional(),
      definition: z.string().min(1).max(5000).optional(),
      variants: z.array(z.string().min(1).max(200)).max(20).nullable().optional(),
    },
    (a) => ({
      op: 'update_glossary_entry',
      entryId: a.entryId,
      ...defined({ term: a.term, definition: a.definition, variants: a.variants }),
    }),
  );
  op(
    'delete_glossary_entry',
    'Deletes a glossary term.',
    { entryId: id('glossary entry') },
    (a) => ({ op: 'delete_glossary_entry', entryId: a.entryId }),
    true,
  );

  // --- Tracks ------------------------------------------------------------------------

  op(
    'add_track',
    'Adds a track to a chapter, or to the course layer (shown in every chapter) with layer=background/foreground.',
    {
      chapterId: id('chapter').optional(),
      layer: z
        .enum(['background', 'foreground'])
        .optional()
        .describe('course layer instead of a chapter'),
      name: z.string().max(200).optional(),
      position: z
        .enum(['front', 'back'])
        .optional()
        .describe('front (default) draws above existing tracks'),
    },
    (a) => ({
      op: 'add_track',
      ...defined({ chapterId: a.chapterId, layer: a.layer, name: a.name, position: a.position }),
    }),
  );
  op(
    'update_track',
    'Renames, hides or mutes a track, or moves it in the stacking order (index 0 = back-most).',
    {
      trackId: id('track'),
      name: z.string().max(200).optional(),
      hidden: z.boolean().optional(),
      muted: z.boolean().optional(),
      index: z.number().int().min(0).optional(),
    },
    (a) =>
      a.index !== undefined
        ? { op: 'move_track', trackId: a.trackId, index: a.index }
        : {
            op: 'update_track',
            trackId: a.trackId,
            ...defined({ name: a.name, hidden: a.hidden, muted: a.muted }),
          },
  );
  op(
    'delete_track',
    'Deletes a track with its clips.',
    { trackId: id('track') },
    (a) => ({ op: 'delete_track', trackId: a.trackId }),
    true,
  );

  // --- Clips -------------------------------------------------------------------------

  op(
    'add_clip',
    [
      'Adds a clip. Types: text, box (filled box with optional text), shape (rect/ellipse/line/arrow), image/video/audio (need assetId from import_media), highlight (marker/frame/arrow/spotlight), progress (course progress bar), question (playback stops at its start until the learner answers; give props.question, otherwise a sample single-choice question is used), button (props.text and props.action; default action: go to the next chapter). Any other visual clip can also get props.action to become clickable.',
      'Without trackId the clip goes to the front-most track of the chapter that has room at "start" (a new track is created if needed).',
      'Defaults are sensible (centered frame, readable text); override with props.',
    ].join(' '),
    {
      type: clipType,
      chapterId: id('chapter')
        .optional()
        .describe('required if the course has several chapters and no trackId is given'),
      trackId: id('track').optional(),
      start: ms('start on the chapter timeline').optional(),
      duration: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('ms; default 3000, or the media length'),
      assetId: z.string().optional().describe('image/video/audio: the asset to show'),
      props: clipProps.optional(),
    },
    (a) => ({
      op: 'add_clip',
      type: a.type,
      ...defined({
        chapterId: a.chapterId,
        trackId: a.trackId,
        start: a.start,
        duration: a.duration,
        assetId: a.assetId,
        props: a.props,
      }),
    }),
  );

  op(
    'update_clip',
    'Changes clip properties. Nested objects (style, frame, animations) are merged; null removes a property. start/duration move or trim the clip.',
    {
      clipId: id('clip'),
      props: clipProps,
    },
    (a) => ({ op: 'update_clip', clipId: a.clipId, props: a.props }),
  );

  op(
    'move_clip',
    'Moves a clip in time and/or to another track of the same chapter. Overlaps are resolved to the nearest free spot.',
    {
      clipId: id('clip'),
      start: ms('new start'),
      trackId: id('track').optional(),
    },
    (a) => ({
      op: 'move_clip',
      clipId: a.clipId,
      start: a.start,
      ...defined({ trackId: a.trackId }),
    }),
  );
  op(
    'trim_clip',
    'Moves the start or end edge of a clip. Trimming the start of video/audio skips into the media.',
    {
      clipId: id('clip'),
      edge: z.enum(['start', 'end']),
      time: ms('new edge position on the chapter timeline'),
    },
    (a) => ({ op: 'trim_clip', clipId: a.clipId, edge: a.edge, time: a.time }),
  );
  op(
    'split_clip',
    'Splits a clip into two at a time on the chapter timeline.',
    { clipId: id('clip'), time: ms('split position') },
    (a) => ({ op: 'split_clip', clipId: a.clipId, time: a.time }),
  );
  op(
    'duplicate_clip',
    'Copies a clip to the next free spot after it.',
    { clipId: id('clip') },
    (a) => ({ op: 'duplicate_clip', clipId: a.clipId }),
  );
  op(
    'delete_clips',
    'Deletes clips.',
    { clipIds: z.array(z.string()).min(1) },
    (a) => ({ op: 'delete_clips', clipIds: a.clipIds }),
    true,
  );

  // --- Media -------------------------------------------------------------------------

  tool(
    'import_media',
    `Imports an image, video, audio or WebVTT captions file into the project and returns its assetId. ${options.download ? 'Give either a local "path" inside the allowed folders or an http(s) "url".' : 'Give a local "path" inside the allowed folders.'} Then place it with add_clip (image/video/audio) or set it as captionsAssetId.`,
    {
      project,
      path: z.string().optional().describe('local file inside the allowed folders'),
      ...(options.download
        ? { url: z.string().url().optional().describe('http(s) URL to download') }
        : {}),
      alt: z.string().optional().describe('images: default alternative text'),
    },
    async (args) => {
      const a = args as { project: string; path?: string; url?: string; alt?: string };
      const target = workspace.open(a.project);
      if (!a.path === !a.url) throw new Error('Give exactly one of "path" or "url"');
      const media = a.path
        ? readLocalMedia(workspace.resolve(a.path))
        : await options.download!(a.url!);
      const result = await target.execute({
        op: 'add_asset',
        fileName: media.fileName,
        mime: media.mime,
        data: media.data,
        ...defined({ alt: a.alt, duration: media.duration, sourceUrl: a.url }),
      });
      return json(
        defined({
          message: result.message,
          assetId: result.created?.assetId,
          duration: media.duration,
        }),
      );
    },
    options.download ? { openWorldHint: true } : {},
  );

  op(
    'update_media',
    'Changes the default alternative text of an image asset.',
    {
      assetId: id('asset'),
      alt: z.string().nullable(),
    },
    (a) => ({ op: 'update_asset', assetId: a.assetId, alt: a.alt }),
  );
  op(
    'delete_media',
    'Removes an unused asset from the course.',
    { assetId: id('asset') },
    (a) => ({ op: 'delete_asset', assetId: a.assetId }),
    true,
  );

  // --- History -----------------------------------------------------------------------

  op('undo', 'Undoes the last change (this session).', {}, () => ({ op: 'undo' }));
  op('redo', 'Redoes the last undone change.', {}, () => ({ op: 'redo' }));

  // --- Export ------------------------------------------------------------------------

  tool(
    'export_scorm',
    'Exports the course as a SCORM package (.zip) for an LMS. SCORM 1.2 works almost everywhere; 2004 also reports progress.',
    {
      project,
      version: z.enum(['1.2', '2004']).default('1.2'),
      outputPath: z
        .string()
        .optional()
        .describe(
          'target .zip inside the allowed folders; default: <project>/exports/<title>-scorm12.zip',
        ),
    },
    async (args) => {
      const target: ProjectTarget = workspace.open(args.project);
      const course = target.course();
      let output: string;
      if (args.outputPath) output = workspace.resolve(args.outputPath);
      else if (target.kind === 'folder')
        output = join(
          (target as unknown as { dir: string }).dir,
          'exports',
          packageFileName(course, args.version),
        );
      else throw new Error('outputPath is required for this project');
      if (!output.endsWith('.zip')) throw new Error('outputPath must end with .zip');
      const withFetch = target as ProjectTarget & {
        fetchFiles?: () => Promise<Map<string, Uint8Array>>;
      };
      const files = withFetch.fetchFiles ? await withFetch.fetchFiles() : target.files();
      const result = exportScorm(
        { course, files },
        { version: args.version, runtime: options.runtime() },
      );
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, result.zip);
      return json(
        defined({
          message: `Exported SCORM ${args.version} package`,
          file: workspace.display(output),
          bytes: result.zip.length,
          warnings: result.warnings.length ? result.warnings : undefined,
        }),
      );
    },
  );

  // --- Live editor -------------------------------------------------------------------

  if (options.bridge) {
    const bridge = options.bridge;
    tool(
      'pair_editor',
      'Connects to the course that is open in the Clipcourse editor, so you can edit it live (changes appear immediately and the user can undo them). Returns a 6-digit code: tell the user to click "AI assistant" in the editor and enter it. After pairing, the editor appears in list_projects as "editor:N"; use that as project.',
      {},
      () => {
        const { code, expiresAt } = bridge.createPairingCode();
        return json({
          code,
          validForMinutes: Math.round((expiresAt - Date.now()) / 60000),
          instructions: `Ask the user to click "AI assistant" in the Clipcourse editor and enter the code ${code}. Then call list_projects to get the editor's project id.`,
        });
      },
      { readOnlyHint: true },
    );
  }

  // --- Resources ---------------------------------------------------------------------

  server.registerResource(
    'format-guide',
    'clipcourse://format/guide',
    { title: 'Clipcourse course format guide', mimeType: 'text/markdown' },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: FORMAT_GUIDE }] }),
  );
  server.registerResource(
    'format-schema',
    'clipcourse://format/schema',
    {
      title: 'Clipcourse course JSON schema (format version 2)',
      mimeType: 'application/schema+json',
    },
    (uri) => ({
      contents: [
        { uri: uri.href, mimeType: 'application/schema+json', text: JSON.stringify(schema) },
      ],
    }),
  );

  return server;
}
