// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Copy and paste of clips, also into other chapters. The clipboard keeps
 * plain copies; pasting gives every clip a new id, keeps the clips' relative
 * timing and track grouping, and rewrites click actions between the pasted
 * clips so they point at the copies.
 */
import type { Clip, Course, Track } from '@clipcourse/format';
import { current, isDraft } from 'immer';
import { addClip, addTrack, type Recipe } from './commands.js';
import { findClip, getChapter, type IdFactory } from './document.js';
import { dropForeignActions } from './references.js';

export interface ClipboardItem {
  clip: Clip;
  /** Name of the source track, for new tracks. */
  trackName: string;
  /** Group index: clips from the same source track share it (back-most first). */
  group: number;
}

export interface ClipboardData {
  courseId: string;
  items: ClipboardItem[];
}

const plain = <T>(value: T): T =>
  structuredClone(isDraft(value) ? (current(value as never) as T) : value);

/** Copies clips (in stacking order). Returns null if none of the ids exist. */
export function copyClips(course: Course, clipIds: readonly string[]): ClipboardData | null {
  const groups = new Map<string, number>();
  const found = clipIds
    .map((id) => findClip(course, id))
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .sort((a, b) => a.trackIndex - b.trackIndex || a.clip.start - b.clip.start);
  if (found.length === 0) return null;
  const items = found.map((l) => {
    if (!groups.has(l.track.id)) groups.set(l.track.id, groups.size);
    return {
      clip: plain(l.clip),
      trackName: l.track.name ?? 'Track',
      group: groups.get(l.track.id)!,
    };
  });
  return { courseId: course.id, items };
}

export interface PasteOptions {
  chapterId: string;
  /** Where the earliest clip starts, ms. */
  time: number;
  /** Put the first group on this track (e.g. the track that was right-clicked). */
  trackId?: string;
  /** Move the first visual clip's top-left corner here (stage pixels), keeping the layout. */
  at?: { x: number; y: number };
  newId: IdFactory;
  /** Receives the ids of the pasted clips. */
  onPasted?: (ids: string[]) => void;
}

/**
 * Pastes clipboard clips into a chapter. Clips whose media is not in this
 * course are skipped; actions whose targets do not exist here are dropped
 * (buttons then point at the chapter itself).
 */
export function pasteClips(data: ClipboardData, options: PasteOptions): Recipe {
  return (draft) => {
    const chapter = getChapter(draft, options.chapterId);
    const usable = data.items.filter(({ clip }) => {
      const assetIds: string[] = [];
      if (clip.type === 'image' || clip.type === 'video' || clip.type === 'audio')
        assetIds.push(clip.assetId);
      if ((clip.type === 'video' || clip.type === 'audio') && clip.captionsAssetId)
        assetIds.push(clip.captionsAssetId);
      if (clip.type === 'question' && clip.question.kind === 'hotspot')
        assetIds.push(clip.question.assetId);
      return assetIds.every((id) => draft.assets[id]);
    });
    if (usable.length === 0)
      throw new Error('Nothing to paste here (the media is not in this course)');

    const earliest = Math.min(...usable.map((i) => i.clip.start));
    const firstVisual = usable.find((i) => i.clip.type !== 'audio')?.clip;
    const shift =
      options.at && firstVisual && firstVisual.type !== 'audio'
        ? { x: options.at.x - firstVisual.frame.x, y: options.at.y - firstVisual.frame.y }
        : { x: 0, y: 0 };

    // New ids first, so actions between pasted clips can be rewritten.
    const ids = new Map(usable.map((i) => [i.clip.id, options.newId('clip')]));
    const clips = usable.map(({ clip }) => {
      const copy = structuredClone(clip);
      copy.id = ids.get(clip.id)!;
      copy.start = Math.max(0, Math.round(options.time + clip.start - earliest));
      // Course layer clips last "forever"; in a chapter they end with it.
      copy.duration = Math.max(
        100,
        Math.min(copy.duration, Math.max(chapter.duration - copy.start, 1000)),
      );
      if (copy.type === 'question') copy.question.id = `${copy.id}_q`;
      if (copy.type !== 'audio') {
        copy.frame = { ...copy.frame, x: copy.frame.x + shift.x, y: copy.frame.y + shift.y };
        if (copy.action?.type === 'setClipVisibility' && ids.has(copy.action.clipId))
          copy.action = { ...copy.action, clipId: ids.get(copy.action.clipId)! };
      }
      return copy;
    });
    dropForeignActions({ ...chapter, tracks: [{ id: '_paste', clips }] }, draft);

    // One target track per source group.
    const groupTracks = new Map<number, string>();
    usable.forEach((item, index) => {
      let trackId = groupTracks.get(item.group);
      if (!trackId) {
        if (item.group === usable[0]!.group && options.trackId) {
          trackId = options.trackId;
        } else {
          trackId = options.newId('track');
          addTrack(chapter.id, { id: trackId, name: item.trackName })(draft);
        }
        groupTracks.set(item.group, trackId);
      }
      addClip(trackId, clips[index]!)(draft);
    });
    options.onPasted?.(clips.map((c) => c.id));
  };
}

// --- Stage format ---------------------------------------------------------------------

export const STAGE_PRESETS = [
  { id: '16:9', name: 'Widescreen 16:9', width: 1920, height: 1080 },
  { id: '4:3', name: 'Classic 4:3', width: 1440, height: 1080 },
  { id: '1:1', name: 'Square 1:1', width: 1080, height: 1080 },
  { id: '9:16', name: 'Portrait 9:16', width: 1080, height: 1920 },
] as const;

/**
 * Changes the stage size and scales every clip with it: frames, font sizes,
 * line widths, corners and padding. With another aspect ratio the content
 * is fitted and centred, so nothing is cut off.
 */
export const setStageSize =
  (width: number, height: number): Recipe =>
  (draft) => {
    const w = Math.round(width);
    const h = Math.round(height);
    if (!(w >= 16 && h >= 16 && w <= 8192 && h <= 8192))
      throw new Error('Stage size must be between 16 and 8192 pixels');
    const { width: ow, height: oh } = draft.stage;
    if (ow === w && oh === h) return;
    const s = Math.min(w / ow, h / oh);
    const dx = (w - ow * s) / 2;
    const dy = (h - oh * s) / 2;
    const r = (v: number) => Math.round(v * 100) / 100;
    const scaleTracks = (tracks: Track[]) => {
      for (const track of tracks) {
        for (const clip of track.clips) {
          if (clip.type === 'audio') continue;
          const f = clip.frame;
          clip.frame = {
            ...f,
            x: r(f.x * s + dx),
            y: r(f.y * s + dy),
            width: r(f.width * s),
            height: r(f.height * s),
          };
          const c = clip as unknown as Record<string, unknown>;
          for (const key of ['strokeWidth', 'radius', 'padding'] as const) {
            if (typeof c[key] === 'number') c[key] = r((c[key] as number) * s);
          }
          if ('style' in clip && clip.style?.fontSize)
            clip.style.fontSize = Math.max(1, r(clip.style.fontSize * s));
        }
      }
    };
    for (const chapter of draft.chapters) scaleTracks(chapter.tracks);
    if (draft.courseLayer) {
      scaleTracks(draft.courseLayer.background);
      scaleTracks(draft.courseLayer.foreground);
    }
    if (draft.theme) draft.theme.radius = r(draft.theme.radius * s);
    draft.stage.width = w;
    draft.stage.height = h;
  };
