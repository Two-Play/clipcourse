# MCP server

`clipcourse-mcp` lets AI assistants that support the
[Model Context Protocol](https://modelcontextprotocol.io) build, review and
export Clipcourse courses. Examples are Claude Desktop, Claude Code and
other MCP clients.

The assistant works on **project folders** (`course.json` plus `assets/`)
inside folders you allow with `--root`. It cannot read or write anything
else. Every change is saved immediately and can be undone (`undo`).

## Setup

Build the server once (from the repository):

```bash
pnpm install
pnpm --filter @clipcourse/mcp-server build
```

**Claude Code:**

```bash
claude mcp add clipcourse -- node /path/to/clipcourse/packages/mcp-server/dist/clipcourse-mcp.js --root ~/Courses
```

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "clipcourse": {
      "command": "node",
      "args": [
        "/path/to/clipcourse/packages/mcp-server/dist/clipcourse-mcp.js",
        "--root",
        "/home/you/Courses"
      ]
    }
  }
}
```

Then ask, for example: _"Create a course 'Fire safety' with three short
chapters, add a title and key points to each, check it and export it for
Moodle."_

## Tools

| Area     | Tools                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Projects | `list_projects`, `create_project`, `get_course` (outline or JSON), `set_course`, `list_templates`                   |
| Chapters | `add_chapter` (optionally from a template), `update_chapter`, `move_chapter`, `duplicate_chapter`, `delete_chapter` |
| Markers  | `add_marker`, `update_marker`, `delete_marker`                                                                      |
| Tracks   | `add_track` (chapter or course layer), `update_track`, `delete_track`                                               |
| Clips    | `add_clip`, `update_clip`, `move_clip`, `trim_clip`, `split_clip`, `duplicate_clip`, `delete_clips`                 |
| Media    | `import_media` (local file inside a root), `update_media`, `delete_media`                                           |
| Review   | `review_course`: validity, alt text, captions, contrast, font size, reading time, structure                         |
| History  | `undo`, `redo`                                                                                                      |
| Export   | `export_scorm` (SCORM 1.2 or 2004)                                                                                  |

Resources: `clipcourse://format/guide` (short format guide) and
`clipcourse://format/schema` (JSON schema).

All edits go through the same operations as the editor: documents stay
valid, clips on a track never overlap, and an edit that would break the
course is rejected with an explanation.

## Security

- Only paths inside the `--root` folders are allowed. Paths are resolved
  with `realpath`, so neither `..` nor symbolic links can escape.
- Media files are limited to 500 MB and to image, video, audio and `.vtt`
  types.
- Project files are written atomically. The server never deletes files.

HTTP transport, downloads from URLs and live editing in the open editor
follow in the next steps.
