// SPDX-License-Identifier: AGPL-3.0-only
import type { Clip, Course } from '@clipcourse/format';
import { validateCourse } from '@clipcourse/format/validation';
import { expect } from 'vitest';

export function boxClip(id: string, start: number, duration: number): Clip {
  return { id, type: 'box', start, duration, frame: { x: 0, y: 0, width: 10, height: 10 } };
}

export function testCourse(): Course {
  return {
    formatVersion: 3,
    id: 'c',
    title: 'Course',
    language: 'en',
    stage: { width: 1920, height: 1080, background: '#000' },
    assets: {
      vid: { kind: 'video', src: 'assets/v.mp4', duration: 20000 },
      img: { kind: 'image', src: 'assets/i.png' },
    },
    chapters: [
      {
        id: 'ch1',
        title: 'One',
        duration: 10000,
        transition: { mode: 'wait' },
        tracks: [
          { id: 't1', clips: [boxClip('a', 0, 2000), boxClip('b', 4000, 2000)] },
          {
            id: 't2',
            clips: [
              {
                id: 'v',
                type: 'video',
                assetId: 'vid',
                start: 1000,
                duration: 5000,
                frame: { x: 0, y: 0, width: 10, height: 10 },
              },
            ],
          },
        ],
      },
      {
        id: 'ch2',
        title: 'Two',
        duration: 5000,
        transition: { mode: 'auto' },
        tracks: [{ id: 't3', clips: [] }],
      },
    ],
  };
}

export function expectValid(course: Course) {
  const result = validateCourse(course);
  if (!result.ok) throw new Error(JSON.stringify(result.issues, null, 2));
  expect(result.ok).toBe(true);
}

export function clipById(course: Course, id: string): Clip {
  for (const chapter of course.chapters)
    for (const track of chapter.tracks)
      for (const clip of track.clips) if (clip.id === id) return clip;
  throw new Error(`no clip ${id}`);
}

export function trackOf(course: Course, clipId: string): string {
  for (const chapter of course.chapters)
    for (const track of chapter.tracks)
      if (track.clips.some((c) => c.id === clipId)) return track.id;
  throw new Error(`no clip ${clipId}`);
}
