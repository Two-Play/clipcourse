# Contributing to Clipcourse

Thanks for helping! Please read this page before opening a pull request.

## Contributor License Agreement (required)

Clipcourse is dual-licensed: AGPL-3.0 for the editor, MIT for the player
runtime, plus a possible commercial license for the editor (see
[LICENSING.md](LICENSING.md)). To keep that possible, every contributor must
agree to the [Contributor License Agreement](CLA.md) before their first pull
request is merged.

In short, you keep the copyright in your work and grant the maintainer a
license to use it, including the right to relicense it under commercial
terms. The CLA explains the details and how to agree. Pull requests without
an agreement cannot be merged.

## Development setup

Requirements: Node.js 22 or newer, pnpm 10.

```bash
pnpm install
pnpm test          # unit tests (Vitest)
pnpm typecheck
pnpm lint
pnpm test:e2e      # browser tests (Playwright); run `pnpm exec playwright install chromium` once
pnpm --filter @clipcourse/player-demo dev   # player demo with the example course
```

## Rules for code

- Code, comments, commit messages and documentation are written in English.
- Every source file starts with an SPDX header matching its directory's
  license (`MIT` in `packages/format`, `packages/player`,
  `packages/scorm-runtime`, `apps/player-demo`; `AGPL-3.0-only` elsewhere).
- The player must stay framework-free and must not gain runtime dependencies
  without discussion. It ships inside every exported course.
- The player is deterministic: what is visible depends only on the chapter and
  the timeline position. Do not add state that changes the picture outside of
  `evaluate()`.
- New dependencies must use a permissive license (MIT, BSD, ISC, Apache-2.0,
  0BSD). Copyleft dependencies (GPL, LGPL, AGPL, MPL, EUPL, CC-BY-SA) are not
  accepted. `pnpm licenses:check` runs in CI.
- Changes to the course format need a new format version and a migration in
  `packages/format/src/migrate.ts`.

## Pull requests

- Branch from `main`, open a pull request against `main`.
- CI (lint, typecheck, unit tests, e2e tests, license check, build) must be
  green before merging.
- Keep pull requests focused. Describe what changes for course authors and
  learners.
