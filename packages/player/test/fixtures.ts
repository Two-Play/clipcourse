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
    formatVersion: 4,
    id: 'c',
    title: 'Course',
    language: 'en',
    stage: { width: 1920, height: 1080, background: '#000' },
    assets: {},
    chapters,
    ...extra,
  };
}

const frame = { x: 0, y: 0, width: 100, height: 50 };

/** Main chapter with a branch button, a show/hide toggle and a marker jump. */
export function branchingCourse(extra: Partial<Course> = {}): Course {
  const clips: Clip[] = [
    {
      id: 'toSide',
      type: 'button',
      text: 'Side branch',
      start: 0,
      duration: 4000,
      frame,
      action: { type: 'goToChapter', chapterId: 'side' },
    },
    {
      id: 'reveal',
      type: 'box',
      text: 'Show tip',
      start: 0,
      duration: 4000,
      frame,
      action: { type: 'setClipVisibility', clipId: 'tip', visible: 'toggle', pause: true },
    },
    { ...box('tip', 0, 4000), startsHidden: true } as Clip,
    {
      id: 'toMarker',
      type: 'button',
      text: 'Later part',
      start: 0,
      duration: 4000,
      frame,
      action: { type: 'goToMarker', chapterId: 'main', markerId: 'm' },
    },
  ];
  return course(
    [
      { ...chapter('main', 4000, clips), markers: [{ id: 'm', time: 3000, title: 'Later' }] },
      { ...chapter('side', 1000, []), optional: true },
      { ...chapter('end', 1000, []), goal: true },
    ],
    extra,
  );
}
