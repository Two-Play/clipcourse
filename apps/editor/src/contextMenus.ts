// SPDX-License-Identifier: AGPL-3.0-only
/** Menu items for clips, tracks and the stage (shared by stage and timeline). */
import { findClip, selectChapter } from '@clipcourse/editor-core';
import type { ClipType } from '@clipcourse/format';
import {
  addClipAt,
  arrangeClip,
  centerClip,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  pasteClipboard,
  setClipAnimation,
  splitSelectionAtPlayhead,
} from './actions.js';
import type { ContextItem } from './components/ContextMenu.js';
import { t } from './i18n.js';
import type { EditorSession } from './session.js';

const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** Focuses a section of the properties panel (e.g. "On click"). */
export function focusInspector(selector: string) {
  requestAnimationFrame(() => {
    const section = document.querySelector<HTMLElement>(`.inspector ${selector}`);
    section?.scrollIntoView({ block: 'nearest' });
    section?.querySelector<HTMLElement>('select, input, textarea, button')?.focus();
  });
}

/** Items for one or more selected clips (the clicked clip is selected first). */
export function clipMenuItems(session: EditorSession, clipId: string): ContextItem[] {
  const state = session.store.getState();
  if (!state.selection.includes(clipId)) state.select([clipId]);
  const location = findClip(state.course, clipId);
  const clip = location?.clip;
  const visual = clip && clip.type !== 'audio';
  const single = session.store.getState().selection.length === 1;
  const inChapter = location?.scope.kind === 'chapter';
  return [
    { label: t('cut'), shortcut: `${MOD}+X`, onSelect: () => cutSelection(session) },
    { label: t('copy'), shortcut: `${MOD}+C`, onSelect: () => void copySelection(session) },
    {
      label: t('paste'),
      shortcut: `${MOD}+V`,
      disabled: !session.clipboard,
      onSelect: () => pasteClipboard(session),
    },
    {
      label: t('duplicate'),
      shortcut: `${MOD}+D`,
      onSelect: () => duplicateSelection(session),
      separatorBefore: true,
    },
    { label: t('split'), shortcut: 'S', onSelect: () => splitSelectionAtPlayhead(session) },
    {
      label: t('bringToFront'),
      disabled: !single || !inChapter,
      onSelect: () => arrangeClip(session, clipId, 'front'),
      separatorBefore: true,
    },
    {
      label: t('sendToBack'),
      disabled: !single || !inChapter,
      onSelect: () => arrangeClip(session, clipId, 'back'),
    },
    {
      label: t('centerH'),
      disabled: !visual,
      onSelect: () => centerClip(session, clipId, 'horizontal'),
    },
    {
      label: t('centerV'),
      disabled: !visual,
      onSelect: () => centerClip(session, clipId, 'vertical'),
    },
    {
      label: t('fadeIn'),
      disabled: !visual,
      onSelect: () => setClipAnimation(session, clipId, 'in', 'fade'),
      separatorBefore: true,
    },
    {
      label: t('onClickMenu'),
      disabled: !visual || clip?.type === 'question' || !single,
      onSelect: () => focusInspector('.action-fields'),
    },
    {
      label: t('propertiesMenu'),
      disabled: !single,
      onSelect: () => focusInspector('.inspector-body'),
    },
    {
      label: t('delete'),
      shortcut: 'Del',
      danger: true,
      onSelect: () => deleteSelection(session),
      separatorBefore: true,
    },
  ];
}

const INSERTABLE: { type: ClipType; label: Parameters<typeof t>[0] }[] = [
  { type: 'text', label: 'addText' },
  { type: 'box', label: 'addBox' },
  { type: 'button', label: 'addButton' },
  { type: 'question', label: 'insertQuestion' },
  { type: 'highlight', label: 'addHighlight' },
];

/** "Insert here" items: at a time (and track) on the timeline, or a stage position. */
export function insertItems(
  session: EditorSession,
  where: { time?: number; trackId?: string; at?: { x: number; y: number } },
): ContextItem[] {
  return INSERTABLE.map(({ type, label }, i) => ({
    label: t('insertHere', { what: t(label) }),
    separatorBefore: i === 0,
    onSelect: () => {
      const id = addClipAt(session, type, {
        ...(where.time !== undefined ? { time: where.time } : {}),
        ...(where.trackId ? { trackId: where.trackId } : {}),
      });
      if (id && where.at) {
        // Place the new clip's centre where the stage was clicked.
        session.store.getState().execute(
          'Place',
          (draft) => {
            const clip = findClip(draft, id)?.clip;
            if (!clip || clip.type === 'audio') return;
            clip.frame.x = Math.round(where.at!.x - clip.frame.width / 2);
            clip.frame.y = Math.round(where.at!.y - clip.frame.height / 2);
          },
          { mergeKey: `add:${id}` },
        );
      }
    },
  }));
}

export function stageMenuItems(
  session: EditorSession,
  at: { x: number; y: number },
): ContextItem[] {
  const state = session.store.getState();
  const chapter = selectChapter(state);
  return [
    {
      label: t('paste'),
      shortcut: `${MOD}+V`,
      disabled: !session.clipboard,
      onSelect: () => pasteClipboard(session, { at }),
    },
    {
      label: t('selectAll'),
      shortcut: `${MOD}+A`,
      onSelect: () =>
        session.store.getState().select(chapter.tracks.flatMap((tr) => tr.clips.map((c) => c.id))),
    },
    ...insertItems(session, { at }),
    {
      label: t('chapterBackgroundMenu'),
      separatorBefore: true,
      onSelect: () => {
        state.select([]);
        focusInspector('.inspector-body');
      },
    },
  ];
}
