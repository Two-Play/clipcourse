// SPDX-License-Identifier: AGPL-3.0-only
/** Builds the SCORM test package used by the LMS tests. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportScorm, type ScormVersion } from '@clipcourse/exporter';
import type { Course } from '@clipcourse/format';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const runtimeFile = `${root}packages/scorm-runtime/dist/clipcourse-runtime.iife.js`;

export function testCourse(id: string): Course {
  const text = (cid: string, value: string) => ({
    id: cid,
    type: 'text' as const,
    text: value,
    role: 'heading' as const,
    start: 0,
    duration: 1500,
    frame: { x: 160, y: 400, width: 1600, height: 200 },
    style: { fontSize: 96, color: '#ffffff', align: 'center' as const },
  });
  return {
    formatVersion: 2,
    id,
    title: `Clipcourse LMS test ${id}`,
    language: 'en',
    stage: { width: 1920, height: 1080, background: '#101522' },
    assets: { logo: { kind: 'image', src: 'assets/logo.svg', mime: 'image/svg+xml', alt: 'Logo' } },
    chapters: [
      {
        id: 'one',
        title: 'First chapter',
        duration: 1500,
        transition: { mode: 'wait' },
        tracks: [
          { id: 't1', clips: [text('c1', 'Chapter one')] },
          {
            id: 't2',
            clips: [
              {
                id: 'img',
                type: 'image',
                assetId: 'logo',
                start: 0,
                duration: 1500,
                frame: { x: 860, y: 100, width: 200, height: 200 },
              },
            ],
          },
        ],
      },
      {
        id: 'two',
        title: 'Second chapter',
        duration: 1500,
        transition: { mode: 'wait' },
        tracks: [{ id: 't3', clips: [text('c2', 'Chapter two')] }],
      },
    ],
  };
}

export function buildPackage(version: ScormVersion, id: string): Buffer {
  if (!existsSync(runtimeFile)) {
    throw new Error('Build the runtime first: pnpm --filter @clipcourse/scorm-runtime build');
  }
  const files = new Map([
    ['assets/logo.svg', new Uint8Array(readFileSync(`${root}examples/welcome/assets/logo.svg`))],
  ]);
  const result = exportScorm(
    { course: testCourse(id), files },
    { version, runtime: readFileSync(runtimeFile, 'utf8') },
  );
  return Buffer.from(result.zip);
}
