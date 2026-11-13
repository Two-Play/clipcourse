# Testing with a real LMS

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

These tests are not part of CI, because they need a running Moodle.

## ILIAS

Not automated yet: there is no official ILIAS container image. To test
manually, install ILIAS (for example with your organisation's test
instance), create a "SCORM/AICC learning module" from an exported package
and check launch, resume and learning progress.

## SCORM Cloud

[SCORM Cloud](https://cloud.scorm.com) (Rustici) is the reference player
for SCORM conformance. With a free account, upload an exported package
under _Library → Add content_, launch it, and check the registration's
status, bookmark and suspend data. It also reports manifest problems.
