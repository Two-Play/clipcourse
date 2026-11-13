# Testing with a real LMS

Verified so far: **Moodle 5.3.1** and **ILIAS 10.12**, SCORM 1.2 and 2004
each: launch, media, a design theme, resume (including a clip revealed by a button), a quiz
chapter (score, passed/failed, interactions) and completion with an
unvisited optional chapter.

## Moodle (automated)

Requirements: Podman or Docker, about 2 GB disk space.

```bash
scripts/lms/moodle-up.sh
```

This downloads the official Moodle release and checks its SHA-256 checksum.
It starts MariaDB and the official `moodlehq/moodle-php-apache` image and
installs Moodle on <http://localhost:8081>, reachable only from this
machine. Generated test credentials are stored in `.lms/credentials.env`,
which git ignores.

Run the tests:

```bash
set -a; source .lms/credentials.env; set +a
pnpm --filter @clipcourse/editor test:lms
```

For both SCORM 1.2 and 2004, each test does the following:

1. creates a course and uploads an exported package as a SCORM activity
2. launches it, checks that media loads, plays chapter 1 and leaves
3. relaunches, checks that the course resumes at the right chapter, and plays to the end
4. checks in the attempt report that Moodle recorded the attempt as completed

Stop Moodle with `scripts/lms/moodle-up.sh down`; the data stays in `.lms/`.
To start over, also delete `.lms/`.

These tests are not part of CI, because they need a running LMS.

## ILIAS (automated)

```bash
scripts/lms/ilias-up.sh
```

This starts ILIAS 10 on <http://localhost:8082>. There is no official ILIAS
container image, so the script uses the community image
[`srsolutions/ilias`](https://github.com/srsolutionsag/docker-ilias) from
sr solutions, an ILIAS service provider. The database uses `utf8`, not
`utf8mb4`, because the ILIAS database dump exceeds InnoDB's row size
otherwise. Credentials go to `.lms/ilias.env`. The script also turns on
learning progress: without it, ILIAS runs SCORM 1.2 modules in "no-credit"
mode and silently drops every score and status the course sends.

```bash
set -a; source .lms/ilias.env; set +a
pnpm --filter @clipcourse/editor test:lms
```

The ILIAS tests create a "Learning Module SCORM" for each version, then
launch, resume, answer the quiz (one answer right, one wrong: score 50,
passing score 50 %) and complete it. They check the status in the module's
_Tracking Data → Basic report for chapters (SCO)_: `passed` for 1.2,
`completed` and `passed` for 2004. The Moodle tests check status and score
in the attempt report, and for 2004 also `cmi.success_status` and the
interactions in the track details. Stop ILIAS with
`scripts/lms/ilias-up.sh down`.

Both test suites skip themselves when their URL variable is not set, so
`source` one or both credential files.

## SCORM Cloud

[SCORM Cloud](https://cloud.scorm.com) (Rustici) is the reference player
for SCORM conformance. With a free account, upload an exported package
under _Library → Add content_, launch it, and check the registration's
status, bookmark and suspend data. It also reports manifest problems.
