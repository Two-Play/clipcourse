// SPDX-License-Identifier: MIT
import { describe, expect, test } from 'vitest';
import { Controller } from '../src/core/controller.js';
import { evaluate } from '../src/core/evaluate.js';
import {
  courseProgressMeasure,
  createGlossaryMatcher,
  isCourseComplete,
  visibilityTargets,
} from '../src/core/interactions.js';
import { decodeProgress, encodeProgress } from '../src/core/progress.js';
import { branchingCourse } from './fixtures.js';

describe('completion rule', () => {
  test('required: optional chapters do not count', () => {
    const c = branchingCourse();
    expect(isCourseComplete(c, [true, false, false])).toBe(false);
    expect(isCourseComplete(c, [true, false, true])).toBe(true);
    expect(courseProgressMeasure(c, [true, true, false])).toBe(0.5);
  });

  test('goal: reaching any goal chapter completes the course', () => {
    const c = branchingCourse({ completion: { mode: 'goal' } });
    expect(isCourseComplete(c, [true, true, false])).toBe(false);
    expect(isCourseComplete(c, [false, false, true])).toBe(true);
    expect(courseProgressMeasure(c, [false, false, true])).toBe(1);
  });

  test('the controller completes by the rule, skipping optional chapters', () => {
    const controller = new Controller(branchingCourse());
    const events: string[] = [];
    controller.subscribe((_s, e) => events.push(...e.map((x) => x.type)));
    controller.play();
    controller.advance(4000); // main seen
    controller.goToChapter(2);
    controller.play();
    controller.advance(1000); // end seen, side never visited
    expect(controller.state.complete).toBe(true);
    expect(events).toContain('complete');
  });
});

describe('actions', () => {
  test('jumps start playing the target chapter or marker', () => {
    const controller = new Controller(branchingCourse());
    expect(controller.runAction({ type: 'goToChapter', chapterId: 'side' })).toBe(true);
    expect(controller.state).toMatchObject({ chapterIndex: 1, time: 0, status: 'playing' });
    controller.runAction({ type: 'goToMarker', chapterId: 'main', markerId: 'm' });
    expect(controller.state).toMatchObject({ chapterIndex: 0, time: 3000, status: 'playing' });
    expect(controller.runAction({ type: 'goToChapter', chapterId: 'nope' })).toBe(false);
  });

  test('show/hide changes the scene, pauses if asked and survives seeking', () => {
    const c = branchingCourse();
    const controller = new Controller(c);
    const ids = () =>
      evaluate(c, 0, controller.state.time, { visibility: controller.state.visibility }).clips.map(
        (a) => a.clip.id,
      );
    expect(ids()).not.toContain('tip');
    controller.play();
    controller.runAction({
      type: 'setClipVisibility',
      clipId: 'tip',
      visible: 'toggle',
      pause: true,
    });
    expect(controller.state.status).toBe('paused');
    expect(ids()).toContain('tip');
    controller.seek(2000);
    controller.seek(500);
    expect(ids()).toContain('tip');
    controller.setClipVisibility('tip', 'toggle');
    expect(ids()).not.toContain('tip');
  });
});

describe('progress v3', () => {
  test('stores clip visibility next to answers and seen chapters', () => {
    const c = branchingCourse();
    const layout = {
      questionIds: [],
      visibilityTargets: visibilityTargets(c).map((id) => ({ id, shown: false })),
    };
    expect(layout.visibilityTargets.map((t) => t.id)).toEqual(['tip']);
    const controller = new Controller(c);
    controller.setClipVisibility('tip', 'show');
    const encoded = encodeProgress(controller.progress, layout);
    expect(encoded).toBe('3~0~0~0~~~1');
    const decoded = decodeProgress(encoded, 3, layout)!;
    expect(decoded.visibility).toEqual({ tip: true });
    expect(new Controller(c, decoded).state.visibility).toEqual({ tip: true });
    // Courses without show/hide actions keep the shorter formats.
    expect(encodeProgress({ chapterIndex: 0, time: 0, seen: [true] }, { questionIds: [] })).toBe(
      '1~0~0~1',
    );
    expect(decodeProgress('3~0~0~0~~~zz', 3, layout)).toBeNull();
  });
});

describe('glossary', () => {
  const split = createGlossaryMatcher([
    { id: 'lms', term: 'LMS', definition: 'Learning management system' },
    { id: 'scorm', term: 'SCORM', variants: ['SCORM package'], definition: 'A standard' },
  ])!;

  test('marks whole words once per entry, longest form first, ignoring case', () => {
    const parts = split('Upload the scorm package to your LMS. The LMS (or LMSes) runs SCORM.');
    expect(parts).toEqual([
      'Upload the ',
      { entry: expect.objectContaining({ id: 'scorm' }), text: 'scorm package' },
      ' to your ',
      { entry: expect.objectContaining({ id: 'lms' }), text: 'LMS' },
      '. The LMS (or LMSes) runs SCORM.',
    ]);
  });

  test('works with letters outside ASCII and special characters in terms', () => {
    const m = createGlossaryMatcher([
      { id: 'a', term: 'Übung', definition: 'x' },
      { id: 'b', term: 'C++', definition: 'y' },
    ])!;
    expect(
      m('Eine Übungsaufgabe und eine Übung in C++.').filter((p) => typeof p !== 'string'),
    ).toEqual([
      { entry: expect.objectContaining({ id: 'a' }), text: 'Übung' },
      { entry: expect.objectContaining({ id: 'b' }), text: 'C++' },
    ]);
    expect(createGlossaryMatcher([])).toBeNull();
  });
});
