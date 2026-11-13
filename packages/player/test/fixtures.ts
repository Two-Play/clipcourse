// SPDX-License-Identifier: MIT
import type { Chapter, Clip, Course } from '@clipcourse/format';

export function box(id: string, start: number, duration: number): Clip {
  return { id, type: 'box', start, duration, frame: { x: 0, y: 0, width: 10, height: 10 } };
}

export function chapter(
  id: string,
  duration: number,
  clips: Clip[],
  mode: 'wait' | 'auto' = 'wait',
): Chapter {
  return {
    id,
    title: `Chapter ${id}`,
    duration,
    transition: { mode },
    tracks: [{ id: `${id}_t`, clips }],
  };
}

export function course(chapters: Chapter[], extra: Partial<Course> = {}): Course {
  return {
    formatVersion: 3,
    id: 'c',
    title: 'Course',
    language: 'en',
    stage: { width: 1920, height: 1080, background: '#000' },
    assets: {},
    chapters,
    ...extra,
  };
}
