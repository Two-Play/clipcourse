// SPDX-License-Identifier: AGPL-3.0-only
import type { ButtonClip, Course } from '@clipcourse/format';
import { describe, expect, test } from 'vitest';
import { createEmptyCourse, findClip } from '../src/document.js';
import { executeOperation, type Operation } from '../src/operations.js';
import { createQuestion } from '../src/questions.js';
import { createEditorStore } from '../src/store.js';
import { instantiateTemplate, templateFromChapter } from '../src/templates.js';
import { expectValid } from './helpers.js';

function setup() {
  const store = createEditorStore(createEmptyCourse());
  const files = new Map<string, Uint8Array>();
  const run = (op: Operation) => executeOperation({ store, files }, op);
  return { store, files, run, course: () => store.getState().course };
}

/** Intro with a branch button, a marker jump, a popup and a show/hide pair, plus a second chapter. */
function branching() {
  const t = setup();
  const intro = t.course().chapters[0]!.id;
  const side = t.run({ op: 'add_chapter', title: 'Side' }).created!.chapterId!;
  const marker = t.run({ op: 'add_marker', chapterId: intro, time: 2000, title: 'Mid' }).created!
    .markerId!;
  const popup = t.run({ op: 'add_popup', title: 'Info', text: 'More details' }).created!.popupId!;
  const toSide = t.run({
    op: 'add_clip',
    type: 'button',
    chapterId: intro,
    start: 0,
    props: { text: 'Side', action: { type: 'goToChapter', chapterId: side } },
  }).created!.clipId!;
  const toMarker = t.run({
    op: 'add_clip',
    type: 'button',
    chapterId: intro,
    start: 0,
    props: { text: 'Mid', action: { type: 'goToMarker', chapterId: intro, markerId: marker } },
  }).created!.clipId!;
  const tip = t.run({
    op: 'add_clip',
    type: 'text',
    chapterId: intro,
    start: 0,
    props: { text: 'Tip', startsHidden: true, action: { type: 'openPopup', popupId: popup } },
  }).created!.clipId!;
  const reveal = t.run({
    op: 'add_clip',
    type: 'box',
    chapterId: intro,
    start: 0,
    props: { action: { type: 'setClipVisibility', clipId: tip, visible: 'show' } },
  }).created!.clipId!;
  return { ...t, intro, side, marker, popup, toSide, toMarker, tip, reveal };
}

describe('buttons and click actions', () => {
  test('a new button goes to the next chapter by default', () => {
    const { run, course } = setup();
    const first = course().chapters[0]!.id;
    const second = run({ op: 'add_chapter' }).created!.chapterId!;
    const id = run({ op: 'add_clip', type: 'button', chapterId: first, start: 0 }).created!.clipId!;
    const clip = findClip(course(), id)!.clip as ButtonClip;
    expect(clip.action).toEqual({ type: 'goToChapter', chapterId: second });
    expectValid(course());
  });

  test('actions are replaced, not merged, and can be removed (except on buttons)', () => {
    const { run, course, toSide, tip } = branching();
    run({
      op: 'update_clip',
      clipId: toSide,
      props: { action: { type: 'openUrl', url: 'https://a.example' } },
    });
    expect(findClip(course(), toSide)!.clip).toMatchObject({
      action: { type: 'openUrl', url: 'https://a.example' },
    });
    expect((findClip(course(), toSide)!.clip as ButtonClip).action).not.toHaveProperty('chapterId');
    run({ op: 'update_clip', clipId: tip, props: { action: null } });
    expect(findClip(course(), tip)!.clip).not.toHaveProperty('action');
    expect(() => run({ op: 'update_clip', clipId: toSide, props: { action: null } })).toThrow(
      /invalid/,
    );
    expect(() =>
      run({
        op: 'update_clip',
        clipId: toSide,
        props: { action: { type: 'openUrl', url: 'javascript:x' } },
      }),
    ).toThrow(/invalid/);
  });

  test('targets cannot be deleted while a click action uses them', () => {
    const b = branching();
    expect(() => b.run({ op: 'delete_chapter', chapterId: b.side })).toThrow(
      /Chapter "Side" is the target of "Side" in "Chapter 1"/,
    );
    expect(() => b.run({ op: 'delete_marker', chapterId: b.intro, markerId: b.marker })).toThrow(
      /Marker "Mid"/,
    );
    expect(() => b.run({ op: 'delete_popup', popupId: b.popup })).toThrow(/Popup "Info"/);
    expect(() => b.run({ op: 'delete_clips', clipIds: [b.tip] })).toThrow(/This clip/);
    // Deleting the user together with the target is fine.
    b.run({ op: 'delete_clips', clipIds: [b.tip, b.reveal] });
    b.run({ op: 'delete_clips', clipIds: [b.toSide] });
    b.run({ op: 'delete_chapter', chapterId: b.side });
    expectValid(b.course());
  });

  test('a duplicated chapter points to its own markers and clips', () => {
    const b = branching();
    const copyId = b.run({ op: 'duplicate_chapter', chapterId: b.intro }).created!.chapterId!;
    const copy = b.course().chapters.find((c) => c.id === copyId)!;
    const clips = copy.tracks.flatMap((t) => t.clips);
    const byText = (text: string) => clips.find((c) => c.type === 'button' && c.text === text);
    expect(byText('Mid')).toMatchObject({
      action: { type: 'goToMarker', chapterId: copyId, markerId: copy.markers![0]!.id },
    });
    expect(byText('Side')).toMatchObject({ action: { chapterId: b.side } });
    const reveal = clips.find((c) => c.type === 'box' && c.action?.type === 'setClipVisibility');
    expect(clips.map((c) => c.id)).toContain(
      (reveal as { action: { clipId: string } }).action.clipId,
    );
    expectValid(b.course());
  });
});

describe('popups, glossary, completion', () => {
  test('popups and glossary entries can be added, changed and removed', () => {
    const { run, course } = setup();
    run({ op: 'add_asset', fileName: 'pic.png', data: new Uint8Array([1]) });
    const popupId = run({ op: 'add_popup', title: 'A', text: 'B', assetId: 'pic', alt: 'Pic' })
      .created!.popupId!;
    run({ op: 'update_popup', popupId, title: 'A2', alt: null });
    expect(course().popups).toEqual([{ id: popupId, title: 'A2', text: 'B', assetId: 'pic' }]);
    expect(() => run({ op: 'delete_asset', assetId: 'pic' })).toThrow(/popup/);
    const entryId = run({ op: 'add_glossary_entry', term: 'LMS', definition: 'System' }).created!
      .glossaryId!;
    run({ op: 'update_glossary_entry', entryId, variants: ['LMSes'] });
    expect(course().glossary).toEqual([
      { id: entryId, term: 'LMS', definition: 'System', variants: ['LMSes'] },
    ]);
    run({ op: 'delete_glossary_entry', entryId });
    run({ op: 'delete_popup', popupId });
    expect(course()).not.toHaveProperty('glossary');
    expect(course()).not.toHaveProperty('popups');
    expectValid(course());
  });

  test('completion rule and chapter flags', () => {
    const { run, course } = setup();
    const id = course().chapters[0]!.id;
    run({ op: 'set_completion', mode: 'goal' });
    run({ op: 'update_chapter', chapterId: id, goal: true, optional: true });
    expect(course().completion).toEqual({ mode: 'goal' });
    expect(course().chapters[0]).toMatchObject({ goal: true, optional: true });
    run({ op: 'update_chapter', chapterId: id, optional: false });
    run({ op: 'set_completion', mode: 'required' });
    expect(course()).not.toHaveProperty('completion');
    expect(course().chapters[0]).not.toHaveProperty('optional');
  });
});

describe('templates', () => {
  test('carry popups and hotspot images; foreign targets are dropped', () => {
    const b = branching();
    b.files.set('assets/map.png', new Uint8Array([7]));
    b.run({ op: 'add_asset', fileName: 'map.png', data: new Uint8Array([7]) });
    b.run({
      op: 'add_clip',
      type: 'question',
      chapterId: b.intro,
      start: 0,
      props: { question: createQuestion('hotspot', 'hq', 'map') },
    });
    const project = { course: b.course(), files: b.files };
    const template = templateFromChapter(project, b.intro, 'T', 'tpl');
    expect(template.popups?.map((p) => p.title)).toEqual(['Info']);
    expect(Object.keys(template.assets)).toContain('map');

    // Into an empty project: the popup comes along, the side branch target does not exist.
    let n = 0;
    const target: Course = createEmptyCourse(() => `x${++n}`);
    const result = instantiateTemplate(
      { course: target, files: new Map() },
      template,
      (p) => `${p}_${++n}`,
    );
    const clips = result.chapter.tracks.flatMap((t) => t.clips);
    const side = clips.find((c) => c.type === 'button' && c.text === 'Side') as ButtonClip;
    expect(side.action).toEqual({ type: 'goToChapter', chapterId: result.chapter.id });
    const tip = clips.find((c) => c.type === 'text' && c.text === 'Tip')!;
    expect(tip).toMatchObject({ action: { type: 'openPopup', popupId: result.popups[0]!.id } });
    const merged: Course = {
      ...target,
      assets: { ...target.assets, ...result.assets },
      popups: result.popups,
      chapters: [...target.chapters, result.chapter],
    };
    expectValid(merged);
  });
});
