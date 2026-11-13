// SPDX-License-Identifier: AGPL-3.0-only
import type { ButtonClip, Clip, TextClip } from '@clipcourse/format';
import { expect, test } from 'vitest';
import { copyClips, pasteClips, setStageSize } from '../src/clipboard.js';
import { createEmptyCourse, findClip } from '../src/document.js';
import { executeOperation } from '../src/operations.js';
import { createEditorStore } from '../src/store.js';
import { expectValid } from './helpers.js';

function setup() {
  let n = 0;
  const newId = (p: string) => `${p}_${++n}`;
  const store = createEditorStore(createEmptyCourse(newId));
  const files = new Map<string, Uint8Array>();
  const run = (op: Parameters<typeof executeOperation>[1]) =>
    executeOperation({ store, files }, op);
  const course = () => store.getState().course;
  const intro = course().chapters[0]!.id;
  const other = run({ op: 'add_chapter', title: 'Other' }).created!.chapterId!;
  const hint = run({
    op: 'add_clip',
    type: 'text',
    chapterId: intro,
    start: 1000,
    props: { text: 'Hint', startsHidden: true },
  }).created!.clipId!;
  const show = run({
    op: 'add_clip',
    type: 'button',
    chapterId: intro,
    start: 2000,
    props: { text: 'Show', action: { type: 'setClipVisibility', clipId: hint, visible: 'show' } },
  }).created!.clipId!;
  const toOther = run({
    op: 'add_clip',
    type: 'button',
    chapterId: intro,
    start: 2000,
    props: { text: 'Next', action: { type: 'goToChapter', chapterId: other } },
  }).created!.clipId!;
  return { store, run, course, newId, intro, other, hint, show, toOther };
}

test('copy and paste into another chapter: new ids, relative timing, actions point at the copies', () => {
  const t = setup();
  const data = copyClips(t.course(), [t.hint, t.show, t.toOther])!;
  expect(data.items).toHaveLength(3);
  let pasted: string[] = [];
  t.store.getState().execute(
    'Paste',
    pasteClips(data, {
      chapterId: t.other,
      time: 5000,
      newId: t.newId,
      onPasted: (ids) => (pasted = ids),
    }),
  );
  expect(pasted).toHaveLength(3);
  const clips = pasted.map((id) => findClip(t.course(), id)!.clip);
  expect(clips.every((c) => !['hint', 'show'].includes(c.id))).toBe(true);
  expect(clips.map((c) => c.start).sort()).toEqual([5000, 6000, 6000]);
  const hintCopy = clips.find((c) => c.type === 'text') as TextClip;
  const showCopy = clips.find((c) => c.type === 'button' && c.text === 'Show') as ButtonClip;
  const nextCopy = clips.find((c) => c.type === 'button' && c.text === 'Next') as ButtonClip;
  expect(showCopy.action).toEqual({
    type: 'setClipVisibility',
    clipId: hintCopy.id,
    visible: 'show',
  });
  expect(nextCopy.action).toEqual({ type: 'goToChapter', chapterId: t.other });
  expect(findClip(t.course(), pasted[0]!)!.chapterIndex).toBe(1);
  expectValid(t.course());
});

test('paste on a clicked track and at a stage position; media from another course is skipped', () => {
  const t = setup();
  const data = copyClips(t.course(), [t.show])!;
  const trackId = t.course().chapters[0]!.tracks[0]!.id;
  let pasted: string[] = [];
  t.store.getState().execute(
    'Paste',
    pasteClips(data, {
      chapterId: t.intro,
      time: 0,
      trackId,
      at: { x: 100, y: 50 },
      newId: t.newId,
      onPasted: (ids) => (pasted = ids),
    }),
  );
  const location = findClip(t.course(), pasted[0]!)!;
  expect(location.track.id).toBe(trackId);
  expect((location.clip as ButtonClip).frame).toMatchObject({ x: 100, y: 50 });

  const foreign = {
    courseId: 'other',
    items: [
      {
        clip: {
          id: 'img',
          type: 'image',
          assetId: 'missing',
          start: 0,
          duration: 1000,
          frame: { x: 0, y: 0, width: 1, height: 1 },
        } as Clip,
        trackName: 'Images',
        group: 0,
      },
    ],
  };
  expect(() =>
    t.store
      .getState()
      .execute('Paste', pasteClips(foreign, { chapterId: t.intro, time: 0, newId: t.newId })),
  ).toThrow(/media is not in this course/);
});

test('a dangling target is dropped when the original target is gone', () => {
  const t = setup();
  const data = copyClips(t.course(), [t.toOther])!;
  t.run({ op: 'delete_clips', clipIds: [t.toOther] });
  t.run({ op: 'delete_chapter', chapterId: t.other });
  let pasted: string[] = [];
  t.store
    .getState()
    .execute(
      'Paste',
      pasteClips(data, {
        chapterId: t.intro,
        time: 0,
        newId: t.newId,
        onPasted: (ids) => (pasted = ids),
      }),
    );
  expect((findClip(t.course(), pasted[0]!)!.clip as ButtonClip).action).toEqual({
    type: 'goToChapter',
    chapterId: t.intro,
  });
  expectValid(t.course());
});

test('changing the stage format scales and centres everything; undo restores it', () => {
  const t = setup();
  const before = findClip(t.course(), t.show)!.clip as ButtonClip;
  t.store.getState().execute('Stage', setStageSize(1080, 1920));
  const after = findClip(t.course(), t.show)!.clip as ButtonClip;
  const s = 1080 / 1920;
  expect(after.frame.x).toBeCloseTo(before.frame.x * s, 1);
  expect(after.frame.width).toBeCloseTo(before.frame.width * s, 1);
  expect(after.frame.y).toBeCloseTo(before.frame.y * s + (1920 - 1080 * s) / 2, 1);
  expect(after.style!.fontSize).toBeCloseTo(before.style!.fontSize! * s, 1);
  expect(t.course().stage).toMatchObject({ width: 1080, height: 1920 });
  expectValid(t.course());
  t.store.getState().undo();
  expect(findClip(t.course(), t.show)!.clip).toEqual(before);
  expect(() => t.run({ op: 'set_stage_size', width: 5, height: 5 })).toThrow(/between 16/);
});
