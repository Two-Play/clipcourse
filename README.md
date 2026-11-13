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

| Feature                                                                                 | Status |
| --------------------------------------------------------------------------------------- | ------ |
| Versioned JSON course format (course → chapters → timeline)                             | ✅ M1  |
| Deterministic player: seek, pause and chapter jumps always show the right picture       | ✅ M1  |
| Chapter transitions: wait for _Continue_ (default) or continue automatically            | ✅ M1  |
| Course layer: elements shown in every chapter                                           | ✅ M1  |
| Progress: bookmark and seen chapters, compact enough for SCORM 1.2                      | ✅ M1  |
| Accessibility: keyboard control, WebVTT captions, alt text, screen reader announcements | ✅ M1  |
| Timeline editor: tracks, clips, playhead, drag/trim with snapping, undo/redo            | ✅ M2  |
| Chapters: add from templates, reorder, duplicate, save as template                      | ✅ M3  |
| Course layer ("all chapters" tracks), course progress bar                               | ✅ M3  |
| Animations (fade, slide, zoom), highlights (marker, frame, arrow, spotlight)            | ✅ M3  |
| Chapter markers and table of contents in the player                                     | ✅ M3  |
| SCORM 1.2 and 2004 export with resume and completion, LMS simulation in the preview     | ✅ M4  |
| Desktop app (Tauri), documentation                                                      | M5     |

## Repository layout

```
packages/format       MIT    Course format: types, JSON schema, validation, migrations
packages/player       MIT    Player runtime that ships inside every exported course
packages/scorm-runtime MIT   SCORM 1.2/2004 runtime, ships inside every exported course
packages/editor-core  AGPL   Editor model: commands, undo/redo, snapping, project files
packages/exporter     AGPL   Builds SCORM packages
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

- Add text, boxes and shapes with the toolbar; import images, video, audio and
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
- **Preview** plays the course in the real player. With _LMS simulation_
  it also shows what an LMS would store.
- **Export SCORM…** creates a package for your LMS, see
  [docs/scorm.md](docs/scorm.md).

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
  "formatVersion": 1,
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
[`packages/format/schema/course.v1.schema.json`](packages/format/schema/course.v1.schema.json).
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
