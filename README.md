# Clipcourse

Clipcourse is an open-source SCORM course generator. You build a course the
way you would cut a video: every chapter has its own timeline with tracks and
clips. Text, images, shapes, boxes and optional video or audio clips appear
and disappear at exact times. The timeline itself is the beat, so you don't
need a video or audio track.

> **Status:** early development. Milestones 1–4 (course format, player,
> timeline editor, chapters, animations, SCORM export) are done. The desktop
> app and polish (M5) are in progress.

## Features

| Feature                                                                                   | Status  |
| ----------------------------------------------------------------------------------------- | ------- |
| Versioned JSON course format (course → chapters → timeline)                               | ✅ M1   |
| Deterministic player: seek, pause and chapter jumps always show the right picture         | ✅ M1   |
| Chapter transitions: wait for _Continue_ (default) or continue automatically              | ✅ M1   |
| Course layer: elements shown in every chapter                                             | ✅ M1   |
| Progress: bookmark and seen chapters, compact enough for SCORM 1.2                        | ✅ M1   |
| Accessibility: keyboard control, WebVTT captions, alt text, screen reader announcements   | ✅ M1   |
| Timeline editor: tracks, clips, playhead, drag/trim with snapping, undo/redo              | ✅ M2   |
| Chapters: add from templates, reorder, duplicate, save as template                        | ✅ M3   |
| Course layer ("all chapters" tracks), course progress bar                                 | ✅ M3   |
| Animations (fade, slide, zoom), highlights (marker, frame, arrow, spotlight)              | ✅ M3   |
| Chapter markers and table of contents in the player                                       | ✅ M3   |
| SCORM 1.2 and 2004 export with resume and completion, LMS simulation in the preview       | ✅ M4   |
| AI assistants via MCP: build, review and live-edit courses                                | ✅ M4.5 |
| Questions (choice, text, order, match, hotspot), quiz chapters, score and pass/fail       | ✅ M6a  |
| Buttons and hotspots with actions, branching, glossary and info popups                    | M6b     |
| Design themes with color roles, 9 chapter templates, 3 course templates, template gallery | ✅ M6c  |
| Desktop app (Tauri), documentation                                                        | M5      |

## Repository layout

```
packages/format       MIT    Course format: types, JSON schema, validation, migrations
packages/player       MIT    Player runtime that ships inside every exported course
packages/scorm-runtime MIT   SCORM 1.2/2004 runtime, ships inside every exported course
packages/editor-core  AGPL   Editor model: commands, undo/redo, snapping, project files
packages/exporter     AGPL   Builds SCORM packages
packages/mcp-server   AGPL   MCP server: AI assistants build, review and export courses
apps/editor           AGPL   The editor (React)
apps/player-demo      MIT    Development harness that plays the example courses
examples/             CC0    Example courses
```

## Try it

Requirements: Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm --filter @clipcourse/editor dev        # editor on http://localhost:4318
pnpm --filter @clipcourse/player-demo dev   # player demo on http://localhost:4317
```

In the editor, click **Open example** to load [`examples/welcome`](examples/welcome),
or start with **＋ Text**. Projects are saved as `.zip` files (`course.json`
plus an `assets/` folder). Your working copy is kept in the browser and
restored on the next start.

### Editor basics

- The ribbon works like Office: File, Home, Insert, Chapter and View tabs, plus a
  contextual tab for the selected clip (animation, font, colors, arrange).
  Collapse it with the arrow on the right.
- Add text, boxes and shapes from Home or Insert; import images, video, audio and
  `.vtt` captions and drag them onto a track.
- Drag clips to move them (also to other tracks), drag their edges to trim.
  Clips snap to the playhead, clip edges and the chapter bounds; hold Alt to
  disable snapping. Escape cancels a drag.
- Drag the striped chapter end to change the chapter length.
- Select a clip on the stage to move it or resize it with the corner handles.
- **Chapters** (left): add from a template, rename (double-click or F2),
  reorder, duplicate, delete, or save the current chapter as a template for
  other projects (templates keep their media).
- **Add track for all chapters** creates a course layer track: its clips
  (logo, background, progress bar) appear in every chapter.
- **Add marker** puts a jump point at the playhead; markers show up in the
  player's table of contents. Drag or use the arrow keys to move a focused
  marker, double-click to rename, Delete to remove.
- Every visual clip can have an entrance and exit animation (fade, slide,
  zoom). Highlights (frame, marker, arrow, spotlight) can pulse and carry a
  text for screen readers. With "reduce motion" enabled, the player turns
  slides and zooms into fades and stops pulsing.
- **Question** (Home or Insert) adds a question clip: playback stops at its
  start until the learner answers. Kinds: single and multiple choice, text
  answer, put in order, match pairs, click the image (hotspot). Edit the
  question, answers, points, attempts and feedback in the properties.
- **Quiz chapter** (Insert) adds a chapter that asks its questions one after
  another and ends with a result; it can shuffle questions and allow
  retries. **Make quiz chapter** (Chapter tab) turns the current chapter
  into one.
- **Score the course** (course properties, with nothing selected) sets a
  passing score; the LMS then gets passed or failed. Every question can
  also be practice only ("Counts towards the score" off).
- **Button** (Home or Insert) adds a button. Any visual clip can also be made
  clickable under _On click_ in the properties: go to a chapter or marker
  (branching), open a popup, show or hide another clip (e.g. "Show the
  answer"; tick _Hidden until shown by a click_ on the answer), or open a link.
- **Popups** and **Glossary** (left sidebar): popups hold extra information
  for click actions; glossary terms are marked in text clips and explained
  when the learner clicks them.
- **Completed when** (course properties): all chapters except optional ones
  are seen, or a goal chapter is reached. Mark chapters as optional or goal
  in the chapter properties.
- **Right-click** (or Shift+F10 / the menu key) on clips, the stage, tracks,
  chapters and media for a context menu. Clips can be cut, copied and pasted
  (Ctrl+X/C/V), also into other chapters; click actions between copied clips
  point to the copies.
- Drag the edges between the panels (sidebar, properties, timeline) to resize
  them, or focus an edge and use the arrow keys; double-click resets it.
  _View → Reset layout_ restores everything.
- **Stage format** (course properties or Design tab): 16:9, 4:3, 1:1, 9:16 or a
  custom size; all clips are scaled with it.
- **New** opens a gallery: a blank course or a course template (compliance
  training, onboarding, micro lesson), with a theme.
- **Design** tab: switch the theme (dark, light, corporate, nature, warm, high
  contrast) or change its accent, text or background color. Colors set to a
  theme role ("Theme: accent", …) follow the theme; custom colors stay fixed.
  All built-in themes keep text readable (WCAG AA contrast).
- **Preview** plays the course in the real player. With _LMS simulation_
  it also shows what an LMS would store.
- **Export SCORM…** creates a package for your LMS, see
  [docs/scorm.md](docs/scorm.md).

### AI assistants (MCP)

`clipcourse-mcp` lets MCP clients such as Claude Desktop or Claude Code
create, review and export courses in project folders you allow. See
[docs/mcp.md](docs/mcp.md).

| Key                   | Action                                 |
| --------------------- | -------------------------------------- |
| Space                 | Play or pause                          |
| Delete                | Remove selected clips                  |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo                            |
| S                     | Split selected clips at the playhead   |
| Ctrl+D                | Duplicate                              |
| ← / → (Shift: 1 s)    | Move the playhead, or a focused clip   |
| Alt+← / Alt+→         | Trim the end of a focused clip         |
| Arrow keys on stage   | Nudge the selected clip (Shift: 10 px) |

### Player shortcuts

| Key       | Action                                                 |
| --------- | ------------------------------------------------------ |
| Space / K | Play or pause (Space on a button activates the button) |
| ← / →     | Back or forward 5 seconds                              |
| N / P     | Next or previous chapter                               |
| C         | Captions on or off                                     |
| T         | Table of contents                                      |

## Course format in brief

```jsonc
{
  "formatVersion": 5,
  "id": "my_course",
  "title": "My course",
  "language": "en",
  "stage": { "width": 1920, "height": 1080, "background": "#000" },
  "assets": { "intro": { "kind": "video", "src": "assets/intro.mp4" } },
  "chapters": [
    {
      "id": "ch1",
      "title": "Introduction",
      "duration": 8000, // ms; each chapter starts at 0
      "transition": { "mode": "wait" }, // or "auto"
      "tracks": [
        // tracks[0] is the back-most layer
        {
          "id": "t1",
          "clips": [
            {
              "id": "c1",
              "type": "text",
              "text": "Hello",
              "start": 0,
              "duration": 3000,
              "frame": { "x": 100, "y": 100, "width": 800, "height": 120 },
            },
          ],
        },
      ],
    },
  ],
}
```

The full definition is in
[`packages/format/src/types.ts`](packages/format/src/types.ts). There is also a
generated JSON schema in
[`packages/format/schema/course.v5.schema.json`](packages/format/schema/course.v5.schema.json).
Older documents (versions 1 to 4) are migrated automatically when opened.
All times are integer milliseconds and all positions are logical stage
pixels. The player scales the stage to fit and keeps its aspect ratio.

## Development

```bash
pnpm test            # unit tests
pnpm test:e2e        # browser tests (run `pnpm exec playwright install chromium` once)
pnpm typecheck
pnpm lint
pnpm build
pnpm licenses:check  # dependency license policy
scripts/lms/moodle-up.sh && pnpm --filter @clipcourse/editor test:lms   # real Moodle, see docs/lms-testing.md
```

## License

Clipcourse is dual-licensed by component:

- **Editor and tooling:** [GNU AGPL-3.0](LICENSE). A commercial license may be
  offered separately.
- **Player runtime and course format:** [MIT](packages/player/LICENSE). Courses
  you export are yours and are not subject to the AGPL.

See [LICENSING.md](LICENSING.md) for details and
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for dependencies.
Contributions require agreeing to the [CLA](CLA.md); see
[CONTRIBUTING.md](CONTRIBUTING.md).
