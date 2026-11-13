// SPDX-License-Identifier: AGPL-3.0-only
import type { Project } from '@clipcourse/editor-core';
import { parseCourse } from '@clipcourse/format/validation';

/** Loads a bundled example course (served from /<name>/). */
export async function loadExample(name: string, base = location.href): Promise<Project> {
  const root = new URL(`/${name}/`, base);
  const response = await fetch(new URL('course.json', root));
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const course = parseCourse(await response.json());
  const files = new Map<string, Uint8Array>();
  await Promise.all(
    Object.values(course.assets)
      .filter((a) => !/^https?:\/\//.test(a.src))
      .map(async (asset) => {
        const r = await fetch(new URL(asset.src, root));
        if (!r.ok) throw new Error(`Missing ${asset.src}`);
        files.set(asset.src, new Uint8Array(await r.arrayBuffer()));
      }),
  );
  return { course, files };
}
