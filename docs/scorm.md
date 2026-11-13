# SCORM export

Clipcourse exports a course as a SCORM package: a `.zip` file you upload to
your LMS. In the editor, click **Export SCORM…** and pick a version.

| Version                     | Use it when                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| **SCORM 1.2** (recommended) | Almost every LMS supports it. Moodle, ILIAS, most commercial LMS.   |
| **SCORM 2004 4th Edition**  | Your LMS requires 2004, or you want it to show progress in percent. |

## What the LMS receives

| Information                            | SCORM 1.2                                                                                      | SCORM 2004                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Started                                | `cmi.core.lesson_status = incomplete`                                                          | `cmi.completion_status = incomplete`                                          |
| Completed (all chapters seen)          | `cmi.core.lesson_status = completed`                                                           | `cmi.completion_status = completed`                                           |
| Progress                               | –                                                                                              | `cmi.progress_measure` (seen chapters / all)                                  |
| Bookmark (current chapter)             | `cmi.core.lesson_location` (chapter id)                                                        | `cmi.location` (chapter id)                                                   |
| Resume data                            | `cmi.suspend_data` (chapter, position, seen chapters; < 100 characters even for 200 chapters)  | same                                                                          |
| Time spent                             | `cmi.core.session_time`                                                                        | `cmi.session_time`                                                            |
| Exit                                   | `cmi.core.exit = suspend` (set at start, so it survives a lost final call)                     | `cmi.exit = suspend`                                                          |
| Score (courses with questions)         | `cmi.core.score.raw` (0–100, percent of all scored points), `min` 0, `max` 100                 | `cmi.score.raw`, `cmi.score.scaled` (0–1), `min`, `max`                       |
| Passed / failed (with a passing score) | `cmi.core.lesson_status = passed / failed` once the course is completed                        | `cmi.success_status = passed / failed` once all scored questions are answered |
| Every answer                           | `cmi.interactions.n.*`: id, type, `student_response`, correct pattern, result, weighting, time | same with `learner_response`, `timestamp`, `description`                      |

A chapter counts as seen when its timeline has played to the end. Seeking
to the end does not count. The course is completed when all chapters have
been seen. Completion is committed to the LMS immediately; the bookmark at
least every 15 seconds, at every chapter end and when the learner leaves.

Questions (question clips and quiz chapters) add a score. The score is the
percentage of the points of all scored questions; practice questions
(`scored: false`) do not count. The score is sent after every answer. With a
passing score (_Score the course_ in the course properties), the LMS also
gets passed or failed. SCORM 1.2 has only one status field, so it shows
`passed`/`failed` instead of `completed` once all chapters are seen. A
chapter with questions counts as seen only when its questions are done.

Interaction types: single and multiple choice → `choice`, text → `fill-in`,
order → `sequencing`, match → `matching`, hotspot → `other`. SCORM 1.2 only
allows single characters in choice and sequencing responses, so answers are
sent as letters (a = first choice); SCORM 2004 sends the answer ids.

In SCORM 2004 packages, `completionSetByContent` and
`objectiveSetByContent` are set so the LMS waits for the course to report
completion and success.

## Package contents

```
imsmanifest.xml        manifest (one SCO)
index.html             launch page
course.js              course data
clipcourse-runtime.js  player and SCORM runtime (MIT licensed)
assets/…               media
```

The package contains no third-party code. External media (http/https URLs)
are not included; the course then needs network access, and the export
shows a warning.

## LMS settings

**Moodle:** the defaults work. To show completion in the course and in
reports, set _Activity completion_ to "Students must… receive a status"
(completed). For a grade based on completion, set _Grading method_ to
"Learning objects". For courses with questions, _Highest grade_ uses the
score (0–100). Per-question answers are in the attempt report under
_Interactions_.

**ILIAS:** _Add New Object → Learning Module SCORM_, choose the version and
upload the package. ILIAS takes the title from the manifest. The learner's
status is under _Tracking Data_. For it to count in the learning progress,
set the learning progress mode to "Status of the SCORM items".
Learning progress must be enabled (_Administration → Learning Progress_):
without it ILIAS runs SCORM 1.2 modules in "no-credit" mode and silently
discards the score and the passed/failed status.

## Testing

- **In the editor:** _Preview_ → _LMS simulation_ runs the course against a
  simulated SCORM 1.2 or 2004 LMS. It shows status, bookmark, progress and
  suspend data. _Close and relaunch_ checks resuming.
- **Automated (CI):** the editor e2e tests export packages and run them in an
  LMS-like frame with a simulated API, for both versions.
- **Real LMS (local):** see [lms-testing.md](lms-testing.md). Verified with
  Moodle 5.3.1 and ILIAS 10.12 for both versions: launch, media, resume,
  completion.
