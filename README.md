# Clipcourse

Clipcourse is an open-source SCORM course generator. You build a course the
way you would cut a video: every chapter has its own timeline with tracks and
clips. Text, images, shapes, boxes and optional video or audio clips appear
and disappear at exact times. The timeline itself is the beat, so you don't
need a video or audio track.

> **Status:** early development. Milestone 1 (course format and player) is
> done. The editor and the SCORM export are still in progress.

## Features

| Feature                                                                                 | Status |
| --------------------------------------------------------------------------------------- | ------ |
| Versioned JSON course format (course → chapters → timeline)                             | ✅ M1  |
| Deterministic player: seek, pause and chapter jumps always show the right picture       | ✅ M1  |
| Chapter transitions: wait for _Continue_ (default) or continue automatically            | ✅ M1  |
| Course layer: elements shown in every chapter                                           | ✅ M1  |
| Progress: bookmark and seen chapters, compact enough for SCORM 1.2                      | ✅ M1  |
| Accessibility: keyboard control, WebVTT captions, alt text, screen reader announcements | ✅ M1  |
| Timeline editor (tracks, clips, playhead, drag/resize, undo/redo)                       | M2     |
| Chapter management, animations, highlights, table of contents                           | M3     |
| SCORM 1.2 and 2004 export                                                               | M4     |
| Desktop app (Tauri), documentation                                                      | M5     |

## Repository layout

```
packages/format   MIT    Course format: types, JSON schema, validation, migrations
packages/player   MIT    Player runtime that ships inside every exported course
apps/player-demo  MIT    Development harness that plays the example courses
examples/         CC0    Example courses
```

## Try it

Requirements: Node.js 22 or newer and pnpm 10.

```bash
pnpm install
pnpm --filter @clipcourse/player-demo dev
```

Open http://localhost:4317. The demo plays [`examples/welcome`](examples/welcome).

### Player keyboard shortcuts

| Key       | Action                                                 |
| --------- | ------------------------------------------------------ |
| Space / K | Play or pause (Space on a button activates the button) |
| ← / →     | Back or forward 5 seconds                              |
| N / P     | Next or previous chapter                               |
| C         | Captions on or off                                     |

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
