# SCORM export

Clipcourse exports a course as a SCORM package: a `.zip` file you upload to
your LMS. In the editor, click **Export SCORM…** and pick a version.

| Version                     | Use it when                                                         |
| --------------------------- | ------------------------------------------------------------------- |
| **SCORM 1.2** (recommended) | Almost every LMS supports it. Moodle, ILIAS, most commercial LMS.   |
| **SCORM 2004 4th Edition**  | Your LMS requires 2004, or you want it to show progress in percent. |

## What the LMS receives

| Information                   | SCORM 1.2                                                                                     | SCORM 2004                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Started                       | `cmi.core.lesson_status = incomplete`                                                         | `cmi.completion_status = incomplete`         |
| Completed (all chapters seen) | `cmi.core.lesson_status = completed`                                                          | `cmi.completion_status = completed`          |
| Progress                      | –                                                                                             | `cmi.progress_measure` (seen chapters / all) |
| Bookmark (current chapter)    | `cmi.core.lesson_location` (chapter id)                                                       | `cmi.location` (chapter id)                  |
| Resume data                   | `cmi.suspend_data` (chapter, position, seen chapters; < 100 characters even for 200 chapters) | same                                         |
| Time spent                    | `cmi.core.session_time`                                                                       | `cmi.session_time`                           |
| Exit                          | `cmi.core.exit = suspend`                                                                     | `cmi.exit = suspend`                         |

A chapter counts as seen when its timeline has played to the end. Seeking
to the end does not count. The course is completed when all chapters have
been seen. Completion is committed to the LMS immediately; the bookmark at
least every 15 seconds, at every chapter end and when the learner leaves.

Clipcourse does not report a score (there are no quizzes yet). In SCORM 2004
packages, `completionSetByContent` is set so the LMS waits for the course
to report completion.

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
"Learning objects". The _Highest grade_ method shows 0, because the course
reports no score.

**ILIAS:** upload it as a "SCORM/AICC learning module". Completion
should appear in the learning progress if it is set to "Status of the SCORM
items". This has not been verified with a real ILIAS yet, see
[lms-testing.md](lms-testing.md).

## Testing

- **In the editor:** _Preview_ → _LMS simulation_ runs the course against a
  simulated SCORM 1.2 or 2004 LMS. It shows status, bookmark, progress and
  suspend data. _Close and relaunch_ checks resuming.
- **Automated (CI):** the editor e2e tests export packages and run them in an
  LMS-like frame with a simulated API, for both versions.
- **Real Moodle (local):** see [lms-testing.md](lms-testing.md). Verified
  with Moodle 5.3.1 for both versions: launch, media, resume, completion.
