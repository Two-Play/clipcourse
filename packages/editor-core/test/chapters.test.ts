// SPDX-License-Identifier: AGPL-3.0-only
import { produce } from 'immer';
import { describe, expect, test } from 'vitest';
import * as cmd from '../src/commands.js';
import { COURSE_LAYER_DURATION, createClip, findClip, uniqueIdFactory } from '../src/document.js';
import { createEditorStore } from '../src/store.js';
import { builtInTemplates, instantiateTemplate, templateFromChapter } from '../src/templates.js';
import { boxClip, expectValid, testCourse } from './helpers.js';

const run = (recipe: cmd.Recipe, course = testCourse()) => {
  const next = produce(course, recipe);
  expectValid(next);
  return next;
};

describe('chapters', () => {
  test('add, move, duplicate and remove', () => {
    const newId = uniqueIdFactory(testCourse());
    let c = run(
      cmd.addChapter(
        { id: 'ch3', title: 'Three', duration: 1000, transition: { mode: 'wait' }, tracks: [] },
        0,
      ),
    );
    expect(c.chapters.map((x) => x.id)).toEqual(['ch3', 'ch1', 'ch2']);
    c = run(cmd.moveChapter('ch3', 99), c);
    expect(c.chapters.map((x) => x.id)).toEqual(['ch1', 'ch2', 'ch3']);
    let copyId = '';
    c = run(
      cmd.duplicateChapter('ch1', newId, (id) => (copyId = id)),
      c,
    );
    expect(c.chapters[1]!.id).toBe(copyId);
    expect(c.chapters[1]!.title).toBe('One (copy)');
    expect(c.chapters[1]!.tracks[0]!.clips).toHaveLength(2);
    expect(c.chapters[1]!.tracks[0]!.clips[0]!.id).not.toBe('a');
    c = run(cmd.removeChapter('ch1'), c);
    expect(c.chapters).toHaveLength(3);
  });

  test('cannot remove the last chapter', () => {
    let c = run(cmd.removeChapter('ch2'));
    expect(() => produce(c, cmd.removeChapter('ch1'))).toThrow(/at least one/);
    c = run(cmd.setChapterProps('ch1', { title: 'Only' }), c);
    expect(c.chapters).toHaveLength(1);
  });
});

describe('markers', () => {
  test('add, update, remove; kept sorted and inside the chapter', () => {
    let c = run(cmd.addMarker('ch1', { id: 'm2', time: 5000, title: 'B' }));
    c = run(cmd.addMarker('ch1', { id: 'm1', time: 1000, title: 'A' }), c);
    expect(c.chapters[0]!.markers!.map((m) => m.id)).toEqual(['m1', 'm2']);
    c = run(cmd.updateMarker('ch1', 'm1', { time: 99999, title: 'Late' }), c);
    expect(c.chapters[0]!.markers!.map((m) => [m.id, m.time])).toEqual([
      ['m2', 5000],
      ['m1', 10000],
    ]);
    c = run(cmd.removeMarker('ch1', 'm1'), c);
    c = run(cmd.removeMarker('ch1', 'm2'), c);
    expect('markers' in c.chapters[0]!).toBe(false);
  });
});

describe('course layer', () => {
  test('tracks and clips in the course layer', () => {
    let c = run(cmd.addCourseTrack('foreground', { id: 'cl', name: 'Logo' }));
    c = run(cmd.addClip('cl', { ...boxClip('logo', 0, COURSE_LAYER_DURATION) }), c);
    expect(findClip(c, 'logo')).toMatchObject({
      chapterIndex: -1,
      scope: { kind: 'course', layer: 'foreground' },
    });
    // Course layer clips do not stretch chapters.
    expect(c.chapters[0]!.duration).toBe(10000);
    c = run(cmd.addCourseTrack('background', { id: 'bg' }), c);
    c = run(cmd.moveClip('logo', 100, 'bg'), c);
    expect(findClip(c, 'logo')!.track.id).toBe('bg');
    expect(() => produce(c, cmd.moveClip('logo', 0, 't1'))).toThrow();
    c = run(cmd.resizeClip('logo', 'end', 5000), c);
    c = run(cmd.removeClips(['logo']), c);
    c = run(cmd.removeTrack('bg'), c);
    c = run(cmd.removeTrack('cl'), c);
    c = run(cmd.pruneCourseLayer(), c);
    expect('courseLayer' in c).toBe(false);
  });

  test('undo works across course layer edits', () => {
    const store = createEditorStore(testCourse());
    store.getState().execute('Add', cmd.addCourseTrack('foreground', { id: 'cl' }));
    store.getState().undo();
    expect(store.getState().course).toEqual(testCourse());
  });
});

describe('templates', () => {
  const files = new Map([
    ['assets/v.mp4', new Uint8Array([1, 2, 3])],
    ['assets/i.png', new Uint8Array([4])],
  ]);

  test('round trip into another project with clashing names', () => {
    const template = templateFromChapter(
      { course: testCourse(), files },
      'ch1',
      'Video chapter',
      'tpl',
    );
    expect(Object.keys(template.assets)).toEqual(['vid']);
    expect(template.files).toHaveLength(1);

    // Target project already has a different "vid" asset at the same path.
    const target = {
      course: testCourse(),
      files: new Map([['assets/v.mp4', new Uint8Array([9])]]),
    };
    const result = instantiateTemplate(target, template, uniqueIdFactory(target.course));
    expect(Object.keys(result.assets)).toEqual(['vid_2']);
    expect(result.assets.vid_2!.src).toBe('assets/v-2.mp4');
    expect([...result.files.keys()]).toEqual(['assets/v-2.mp4']);
    const video = result.chapter.tracks[1]!.clips[0]!;
    expect(video.type === 'video' && video.assetId).toBe('vid_2');

    const next = run((d) => {
      Object.assign(d.assets, result.assets);
      cmd.addChapter(result.chapter)(d);
    }, target.course);
    expect(next.chapters).toHaveLength(3);
  });

  test('reuses identical files', () => {
    const template = templateFromChapter({ course: testCourse(), files }, 'ch1', 'T', 'tpl');
    const result = instantiateTemplate(
      { course: testCourse(), files },
      template,
      uniqueIdFactory(testCourse()),
    );
    expect(result.assets).toEqual({});
    expect(result.files.size).toBe(0);
  });

  test('built-in templates are valid chapters', () => {
    const course = testCourse();
    for (const template of builtInTemplates(course)) {
      const { chapter } = instantiateTemplate(
        { course, files: new Map() },
        template,
        uniqueIdFactory(course),
      );
      run(cmd.addChapter(chapter), course);
    }
  });

  test('new clip types have valid defaults', () => {
    const course = testCourse();
    run(cmd.addClip('t3', createClip(course, 'highlight', { id: 'h', start: 0 })));
    run(cmd.addClip('t3', createClip(course, 'progress', { id: 'p', start: 0 })));
  });
});
