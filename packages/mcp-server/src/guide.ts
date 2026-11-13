// SPDX-License-Identifier: AGPL-3.0-only
/** Short guide to the course format, served as an MCP resource. */
export const FORMAT_GUIDE = `# Clipcourse course format (version 3)

## Structure
- A **course** has a title, a language, a **stage** (logical size, default 1920×1080, scaled to fit the screen) and **chapters**.
- Each **chapter** has its own timeline starting at 0 ms, a duration, and a transition at the end:
  "wait" (show a Continue button, default) or "auto" (go on by itself).
- A chapter has **tracks**. The first track is the back-most layer; tools that list tracks show the front-most first.
- **Clips** sit on tracks with a start and a duration (ms). Clips on one track never overlap.
- The optional **course layer** has background and foreground tracks shown in every chapter
  (logo, background, progress bar). Give such clips a long duration so they last to the end of every chapter.
- **Markers** are jump points inside a chapter; the player lists them in its table of contents.

## Clip types (frame = x, y, width, height in stage pixels)
| type | key properties |
| --- | --- |
| text | text, role (heading/paragraph), style {fontSize, color, align, verticalAlign, fontWeight} |
| box | fill, stroke, strokeWidth, radius, padding, text, style |
| shape | shape (rect/ellipse/line/arrow), fill, stroke, strokeWidth, radius |
| image | assetId, alt, fit (contain/cover/fill) |
| video | assetId, captionsAssetId, fit, volume, muted, trimStart |
| audio | assetId, captionsAssetId, volume, trimStart (no frame) |
| highlight | kind (marker/frame/arrow/spotlight), color, strokeWidth, radius, pulse, label |
| progress | fill, background, radius (course progress bar) |
| question | question (see below); playback stops at the clip's start until the learner answers |

Every visual clip can have animations: { in: {type, duration}, out: {type, duration} } with type fade, slide (direction) or zoom.

## Questions and scoring
- Two ways to ask: a **question clip** on a chapter timeline (the video or animation pauses for it),
  or a **quiz chapter** (set_quiz): questions one after another, then a result screen; optional shuffle and retries.
- Kinds: single, multiple, text (accepted answers), order (items in the correct order, shown shuffled),
  match (pairs, right sides shown shuffled), hotspot (image with rectangular areas, coordinates 0–1).
- Per question: points (default 1), scored (false = practice), attempts (default 1, 0 = until correct),
  showSolution (default true), feedback { correct, incorrect }.
- The LMS gets every answer as an interaction and the score in percent of all scored points.
  With a passing score (set_assessment) it also gets passed/failed once all scored questions are answered.
- A chapter counts as seen only when its questions are done. Completion still means: all chapters seen.
- Write one clear question per item, plausible wrong answers of similar length, and feedback that teaches
  (why the answer is right or wrong). Hotspot questions need area labels and alt text: keyboard and screen
  reader users answer by choosing a labelled area.

## Good practice
- Learners must be able to read text: show it for at least 1 s plus 0.4 s per word.
- Font size 48 and up for body text on a 1920×1080 stage; headings 72–110.
- Keep contrast at least 4.5:1 (3:1 for large or bold text).
- Images need alternative text (or alt "" if decorative); video and audio with speech need captions (.vtt).
- Use markers in long chapters; keep chapters short (1–3 minutes).
- A chapter counts as seen when its timeline played to the end (and its questions are done); the course is complete when all chapters are seen.
- Run review_course before export_scorm.
`;
