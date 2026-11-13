# Licensing

Clipcourse uses two licenses on purpose.

| Part                                                                  | Path                     | License       |
| --------------------------------------------------------------------- | ------------------------ | ------------- |
| Course format (types, schema, migrations)                             | `packages/format`        | MIT           |
| Player runtime                                                        | `packages/player`        | MIT           |
| SCORM runtime                                                         | `packages/scorm-runtime` | MIT           |
| Player demo / test harness                                            | `apps/player-demo`       | MIT           |
| Example courses and their media                                       | `examples`               | CC0-1.0       |
| Everything else (editor, editor core, exporter, desktop app, scripts) | all other paths          | AGPL-3.0-only |

Each MIT-licensed directory contains its own `LICENSE` file. Everything without
its own `LICENSE` file falls under the root [`LICENSE`](LICENSE) (GNU Affero
General Public License v3.0). Source files carry an `SPDX-License-Identifier`
header.

## Why

- **Exported courses are yours.** Every course exported by Clipcourse ships the
  player runtime. Because the runtime is MIT-licensed, you can distribute,
  sell and host exported courses under any terms you like. The AGPL of the
  editor does not extend to courses you create with it.
- **The editor stays open.** Improvements to the editor have to be shared when
  the editor is distributed or offered as a network service (AGPL-3.0).
- **Commercial license.** The copyright holder may offer the editor under a
  separate commercial license (dual licensing). To make that possible, every
  contribution requires agreeing to the [Contributor License Agreement](CLA.md).

## Third-party code

Only dependencies under permissive licenses (MIT, BSD-2-Clause, BSD-3-Clause,
ISC, Apache-2.0, 0BSD) are allowed in shipped code. Copyleft dependencies are
excluded even in the editor, because they would prevent dual licensing.
`pnpm licenses:check` enforces this in CI, and
[`THIRD_PARTY_LICENSES.md`](THIRD_PARTY_LICENSES.md) lists all production
dependencies. It is generated with `pnpm licenses:write`.
