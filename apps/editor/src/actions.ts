// SPDX-License-Identifier: AGPL-3.0-only
/** Editor operations shared by toolbar, timeline, shortcuts and drops. */
import {
  addClip,
  addTrack,
  clipTypeForAsset,
  createClip,
  duplicateClip,
  findClip,
  fits,
  removeClips,
  selectChapter,
  splitClip,
  DEFAULT_CLIP_DURATION,
} from '@clipcourse/editor-core';
import type { ClipType } from '@clipcourse/format';
import type { EditorSession } from './session.js';

/**
 * Adds a new clip at `time` (default: playhead). Prefers the given track,
 * then the selected clip's track, then the front-most track with room, and
 * finally creates a new track.
 */
export function addClipAt(
  session: EditorSession,
  type: ClipType,
  options: { assetId?: string; trackId?: string; time?: number } = {},
): string | null {
  const { store } = session;
  const state = store.getState();
  const chapter = selectChapter(state);
  const time = Math.max(0, Math.round(options.time ?? state.playhead));
  const asset = options.assetId ? state.course.assets[options.assetId] : undefined;
  const id = session.newId('clip');
  const clip = createClip(state.course, type, {
    id,
    start: time,
    ...(options.assetId ? { assetId: options.assetId } : {}),
    ...(asset ? { asset } : {}),
  });

  let trackId = options.trackId;
  if (!trackId) {
    const selected = state.selection[0] ? findClip(state.course, state.selection[0]) : null;
    const candidates = [
      ...(selected && selected.chapterIndex === state.course.chapters.indexOf(chapter)
        ? [selected.track]
        : []),
      ...[...chapter.tracks].reverse(),
    ];
    trackId = candidates.find((t) => fits(t, time, clip.duration))?.id;
  }

  store.getState().execute(
    `Add ${type}`,
    (draft) => {
      if (!trackId) {
        trackId = session.newId('track');
        addTrack(chapter.id, { id: trackId, name: defaultTrackName(type) })(draft);
      }
      addClip(trackId, clip)(draft);
    },
    { select: [id] },
  );
  return id;
}

export function addAssetClip(
  session: EditorSession,
  assetId: string,
  trackId?: string,
  time?: number,
) {
  const asset = session.store.getState().course.assets[assetId];
  const type = asset ? clipTypeForAsset(asset.kind) : null;
  if (!type) return null;
  return addClipAt(session, type, {
    assetId,
    ...(trackId ? { trackId } : {}),
    ...(time !== undefined ? { time } : {}),
  });
}

function defaultTrackName(type: ClipType): string {
  switch (type) {
    case 'audio':
      return 'Audio';
    case 'video':
      return 'Video';
    case 'image':
      return 'Images';
    default:
      return 'Text';
  }
}

export function deleteSelection(session: EditorSession) {
  const { selection } = session.store.getState();
  if (selection.length === 0) return;
  session.store.getState().execute('Delete', removeClips(selection), { select: [] });
}

export function splitSelectionAtPlayhead(session: EditorSession) {
  const { selection, playhead, course } = session.store.getState();
  const ids: string[] = [];
  session.store.getState().execute('Split', (draft) => {
    for (const clipId of selection) {
      const location = findClip(course, clipId);
      if (!location) continue;
      const { clip } = location;
      if (playhead <= clip.start || playhead >= clip.start + clip.duration) continue;
      const newId = session.newId('clip');
      splitClip(clipId, playhead, newId)(draft);
      ids.push(newId);
    }
  });
  if (ids.length > 0) session.store.getState().select(ids);
}

export function duplicateSelection(session: EditorSession) {
  const { selection } = session.store.getState();
  const ids: string[] = [];
  session.store.getState().execute('Duplicate', (draft) => {
    for (const clipId of selection) {
      const newId = session.newId('clip');
      duplicateClip(clipId, newId)(draft);
      ids.push(newId);
    }
  });
  if (ids.length > 0) session.store.getState().select(ids);
}

export { DEFAULT_CLIP_DURATION };
